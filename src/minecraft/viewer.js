'use strict';

/*
 * „Bot-Sicht“: zeigt im Browser in 3D, was der Minecraft-Bot gerade sieht
 * (prismarine-viewer, Ich-Perspektive). Nur lokal erreichbar (127.0.0.1) –
 * öffentlich über nginx unter /mc-sicht/. Zugang nur mit einem signierten Link
 * aus dem /panel (gilt 2 Stunden), danach per Cookie.
 */

const crypto = require('node:crypto');
const http = require('node:http');

const PREFIX = '/mc-sicht';
const LINK_HOURS = 2;

function createViewer({ port, secret, logger, viewDistance = 4, info = () => ({}) }) {
  if (!port || !secret) return null;
  const express = require('express');
  // Nur der Daten-Teil (ohne Browser-Renderer, der „canvas“ bräuchte)
  const { WorldView } = require('prismarine-viewer/viewer/lib/worldView');
  const { setupRoutes } = require('prismarine-viewer/lib/common');

  const sign = (exp) => crypto.createHmac('sha256', secret).update(`mc-sicht:${exp}`).digest('base64url');
  const valid = (token) => {
    const [exp, sig] = String(token || '').split('.');
    if (!/^\d{13}$/.test(exp || '') || Number(exp) < Date.now() || !sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(sign(exp));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const cookieToken = (header) => (String(header || '').match(/(?:^|;\s*)mcv=([\w.-]+)/) || [])[1];

  /** Neuer Link-Token (für das Panel). */
  function createToken() {
    const exp = Date.now() + LINK_HOURS * 3600e3;
    return `${exp}.${sign(exp)}`;
  }

  const app = express();
  app.disable('x-powered-by');
  // Erst mit ?t=… aus dem Panel, danach mit Cookie
  app.use(PREFIX, (req, res, next) => {
    const fromLink = req.query.t;
    if (fromLink && valid(fromLink)) {
      res.setHeader('Set-Cookie', `mcv=${fromLink}; Path=${PREFIX}; HttpOnly; SameSite=Lax; Secure; Max-Age=${LINK_HOURS * 3600}`);
      return res.redirect(`${PREFIX}/`);
    }
    if (valid(cookieToken(req.headers.cookie))) return next();
    res.status(403).type('text/plain; charset=utf-8').send('Link abgelaufen oder ungültig. Öffne die Bot-Sicht neu über /panel → Einstellungen.');
  });
  // Startseite mit Chat-Fenster und Infozeile über der 3D-Ansicht
  const fs = require('node:fs');
  const path = require('node:path');
  const viewerIndex = fs.readFileSync(path.join(path.dirname(require.resolve('prismarine-viewer/package.json')), 'public', 'index.html'), 'utf8');
  app.get(`${PREFIX}/`, (req, res) => res.type('html').send(viewerIndex.replace('<title>Prismarine Viewer</title>', '<title>Bot-Sicht</title>').replace('</body>', `${OVERLAY}</body>`)));
  app.get(`${PREFIX}/info.json`, (req, res) => res.json(snapshot()));
  setupRoutes(app, PREFIX);

  const server = http.createServer(app);
  const io = require('socket.io')(server, { path: `${PREFIX}/socket.io` });
  io.use((socket, next) => (valid(cookieToken(socket.handshake.headers.cookie)) ? next() : next(new Error('forbidden'))));

  let bot = null;
  const chat = []; // letzte Chat-/Systemzeilen, die der Bot empfängt
  const onChat = (text) => {
    const line = String(text || '').trim();
    if (!line) return;
    chat.push({ at: Date.now(), text: line.slice(0, 300) });
    if (chat.length > 40) chat.shift();
  };

  function snapshot() {
    const b = bot;
    const base = info() || {};
    if (!b?.entity) return { online: false, chat, balance: base.balance ?? null };
    const me = b.entity.position;
    const nearby = Object.values(b.entities || {})
      .filter((e) => e !== b.entity && e.type === 'player' && e.username)
      .map((e) => ({ name: e.username, dist: Math.round(e.position.distanceTo(me)) }))
      .filter((e) => e.dist <= 48)
      .sort((x, y) => x.dist - y.dist)
      .slice(0, 8);
    return {
      online: true,
      name: b.username,
      pos: { x: Math.floor(me.x), y: Math.floor(me.y), z: Math.floor(me.z) },
      health: b.health ?? null,
      food: b.food ?? null,
      balance: base.balance ?? null,
      players: b.players ? Object.keys(b.players).length : null,
      nearby,
      chat,
    };
  }
  io.on('connection', (socket) => {
    if (!bot?.entity) {
      socket.disconnect();
      return;
    }
    const b = bot;
    // Neuere Minecraft-Versionen (z. B. 26.x) kennt der Viewer nicht → neueste bekannte nehmen
    const { getVersion, supportedVersions } = require('prismarine-viewer/viewer/lib/version');
    socket.emit('version', getVersion(b.version) ?? supportedVersions[supportedVersions.length - 1]);
    // Eigenen Körper nicht zeichnen (sonst steht er in der Ich-Perspektive im Bild)
    const emitter = {
      on: socket.on.bind(socket),
      emit: (event, data) => (event === 'entity' && data?.id === b.entity?.id ? undefined : socket.emit(event, data)),
    };
    const worldView = new WorldView(b.world, viewDistance, b.entity.position, emitter);
    worldView.init(b.entity.position);
    const move = () => {
      socket.emit('position', { pos: b.entity.position, yaw: b.entity.yaw, pitch: b.entity.pitch, addMesh: true });
      worldView.updatePosition(b.entity.position);
    };
    b.on('move', move);
    worldView.listenToBot(b);
    // Auch wenn der Bot still steht: Kamera sofort und dann regelmäßig an seine Augen setzen
    move();
    const tick = setInterval(move, 1000);
    const cleanup = () => {
      clearInterval(tick);
      b.removeListener('move', move);
      worldView.removeListenersFromBot(b);
    };
    socket.on('disconnect', cleanup);
    b.once('end', () => socket.disconnect());
  });

  server.listen(port, '127.0.0.1', () => logger.info(`Bot-Sicht läuft auf 127.0.0.1:${port}${PREFIX}/`));
  server.on('error', (err) => logger.warn('Bot-Sicht:', err.message));

  return {
    /** Nach jedem Spawn den aktuellen Bot setzen. */
    attach(b) {
      bot = b;
      b.on('messagestr', onChat);
    },
    detach(b) {
      b.removeListener?.('messagestr', onChat);
      if (bot === b) bot = null;
    },
    createToken,
    valid,
    prefix: PREFIX,
    close() { io.close(); server.close(); },
  };
}

// Chat-Fenster unten links, Infozeile oben (holt alle 2 s info.json)
const OVERLAY = `
<style>
  #hp-info, #hp-chat { position: fixed; z-index: 10; font: 13px/1.4 system-ui, sans-serif; color: #fff;
    background: rgba(0,0,0,.55); border-radius: 8px; padding: 6px 10px; pointer-events: none; }
  #hp-info { top: 8px; left: 8px; right: 8px; display: flex; flex-wrap: wrap; gap: 4px 14px; }
  #hp-chat { left: 8px; bottom: 8px; width: min(520px, calc(100% - 16px)); max-height: 40%; overflow: hidden;
    display: flex; flex-direction: column; justify-content: flex-end; }
  #hp-chat div { white-space: pre-wrap; word-break: break-word; text-shadow: 0 1px 2px #000; }
  #hp-info b { color: #fbbf24; }
</style>
<div id="hp-info">Bot-Sicht lädt …</div>
<div id="hp-chat"></div>
<script>
(function () {
  var esc = function (t) { return String(t).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  var money = function (n) { return n == null ? '–' : '$' + Number(n).toLocaleString('de-DE'); };
  function load() {
    fetch('info.json', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      var info = document.getElementById('hp-info');
      if (!d.online) { info.innerHTML = 'Bot ist nicht verbunden'; }
      else {
        var near = d.nearby.length ? d.nearby.map(function (p) { return esc(p.name) + ' (' + p.dist + 'm)'; }).join(', ') : 'niemand';
        info.innerHTML = '<span><b>' + esc(d.name) + '</b></span>'
          + '<span>📍 ' + d.pos.x + ' / ' + d.pos.y + ' / ' + d.pos.z + '</span>'
          + '<span>❤ ' + (d.health == null ? '–' : Math.round(d.health)) + ' · 🍗 ' + (d.food == null ? '–' : d.food) + '</span>'
          + '<span>💰 ' + money(d.balance) + '</span>'
          + '<span>👥 ' + (d.players == null ? '–' : d.players) + ' online · in der Nähe: ' + near + '</span>';
      }
      document.getElementById('hp-chat').innerHTML = d.chat.slice(-12).map(function (l) {
        var t = new Date(l.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        return '<div><span style="opacity:.6">' + t + '</span> ' + esc(l.text) + '</div>';
      }).join('');
    }).catch(function () {});
  }
  load(); setInterval(load, 2000);
})();
</script>`;

module.exports = { createViewer, PREFIX };

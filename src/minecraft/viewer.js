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

function createViewer({ port, secret, logger, viewDistance = 4 }) {
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
  setupRoutes(app, PREFIX);

  const server = http.createServer(app);
  const io = require('socket.io')(server, { path: `${PREFIX}/socket.io` });
  io.use((socket, next) => (valid(cookieToken(socket.handshake.headers.cookie)) ? next() : next(new Error('forbidden'))));

  let bot = null;
  io.on('connection', (socket) => {
    if (!bot?.entity) {
      socket.disconnect();
      return;
    }
    const b = bot;
    // Neuere Minecraft-Versionen (z. B. 26.x) kennt der Viewer nicht → neueste bekannte nehmen
    const { getVersion, supportedVersions } = require('prismarine-viewer/viewer/lib/version');
    socket.emit('version', getVersion(b.version) ?? supportedVersions[supportedVersions.length - 1]);
    const worldView = new WorldView(b.world, viewDistance, b.entity.position, socket);
    worldView.init(b.entity.position);
    const move = () => {
      socket.emit('position', { pos: b.entity.position, yaw: b.entity.yaw, pitch: b.entity.pitch, addMesh: true });
      worldView.updatePosition(b.entity.position);
    };
    b.on('move', move);
    worldView.listenToBot(b);
    const cleanup = () => {
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
    attach(b) { bot = b; },
    detach(b) { if (bot === b) bot = null; },
    createToken,
    valid,
    prefix: PREFIX,
    close() { io.close(); server.close(); },
  };
}

module.exports = { createViewer, PREFIX };

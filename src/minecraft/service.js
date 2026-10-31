'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Store } = require('../lib/store');
const { ApiError, userMessage } = require('../lib/hugoApi');
const { parseAmount, commandAmount, formatAmount } = require('./amount');
const { buildPatterns, matchFirst, LOOKS_LIKE_PAYMENT } = require('./patterns');
const { reconcile, payoutMatches } = require('./ledger');
const { LinkCodes } = require('./linkCodes');

/*
 * Minecraft-Bot auf HugoSMP (Mineflayer).
 *
 * - Kontoverknüpfung: Der Bot flüstert dem Spieler einen Code zu, der in
 *   Discord eingegeben wird.
 * - Einzahlungen: Spieler zahlen per /pay an den Bot. Gutgeschrieben wird nur,
 *   was der Kontostand des Bots tatsächlich bestätigt; die Website rechnet in
 *   HugoCoins um.
 * - Auszahlungen (optional): vom Team auf der Website freigegebene Beträge
 *   zahlt der Bot per /pay aus und prüft das Ergebnis am Kontostand.
 *
 * Geldbewegungen laufen strikt nacheinander. Meldungen an die Website, die
 * nicht sofort klappen, liegen in data/minecraft.json und werden wiederholt.
 */

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (all, k) => (vars[k] === undefined ? all : String(vars[k])));
const plain = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')).slice(0, 300);

function createMinecraftService({ config, api, logger, report, dataDir, createBot, chatDelayMs = 1100, settleMs = 1500, payoutCheckMs = 2500, reconnectMs = 15_000, commandWaitMs = 2500 }) {
  const patterns = buildPatterns(config);
  const persisted = new Store(dataDir, { fileName: 'minecraft.json' });
  const db = (persisted.data.minecraft ??= { outbox: {}, payouts: {}, links: {}, lastBalance: null });
  const codes = new LinkCodes();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const state = { online: false, since: null, lastError: null, connecting: false };
  let bot = null;
  let stopped = false;
  let reconnectDelay = reconnectMs;
  let reconnectTimer = null;
  let claims = [];
  let settleTimer = null;
  let balanceWaiter = null;
  const recentSystem = [];
  // Zeilen, die gerade für /panel mitgeschrieben werden (Antwort auf einen Befehl).
  const captures = new Set();
  // Zeilen, die nach Kontostand/Geld aussehen – helfen beim Einstellen der Erkennung.
  // Spieler-Chat („Name: …“) wird ausgelassen, damit die Meldung nicht im Spam untergeht.
  const MONEY_HINT = /(kontostand|guthaben|balance|money|geld|münzen|coins|[$€⛃])/i;
  const PLAYER_CHAT = /^(?:\[[^\]]{1,24}\]\s*)*(?:[A-Z]{2,12}\s+)?(?!(?:kontostand|guthaben|balance|money|geld)\b)[A-Za-z0-9_.]{3,16}\s*(?::|»|>)\s/i;
  const moneyLines = [];
  const throttle = new Map();

  // --- Hilfsfunktionen ----------------------------------------------------

  /** Meldet höchstens einmal pro Zeitraum und Schlüssel an Discord. */
  function notify(route, entry, key = null, everyMs = 10 * 60_000) {
    if (key) {
      if (Date.now() - (throttle.get(key) ?? 0) < everyMs) return;
      throttle.set(key, Date.now());
    }
    Promise.resolve(report(route, entry)).catch((err) => logger.warn('Minecraft-Meldung:', err.message));
  }

  // Alle Geldbewegungen laufen nacheinander.
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const run = chain.then(fn);
    chain = run.catch((err) => logger.error('Minecraft:', err));
    return run;
  };

  // Chat-Befehle mit Abstand senden, damit der Server nicht als Spam wertet.
  let chatChain = Promise.resolve();
  function command(text) {
    const run = chatChain.then(async () => {
      if (!bot || !state.online) throw new Error('Minecraft-Bot ist nicht verbunden.');
      bot.chat(text);
      await sleep(chatDelayMs);
    });
    chatChain = run.catch(() => {});
    return run;
  }

  const whisper = (name, text) => command(fill(config.whisperCommand, { name, text })).catch((err) => logger.warn('Flüstern:', err.message));

  function findPlayer(name) {
    if (!bot?.players) return null;
    const p = Object.values(bot.players).find((x) => x.username?.toLowerCase() === String(name).toLowerCase());
    return p ? { username: p.username, uuid: p.uuid } : null;
  }

  function readBalance(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        balanceWaiter = null;
        notify('system', {
          title: 'Minecraft: Kontostand nicht erkannt',
          description: `Auf \`${config.balanceCommand}\` kam keine erkannte Antwort.\nServerzeilen mit Geldbezug (ohne Spieler-Chat):\n${moneyLines.map((l) => `\`${l}\``).join('\n') || '— keine –'}\nBitte im Spiel \`${config.balanceCommand}\` eingeben und die Antwort als Screenshot schicken.`,
        }, 'balance-unknown', 6 * 60 * 60_000);
        reject(new Error('Kontostand nicht erkannt'));
      }, timeoutMs);
      balanceWaiter = (value) => {
        clearTimeout(timer);
        balanceWaiter = null;
        resolve(value);
      };
      command(config.balanceCommand).catch((err) => {
        clearTimeout(timer);
        balanceWaiter = null;
        reject(err);
      });
    });
  }

  function setBalance(value) {
    db.lastBalance = value;
    persisted.save();
  }

  // --- Einzahlungen -------------------------------------------------------

  /** Verteilt den Anstieg seit dem letzten bekannten Kontostand auf erkannte Zahlungen. */
  function settle(balance) {
    if (db.lastBalance === null) {
      setBalance(balance);
      if (claims.length) reportUnconfirmed(claims.splice(0), 'Kein Ausgangs-Kontostand bekannt');
      return;
    }
    const delta = balance - db.lastBalance;
    const result = reconcile(claims.splice(0), delta);
    setBalance(balance);
    for (const claim of result.confirmed) queueDeposit(claim);
    if (result.unconfirmed.length) reportUnconfirmed(result.unconfirmed, `Der Kontostand ist nur um ${formatAmount(Math.max(0, delta))} gestiegen, die erkannten Zahlungen ergeben mehr. Mindestens eine Nachricht ist falsch`);
    if (result.surplus) {
      notify('audit', {
        title: 'Minecraft: Unerklärter Geldeingang',
        description: `Der Kontostand ist um **${formatAmount(result.surplus)}** mehr gestiegen als erkannte Zahlungen. Nichts wurde gutgeschrieben – bitte prüfen (z. B. Zahlung, während der Bot offline war).`,
      });
    }
    if (result.decreased) {
      notify('audit', { title: 'Minecraft: Kontostand gesunken', description: `Der Kontostand des Bots ist ohne Auszahlung um **${formatAmount(-delta)}** gesunken.` });
    }
  }

  function reportUnconfirmed(list, reason) {
    notify('audit', {
      title: 'Minecraft: Zahlung nicht bestätigt',
      description: `${reason}. Nicht gutgeschrieben – bitte prüfen.\n${list.map((c) => `**${c.name}** · ${formatAmount(c.amount)}`).join('\n')}`,
    });
  }

  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      exclusive(async () => {
        if (!claims.length) return;
        try {
          settle(await readBalance());
        } catch (err) {
          logger.warn('Einzahlung prüfen:', err.message);
          setTimeout(scheduleSettle, 60_000).unref?.(); // später erneut versuchen, Zahlungen bleiben vorgemerkt
        }
      });
    }, settleMs);
    settleTimer.unref?.();
  }

  function queueDeposit(claim) {
    const id = crypto.randomUUID();
    db.outbox[id] = { id, minecraftName: claim.name, minecraftUuid: claim.uuid ?? null, amount: claim.amount, receivedAt: claim.at };
    persisted.flush();
    flushOutbox();
  }

  let flushing = false;
  async function flushOutbox() {
    if (flushing) return;
    flushing = true;
    try {
      for (const d of Object.values(db.outbox)) {
        if (!api.configured) {
          if (!d.notified) {
            d.notified = true;
            persisted.save();
            whisper(d.minecraftName, `${formatAmount(d.amount)} erhalten. Die Gutschrift folgt, sobald die Website verbunden ist.`);
            notify('audit', { title: 'Minecraft: Einzahlung vorgemerkt', description: `**${d.minecraftName}** · ${formatAmount(d.amount)} – wird an die Website gemeldet, sobald sie verbunden ist.` });
          }
          continue;
        }
        try {
          const res = await api.reportDeposit(d);
          delete db.outbox[d.id];
          persisted.save();
          whisper(d.minecraftName, res.linked
            ? `${formatAmount(d.amount)} erhalten${res.credited !== null ? ` – ${formatAmount(res.credited)} HugoCoins gutgeschrieben` : ''}. Danke!`
            : `${formatAmount(d.amount)} erhalten. Verknüpfe dein Konto im Discord, dann wird es gutgeschrieben.`);
          notify('audit', {
            title: 'Minecraft: Einzahlung',
            fields: [
              { name: 'Spieler', value: d.minecraftName, inline: true },
              { name: 'Betrag', value: formatAmount(d.amount), inline: true },
              { name: 'Gutschrift', value: res.credited !== null ? `${formatAmount(res.credited)} HugoCoins` : res.linked ? 'laut Website' : 'nach Verknüpfung', inline: true },
            ],
          });
        } catch (err) {
          // Bleibt im Postausgang und wird wiederholt. Gleicher Idempotency-Key → keine Doppelbuchung.
          notify('system', { title: 'Minecraft: Einzahlung nicht gemeldet', description: `**${d.minecraftName}** · ${formatAmount(d.amount)}: ${userMessage(err)} Wird automatisch wiederholt.` }, `deposit-fail:${d.id}`, 30 * 60_000);
          if (err instanceof ApiError && ['unauthorized', 'not_configured'].includes(err.code)) break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  // --- Auszahlungen -------------------------------------------------------

  async function executePayout(p) {
    const entry = db.payouts[p.id];
    if (entry) return; // schon einmal versucht – nie automatisch wiederholen
    if (p.amount > config.payoutMax) {
      await api.failPayout(p.id, { reason: `Über dem Limit von ${formatAmount(config.payoutMax)} pro Auszahlung` }).catch(() => {});
      notify('audit', { title: 'Minecraft: Auszahlung abgelehnt', description: `**${p.minecraftName}** · ${formatAmount(p.amount)} liegt über MC_PAYOUT_MAX.` });
      return;
    }
    const before = await readBalance();
    settle(before);
    if (before < p.amount) {
      await api.failPayout(p.id, { reason: 'Guthaben des Bots reicht nicht' }).catch(() => {});
      notify('audit', { title: 'Minecraft: Auszahlung nicht möglich', description: `**${p.minecraftName}** · ${formatAmount(p.amount)}: Der Bot hat nur ${formatAmount(before)}.` });
      return;
    }

    db.payouts[p.id] = { ...p, startedAt: new Date().toISOString(), state: 'sending' };
    persisted.flush(); // vor dem Senden sichern: nach einem Absturz wird nie doppelt gezahlt
    const vars = { name: p.minecraftName, amount: commandAmount(p.amount) };
    await command(fill(config.payCommand, vars));
    if (config.payConfirmCommand) await command(fill(config.payConfirmCommand, vars));
    await sleep(payoutCheckMs);

    let after = null;
    try {
      after = await readBalance();
    } catch {
      // bleibt unklar
    }
    const pending = claims.reduce((sum, c) => sum + c.amount, 0);
    const ok = after !== null && (payoutMatches(before, after, p.amount) || (pending > 0 && payoutMatches(before, after - pending, p.amount)));
    if (!ok) {
      db.payouts[p.id].state = 'uncertain';
      persisted.flush();
      if (after !== null) setBalance(after);
      await api.failPayout(p.id, { reason: 'Ergebnis im Spiel nicht eindeutig – bitte prüfen', uncertain: true }).catch(() => {});
      notify('audit', {
        title: 'Minecraft: Auszahlung unklar',
        description: `**${p.minecraftName}** · ${formatAmount(p.amount)}\nKontostand vorher ${formatAmount(before)}, nachher ${after === null ? 'unbekannt' : formatAmount(after)}. Wird nicht wiederholt – bitte im Spiel prüfen.`,
      });
      return;
    }
    setBalance(before - p.amount);
    if (pending > 0) scheduleSettle();
    db.payouts[p.id].state = 'paid';
    db.payouts[p.id].paidAt = new Date().toISOString();
    persisted.flush();
    whisper(p.minecraftName, `Deine Auszahlung über ${formatAmount(p.amount)} wurde überwiesen.`);
    notify('audit', { title: 'Minecraft: Auszahlung', fields: [{ name: 'Spieler', value: p.minecraftName, inline: true }, { name: 'Betrag', value: formatAmount(p.amount), inline: true }] });
    await completePaid();
  }

  /** Meldet bereits ausgeführte Auszahlungen an die Website (wiederholbar). */
  async function completePaid() {
    for (const p of Object.values(db.payouts)) {
      if (p.state !== 'paid') continue;
      try {
        await api.completePayout(p.id, { paidAt: p.paidAt });
        p.state = 'done';
        persisted.save();
      } catch (err) {
        notify('system', { title: 'Minecraft: Auszahlung nicht bestätigt', description: `${p.minecraftName} · ${formatAmount(p.amount)} wurde ausgezahlt, die Website hat es noch nicht übernommen: ${userMessage(err)}` }, `complete:${p.id}`, 30 * 60_000);
      }
    }
  }

  async function payoutTick() {
    if (!config.payoutsEnabled || !state.online || !api.configured || db.lastBalance === null) return;
    await completePaid();
    let list;
    try {
      list = await api.listPayouts();
    } catch (err) {
      notify('system', { title: 'Minecraft: Auszahlungen nicht abrufbar', description: userMessage(err) }, 'payout-list', 30 * 60_000);
      return;
    }
    for (const p of list) {
      if (db.payouts[p.id]) continue;
      await exclusive(() => executePayout(p)).catch((err) => logger.warn('Auszahlung:', err.message));
    }
  }

  // --- Chat ---------------------------------------------------------------

  function onSystemMessage(text) {
    const line = text.trim();
    if (!line) return;
    recentSystem.push(line.slice(0, 200));
    if (recentSystem.length > 15) recentSystem.shift();
    for (const c of captures) if (c.length < 20) c.push(line.slice(0, 300));
    if (/\d/.test(line) && MONEY_HINT.test(line) && !PLAYER_CHAT.test(line)) {
      moneyLines.push(line.slice(0, 200));
      if (moneyLines.length > 8) moneyLines.shift();
    }

    if (balanceWaiter) {
      const g = matchFirst(patterns.balance, line);
      const value = g && parseAmount(g.amount, { allowZero: true });
      if (value !== null && value !== undefined && g) {
        balanceWaiter(value);
        return;
      }
    }
    const pay = matchFirst(patterns.pay, line);
    if (pay) {
      const amount = parseAmount(pay.amount);
      if (amount === null || pay.name.toLowerCase() === bot?.username?.toLowerCase()) return;
      const player = findPlayer(pay.name);
      const claim = { name: player?.username ?? pay.name, uuid: player?.uuid ?? null, amount, at: new Date().toISOString() };
      if (config.balanceCheck === false) {
        // MC_BALANCE_CHECK=false: Nachricht gilt direkt, der bekannte Kontostand wird mitgeführt.
        if (db.lastBalance !== null) setBalance(db.lastBalance + amount);
        queueDeposit(claim);
        return;
      }
      claims.push(claim);
      scheduleSettle();
      return;
    }
    if (LOOKS_LIKE_PAYMENT.test(line) && /\d/.test(line)) {
      notify('system', {
        title: 'Minecraft: Nachricht nicht erkannt',
        description: `Sieht nach einer Zahlung aus, passt aber zu keinem Muster:\n\`${line.slice(0, 300)}\`\nGgf. MC_PAY_PATTERN anpassen.`,
      }, 'unrecognized', 10 * 60_000);
    }
  }

  // --- Website ------------------------------------------------------------

  // Der Absender einer Flüsternachricht ist nur am Text erkannt. Sicher ist das trotzdem:
  // Der Code geht per /msg an den echten Spieler, ein Fälscher bekommt ihn nie zu sehen.
  async function onLoginRequest(name) {
    if (!api.configured) return;
    try {
      const { code } = await api.createLoginCode({ minecraftName: name });
      whisper(name, `Dein Website-Code: ${code} - 5 Minuten gueltig. Niemals weitergeben!`);
    } catch (err) {
      whisper(name, userMessage(err));
    }
  }

  async function heartbeat() {
    if (!api.configured) return;
    try {
      await api.minecraftHeartbeat({ online: state.online, username: bot?.username ?? null });
    } catch (err) {
      logger.debug?.('Minecraft-Heartbeat:', err.message);
    }
  }

  // --- Verbindung ---------------------------------------------------------

  function connect() {
    if (stopped || state.connecting) return;
    state.connecting = true;
    let b;
    try {
      b = createBot({
        host: config.host,
        port: config.port,
        username: config.account,
        auth: 'microsoft',
        version: config.version || false,
        profilesFolder: path.join(dataDir, 'minecraft-auth'),
        hideErrors: true,
        checkTimeoutInterval: 60_000,
        onMsaCode: (data) => notify('system', {
          title: 'Minecraft: Anmeldung nötig',
          description: `Öffne **${data.verification_uri}** und gib den Code **${data.user_code}** ein. Melde dich mit dem Microsoft-Konto des Bots an (${config.account}).`,
        }),
      });
    } catch (err) {
      state.connecting = false;
      state.lastError = err.message;
      scheduleReconnect();
      return;
    }
    bot = b;

    b.once('spawn', async () => {
      state.connecting = false;
      state.online = true;
      state.since = new Date();
      state.lastError = null;
      reconnectDelay = reconnectMs;
      logger.info(`Minecraft: verbunden als ${b.username} mit ${config.host}.`);
      for (const cmd of config.joinCommands) await command(cmd).catch(() => {});
      if (config.joinCommands.length) await sleep(3000);
      await exclusive(async () => {
        try {
          settle(await readBalance());
        } catch (err) {
          logger.warn('Minecraft: Kontostand beim Start:', err.message);
        }
      });
      flushOutbox();
      heartbeat();
    });

    b.on('whisper', (name, message) => {
      // Nur echte Minecraft-Namen: der Name landet im /msg-Befehl.
      if (!/^[A-Za-z0-9_]{3,16}$/.test(String(name)) || name === b.username) return;
      if (/^(?:login|anmelden)$/i.test(String(message).trim())) onLoginRequest(name);
    });

    b.on('messagestr', (message, position) => {
      // Spieler-Chat wird nie ausgewertet.
      if (position === 'system') onSystemMessage(message);
    });

    b.on('kicked', (reason) => {
      state.lastError = `Gekickt: ${plain(reason)}`;
      notify('system', { title: 'Minecraft: Vom Server getrennt', description: state.lastError }, 'kicked', 30 * 60_000);
    });
    b.on('error', (err) => {
      state.lastError = err.message;
      logger.warn('Minecraft:', err.message);
    });
    b.once('end', (reason) => {
      state.online = false;
      state.connecting = false;
      if (bot === b) bot = null;
      if (balanceWaiter) balanceWaiter = null;
      heartbeat();
      logger.warn(`Minecraft: Verbindung beendet (${plain(reason)}).`);
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectTimer.unref?.();
    reconnectDelay = Math.min(reconnectDelay * 2, 5 * 60_000);
  }

  const intervals = [];
  function start() {
    // Nach einem Absturz mitten in einer Auszahlung: nie erneut zahlen, sondern melden.
    for (const p of Object.values(db.payouts)) {
      if (p.state !== 'sending') continue;
      p.state = 'uncertain';
      api.failPayout(p.id, { reason: 'Bot-Neustart während der Auszahlung – bitte prüfen', uncertain: true }).catch(() => {});
      notify('audit', { title: 'Minecraft: Auszahlung unklar', description: `**${p.minecraftName}** · ${formatAmount(p.amount)}: Neustart während der Auszahlung. Wird nicht wiederholt – bitte im Spiel prüfen.` });
    }
    persisted.save();
    connect();
    intervals.push(setInterval(() => flushOutbox(), 60_000));
    intervals.push(setInterval(() => heartbeat(), 60_000));
    intervals.push(setInterval(() => syncLinks(), 5 * 60_000));
    intervals.push(setInterval(() => payoutTick().catch((err) => logger.warn('Auszahlungen:', err.message)), config.payoutIntervalSeconds * 1000));
    for (const i of intervals) i.unref?.();
  }

  function stop() {
    stopped = true;
    intervals.forEach(clearInterval);
    clearTimeout(reconnectTimer);
    clearTimeout(settleTimer);
    try {
      bot?.quit();
    } catch {
      // egal
    }
    persisted.flush();
  }

  // --- Kontoverknüpfung ---------------------------------------------------

  /** Schickt den Code im Spiel. Ergebnis: { player } oder { error, retryAfterMs }. */
  async function sendLinkCode(discordId, name) {
    if (!state.online) return { error: 'offline_bot' };
    const player = findPlayer(name);
    if (!player) return { error: 'not_online' };
    const taken = Object.entries(db.links).find(([id, l]) => id !== discordId && l.uuid === player.uuid);
    if (taken) return { error: 'taken' };
    const res = codes.create(discordId, player);
    if (res.retryAfterMs) return { error: 'cooldown', retryAfterMs: res.retryAfterMs };
    try {
      await command(fill(config.whisperCommand, { name: player.username, text: `Dein HugoPredict-Code: ${res.code} - gib ihn in Discord ein. Niemals weitergeben!` }));
    } catch {
      return { error: 'offline_bot' };
    }
    return { player };
  }

  const confirmLinkCode = (discordId, code) => codes.verify(discordId, code);
  const hasPendingCode = (discordId) => codes.pending(discordId);

  /** Speichert die Verknüpfung lokal; die Website erhält sie sofort oder später. */
  async function saveLink({ discordId, discordUsername, player }) {
    db.links[discordId] = { name: player.username, uuid: player.uuid, discordUsername, linkedAt: new Date().toISOString(), synced: false };
    persisted.flush();
    if (!api.configured) return { synced: false };
    await api.linkMinecraftAccount({ discordId, discordUsername, minecraftName: player.username, minecraftUuid: player.uuid });
    db.links[discordId].synced = true;
    persisted.save();
    return { synced: true };
  }

  const forgetLink = (discordId) => {
    delete db.links[discordId];
    persisted.save();
  };

  async function syncLinks() {
    if (!api.configured) return;
    for (const [discordId, l] of Object.entries(db.links)) {
      if (l.synced) continue;
      try {
        await api.linkMinecraftAccount({ discordId, discordUsername: l.discordUsername, minecraftName: l.name, minecraftUuid: l.uuid });
        l.synced = true;
        persisted.save();
      } catch (err) {
        notify('system', { title: 'Minecraft: Verknüpfung nicht übertragen', description: `<@${discordId}> ↔ ${l.name}: ${userMessage(err)}` }, `link:${discordId}`, 60 * 60_000);
      }
    }
  }


  // --- Panel: Befehle von Hand -------------------------------------------

  // Befehle, nach denen sich der Kontostand ändern kann – danach wird er neu gelesen,
  // damit spätere Einzahlungen weiter richtig geprüft werden.
  const MONEY_COMMAND = /^\/?(?:pay|money|eco|bal|balance|bank|withdraw|deposit|sell|buy|shop|ah|auction|trade)\b/i;

  /**
   * Führt einen Befehl über den Bot aus (nur /panel) und liefert die Serverantwort.
   * Ergebnis: { lines, balance } oder { error }.
   */
  function runCommand(text, { waitMs = commandWaitMs } = {}) {
    const cmd = String(text ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (!cmd) return Promise.resolve({ error: 'empty' });
    if (cmd.length > 256) return Promise.resolve({ error: 'too_long' });
    if (!state.online) return Promise.resolve({ error: 'offline_bot' });
    return exclusive(async () => {
      const moneyRelated = MONEY_COMMAND.test(cmd) && config.balanceCheck !== false;
      // Offene Einzahlungen zuerst abschließen, sonst würde die eigene Zahlung sie verfälschen.
      if (moneyRelated && claims.length) {
        try {
          settle(await readBalance());
        } catch {
          // dann eben ohne
        }
      }
      const lines = [];
      captures.add(lines);
      try {
        await command(cmd);
        await sleep(waitMs);
      } catch {
        return { error: 'offline_bot' };
      } finally {
        captures.delete(lines);
      }
      let balance = db.lastBalance;
      if (moneyRelated && /^\/?(?:bal|balance)\b/i.test(cmd)) {
        // Antwort auf /balance gleich als Kontostand übernehmen
        for (const line of lines) {
          const g = matchFirst(patterns.balance, line);
          const value = g && parseAmount(g.amount, { allowZero: true });
          if (value !== null && value !== undefined && g) {
            settle(value);
            balance = value;
            break;
          }
        }
      } else if (moneyRelated) {
        try {
          const after = await readBalance();
          if (claims.length) settle(after);
          else setBalance(after);
          balance = after;
        } catch {
          // Kontostand bleibt der letzte bekannte
        }
      }
      return { lines, balance };
    });
  }

  /** /pay über das Panel. Ergebnis wie runCommand, oder { error: 'bad_name'|'bad_amount' }. */
  async function pay(name, amountText) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(String(name))) return { error: 'bad_name' };
    const amount = parseAmount(amountText);
    if (amount === null || amount === undefined) return { error: 'bad_amount' };
    const vars = { name, amount: commandAmount(amount) };
    const res = await runCommand(fill(config.payCommand, vars));
    if (res.error || !config.payConfirmCommand) return { ...res, amount };
    const confirm = await runCommand(fill(config.payConfirmCommand, vars));
    return { ...confirm, lines: [...res.lines, ...(confirm.lines ?? [])], amount };
  }

  const info = () => ({
    online: state.online,
    connecting: state.connecting,
    since: state.since,
    lastError: state.lastError,
    username: bot?.username ?? null,
    host: config.host,
    balance: db.lastBalance,
    players: bot?.players ? Object.keys(bot.players).length : null,
    recent: [...recentSystem],
  });

  return {
    enabled: true,
    state,
    info,
    runCommand,
    pay,
    start,
    stop,
    sendLinkCode,
    confirmLinkCode,
    hasPendingCode,
    saveLink,
    forgetLink,
    links: () => db.links,
    // für Tests
    _internal: { onSystemMessage, payoutTick, flushOutbox, db, exclusive },
  };
}

module.exports = { createMinecraftService, fill };

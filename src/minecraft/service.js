'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Store } = require('../lib/store');
const { ApiError, userMessage } = require('../lib/hugoApi');
const { parseAmount, commandAmount, formatAmount } = require('./amount');
const { buildPatterns, matchFirst, LOOKS_LIKE_PAYMENT } = require('./patterns');
const { reconcile, payoutMatches } = require('./ledger');

/*
 * Minecraft-Bot auf HugoSMP (Mineflayer).
 *
 * - Kontoverknüpfung: Der Bot flüstert dem Spieler einen Code zu, der in
 *   Discord eingegeben wird.
 * - Einzahlungen: Spieler zahlen per /pay an den Bot. Gutgeschrieben wird nur,
 *   was der Kontostand des Bots tatsächlich bestätigt; die Website rechnet in
 *   Guthaben um (1:1 in $).
 * - Auszahlungen (optional): vom Team auf der Website freigegebene Beträge
 *   zahlt der Bot per /pay aus und prüft das Ergebnis am Kontostand.
 *
 * Geldbewegungen laufen strikt nacheinander. Meldungen an die Website, die
 * nicht sofort klappen, liegen in data/minecraft.json und werden wiederholt.
 */

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (all, k) => (vars[k] === undefined ? all : String(vars[k])));
const plain = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')).slice(0, 300);

/**
 * UUID eines Minecraft-Namens bei Mojang nachschlagen. Nötig, weil HugoSMP mehrere
 * Unterserver hat: /msg geht serverübergreifend, die Spielerliste des Bots zeigt
 * aber nur Spieler auf seinem eigenen Unterserver.
 */
async function mojangUuid(name) {
  const urls = [
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const body = await res.json();
      const id = String(body?.id ?? '').replace(/-/g, '');
      if (/^[0-9a-f]{32}$/i.test(id)) {
        return { username: body.name || name, uuid: id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5').toLowerCase() };
      }
    } catch {
      // nächste Quelle
    }
  }
  return null;
}

function createMinecraftService({ config: baseConfig, api, logger, report, dataDir, createBot, chatDelayMs = 1100, settleMs = 1500, payoutCheckMs = 2500, reconnectMs = 15_000, commandWaitMs = 2500, spawnDelayMs = 5000, balanceTimeoutMs = 6000, lookupUuid = mojangUuid }) {
  const persisted = new Store(dataDir, { fileName: 'minecraft.json' });
  const db = (persisted.data.minecraft ??= { outbox: {}, payouts: {}, links: {}, lastBalance: null });
  // Im /panel geänderte Einstellungen gelten vor der .env und bleiben nach Neustarts erhalten.
  db.settings ??= {};
  const config = { ...baseConfig, ...pickSettings(db.settings) };
  const patterns = buildPatterns(config);
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
  // Diagnose: rohe Systemnachrichten (vor mineflayer) vs. gelesene – zeigt, ob Nachrichten verloren gehen.
  const stats = { raw: 0, parsed: 0, lastRawAt: null, lastParsedAt: null };
  const rawRecent = [];
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

  // Ein zweiter Versuch, bevor gemeldet wird: Direkt nach dem Verbinden oder bei viel Chat
  // geht eine Antwort manchmal unter.
  function readBalance(timeoutMs = balanceTimeoutMs, attempt = 1) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        balanceWaiter = null;
        if (attempt === 1) {
          readBalance(timeoutMs, 2).then(resolve, reject);
          return;
        }
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
            ? `${formatAmount(d.amount)} erhalten${res.credited !== null ? ` – ${formatAmount(res.credited)} $ gutgeschrieben` : ''}. Danke!`
            : `${formatAmount(d.amount)} erhalten. Melde dich auf der Website an oder verknüpfe dein Konto im Discord, dann wird es gutgeschrieben.`);
          notify('audit', {
            title: 'Minecraft: Einzahlung',
            fields: [
              { name: 'Spieler', value: d.minecraftName, inline: true },
              { name: 'Betrag', value: formatAmount(d.amount), inline: true },
              { name: 'Gutschrift', value: res.credited !== null ? `${formatAmount(res.credited)} $` : res.linked ? 'laut Website' : 'nach Verknüpfung', inline: true },
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
    // Ohne Kontostand-Prüfung: sofort zahlen, Erfolg an der Antwort des Servers erkennen
    if (!config.balanceCheck) return executePayoutFast(p);
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

  // Antwort des Servers auf /pay: Fehler (nichts überwiesen) oder Erfolg (Name des Empfängers + „gesendet“ o. Ä.)
  const PAY_FAILED = /(nicht genug|zu wenig|nicht gefunden|nicht online|kein spieler|ungültig|existiert nicht|kannst nicht|nicht möglich|not enough|insufficient|cannot|can't|unknown player|player not found)/i;
  const PAY_OK = /(gesendet|überwiesen|gezahlt|bezahlt|geschickt|gegeben|sent|paid|transferred)/i;

  /** Schnelle Auszahlung ohne /balance: ca. 1–2 Sekunden. Nie doppelt, Unklares wird gemeldet. */
  async function executePayoutFast(p) {
    if (db.lastBalance !== null && db.lastBalance < p.amount) {
      await api.failPayout(p.id, { reason: 'Guthaben des Bots reicht nicht' }).catch(() => {});
      notify('audit', { title: 'Minecraft: Auszahlung nicht möglich', description: `**${p.minecraftName}** · ${formatAmount(p.amount)}: Der Bot hat nur ${formatAmount(db.lastBalance)}.` });
      return;
    }
    db.payouts[p.id] = { ...p, startedAt: new Date().toISOString(), state: 'sending' };
    persisted.flush(); // vor dem Senden sichern: nach einem Absturz wird nie doppelt gezahlt
    const vars = { name: p.minecraftName, amount: commandAmount(p.amount) };
    const lines = [];
    captures.add(lines);
    let verdict = null;
    try {
      await command(fill(config.payCommand, vars));
      if (config.payConfirmCommand) await command(fill(config.payConfirmCommand, vars));
      const name = p.minecraftName.toLowerCase();
      for (let waited = 0; waited < payoutCheckMs && !verdict; waited += 100) {
        for (const l of lines) {
          if (PLAYER_CHAT.test(l) && !/^\[HugoSMP\]/i.test(l)) continue; // Spieler-Chat zählt nie
          if (PAY_FAILED.test(l)) { verdict = { ok: false, line: l }; break; }
          if (PAY_OK.test(l) && l.toLowerCase().includes(name)) { verdict = { ok: true, line: l }; break; }
        }
        if (!verdict) await sleep(100);
      }
    } catch {
      verdict = null;
    } finally {
      captures.delete(lines);
    }
    if (verdict?.ok === false) {
      // Server hat abgelehnt → nichts überwiesen → Betrag zurück an den Spieler
      db.payouts[p.id].state = 'failed';
      persisted.flush();
      await api.failPayout(p.id, { reason: `Im Spiel abgelehnt: ${verdict.line.slice(0, 150)}` }).catch(() => {});
      notify('audit', { title: 'Minecraft: Auszahlung abgelehnt', description: `**${p.minecraftName}** · ${formatAmount(p.amount)}\n\`${verdict.line.slice(0, 200)}\`` });
      return;
    }
    if (!verdict) {
      db.payouts[p.id].state = 'uncertain';
      persisted.flush();
      await api.failPayout(p.id, { reason: 'Keine Bestätigung vom Server – bitte im Spiel prüfen', uncertain: true }).catch(() => {});
      notify('audit', { title: 'Minecraft: Auszahlung unklar', description: `**${p.minecraftName}** · ${formatAmount(p.amount)}: Der Server hat /pay nicht bestätigt. Wird nicht wiederholt – bitte im Spiel prüfen (/money log).` });
      return;
    }
    if (db.lastBalance !== null) setBalance(db.lastBalance - p.amount);
    db.payouts[p.id].state = 'paid';
    db.payouts[p.id].paidAt = new Date().toISOString();
    persisted.flush();
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
    if (!config.payoutsEnabled || !state.online || !api.configured || (config.balanceCheck && db.lastBalance === null)) return;
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
    // Eigenes Echo einer /msg („[Nachricht] Du -> …“) ist keine Zahlung – kein Fehlalarm.
    if (/^\[Nachricht\] Du -> /.test(line)) return;
    const whispered = matchFirst(patterns.whisper, line);
    if (whispered) {
      onWhisper(whispered.name, whispered.message);
      return;
    }
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
      if (!config.balanceCheck) {
        // MC_BALANCE_CHECK=false: Nachricht gilt direkt, der bekannte Kontostand wird mitgeführt.
        if (db.lastBalance !== null) setBalance(db.lastBalance + amount);
        queueDeposit(claim);
        return;
      }
      claims.push(claim);
      scheduleSettle();
      return;
    }
    // Nur echte Servermeldungen („[HugoSMP] …“). Clan-Chat („[TAG] Name: …“) und Spieler-Chat
    // kommen hier teils auch als Systemnachricht an und sind nie eine Zahlung.
    if (LOOKS_LIKE_PAYMENT.test(line) && /\d/.test(line) && /^\[HugoSMP\]/i.test(line)) {
      notify('system', {
        title: 'Minecraft: Nachricht nicht erkannt',
        description: `Sieht nach einer Zahlung aus, passt aber zu keinem Muster:\n\`${line.slice(0, 300)}\`\nGgf. MC_PAY_PATTERN anpassen.`,
      }, 'unrecognized', 10 * 60_000);
    }
  }

  // --- Website ------------------------------------------------------------

  // Der Absender ist nur am Text erkannt: Das Muster muss so genau sein, dass Spieler-Chat nie passt.
  // Die Antwort geht an den genannten Spieler, damit er eine fremde Anmeldung in seinem Namen bemerkt.
  const loginTries = new Map();
  async function onWhisper(name, message) {
    // Nur echte Minecraft-Namen: der Name landet im /msg-Befehl.
    if (!/^[A-Za-z0-9_]{3,16}$/.test(String(name)) || name === bot?.username) return;
    const text = String(message).trim();
    if (/^(?:login|anmelden)$/i.test(text)) {
      whisper(name, 'Oeffne die Website und klicke auf Anmelden. Dort steht dein persoenlicher Befehl.');
      return;
    }
    if (!/^[a-z0-9]{5,12}$/i.test(text)) return;
    // Höchstens 5 Code-Versuche pro Minute und Spieler
    const key = name.toLowerCase();
    const recent = (loginTries.get(key) ?? []).filter((t) => Date.now() - t < 60_000);
    if (recent.length >= 5) return;
    loginTries.set(key, [...recent, Date.now()]);
    // Discord-Codes werden hier geprüft, alles andere geht an die Website.
    if (await tryDiscordCode(name, text)) return;
    if (!api.configured) {
      logger.warn('Minecraft: Login-Code erhalten, aber die Website ist nicht eingerichtet (HUGO_API_URL, HUGO_API_KEY).');
      whisper(name, 'Die Anmeldung ist gerade nicht moeglich.');
      return;
    }
    try {
      const ok = await api.confirmLogin({ minecraftName: name, code: text });
      whisper(name, ok
        ? 'Du bist auf der Website angemeldet. Warst du das nicht? Melde dich sofort beim Team.'
        : 'Code ungueltig oder abgelaufen. Hol dir auf der Website einen neuen.');
      if (ok) Promise.resolve(onWebsiteLogin?.({ minecraftName: name })).catch((err) => logger.warn('Website-Anmeldung in Discord:', err.message));
    } catch (err) {
      whisper(name, userMessage(err));
    }
  }

  async function refreshBalance() {
    if (!state.online) return;
    await exclusive(async () => {
      const value = await readBalance();
      if (config.balanceCheck) settle(value);
      else setBalance(value);
    });
  }

  async function heartbeat() {
    if (!api.configured) return;
    try {
      await api.minecraftHeartbeat({ online: state.online, username: bot?.username ?? null, balance: db.lastBalance });
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
      // Ohne Kontostand-Prüfung (Standard) wird /balance beim Start nicht gebraucht.
      // Kurz warten: Direkt nach dem Joinen beantwortet der Server Befehle nicht zuverlässig.
      if (config.balanceCheck) await sleep(spawnDelayMs);
      if (config.balanceCheck) await exclusive(async () => {
        try {
          settle(await readBalance());
        } catch (err) {
          logger.warn('Minecraft: Kontostand beim Start:', err.message);
        }
      });
      flushOutbox();
      heartbeat();
      // Ohne Prüfung wurde noch kein Kontostand gelesen: einmal nachholen (für die Deckungsanzeige)
      if (!config.balanceCheck) setTimeout(() => refreshBalance().then(heartbeat).catch(() => {}), spawnDelayMs).unref?.();
    });

    // Kein mineflayer-„whisper“-Ereignis: dessen Muster passen nicht zu HugoSMP. Flüstern
    // wird nur über das genaue Muster in onSystemMessage erkannt (siehe patterns.js).

    // Systemnachrichten direkt aus dem Paket lesen: mineflayer verliert bei HugoSMP den Text
    // nach dem Tag (aus „[HugoSMP] Dein Kontostand: …“ wird nur „[HugoSMP]“).
    const rawSystem = typeof b._client?.on === 'function';
    if (rawSystem) {
      b._client.on('system_chat', (packet) => {
        stats.raw++;
        stats.lastRawAt = new Date();
        const text = componentText(packet?.content).replace(/\s+/g, ' ').trim();
        if (!text) return;
        rawRecent.push(`${packet.isActionBar ? '(Actionbar) ' : ''}${text}`.slice(0, 300));
        if (rawRecent.length > 15) rawRecent.shift();
        if (packet.isActionBar) return;
        for (const c of captures) if (c.length < 20) c.push(text.slice(0, 300));
        onSystemMessage(text);
      });
    }

    b.on('messagestr', (message, position) => {
      if (position === 'system' || position === 'game_info') {
        stats.parsed++;
        stats.lastParsedAt = new Date();
      }
      // Systemzeilen kommen schon aus dem Paket (siehe oben).
      if (rawSystem && position === 'system') return;
      // Für /panel alles mitschreiben, auch Nicht-Systemzeilen (mit Kennzeichnung) – nur zur Anzeige.
      const shown = String(message).trim();
      if (shown && captures.size) {
        const tagged = position === 'system' ? shown : `(${position}) ${shown}`;
        for (const c of captures) if (c.length < 20) c.push(tagged.slice(0, 300));
      }
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
    // Alle 10 Minuten den Kontostand auffrischen (Deckungsanzeige auf der Website)
    intervals.push(setInterval(() => refreshBalance().catch(() => {}), 10 * 60_000));
    // Alle 20 s: Nach einem Website-Neustart (z. B. Update) steht sie so höchstens kurz auf „offline“.
    intervals.push(setInterval(() => heartbeat(), 20_000));
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

  // --- Verknüpfung per /msg: Discord zeigt einen Code, der Spieler flüstert ihn dem Bot ---
  const DISCORD_CODE_TTL = 30 * 60_000; // 30 Minuten: Zeit genug, um ins Spiel zu wechseln
  const DISCORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const discordCodes = new Map(); // code → { discordId, discordUsername, createdAt }
  let onDiscordLinked = null;
  let onWebsiteLogin = null;

  /** Neuer Code für eine Discord-ID (ersetzt einen älteren). Ergebnis: { code, expiresAt }. */
  function startDiscordLink(discordId, discordUsername, discordAvatar = null) {
    for (const [c, e] of discordCodes) if (e.discordId === discordId || Date.now() - e.createdAt > DISCORD_CODE_TTL) discordCodes.delete(c);
    let code;
    do {
      code = Array.from(crypto.randomBytes(5), (b) => DISCORD_ALPHABET[b % DISCORD_ALPHABET.length]).join('');
    } while (discordCodes.has(code));
    discordCodes.set(code, { discordId, discordUsername, discordAvatar, createdAt: Date.now() });
    return { code, expiresAt: new Date(Date.now() + DISCORD_CODE_TTL) };
  }

  /** Wird aufgerufen, wenn ein Spieler einen Discord-Code geflüstert hat. true = es war ein Discord-Code. */
  async function tryDiscordCode(name, text) {
    const code = text.toUpperCase();
    const entry = discordCodes.get(code);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > DISCORD_CODE_TTL) {
      discordCodes.delete(code);
      whisper(name, 'Der Code ist abgelaufen. Hol dir in Discord einen neuen.');
      return true;
    }
    // Spieler auf einem anderen Unterserver stehen nicht in der Spielerliste → UUID bei Mojang
    const player = findPlayer(name) ?? await lookupUuid(name).catch(() => null);
    if (!player?.uuid) {
      // Code bleibt gültig, damit ein zweiter Versuch klappt
      logger.warn(`Verknüpfung: UUID für ${name} nicht gefunden.`);
      whisper(name, 'Das hat nicht geklappt, bitte versuch es gleich nochmal.');
      return true;
    }
    discordCodes.delete(code);
    const taken = Object.entries(db.links).find(([id, l]) => id !== entry.discordId && l.uuid === player.uuid);
    if (taken) {
      whisper(name, 'Dieses Minecraft-Konto ist schon mit einem anderen Discord-Konto verknuepft. Melde dich im Support.');
      return true;
    }
    let synced = false;
    try {
      ({ synced } = await saveLink({ discordId: entry.discordId, discordUsername: entry.discordUsername, discordAvatar: entry.discordAvatar, player }));
    } catch (err) {
      logger.warn('Verknüpfung an die Website:', err.message);
    }
    whisper(name, 'Dein Discord-Konto ist jetzt mit HugoPredict verknuepft.');
    try {
      await onDiscordLinked?.({ discordId: entry.discordId, player, synced });
    } catch (err) {
      logger.warn('Verknüpfung in Discord:', err.message);
    }
    return true;
  }


  /** Speichert die Verknüpfung lokal; die Website erhält sie sofort oder später. */
  async function saveLink({ discordId, discordUsername, discordAvatar = null, player }) {
    db.links[discordId] = { name: player.username, uuid: player.uuid, discordUsername, avatar: discordAvatar, linkedAt: new Date().toISOString(), synced: false };
    persisted.flush();
    if (!api.configured) return { synced: false };
    await api.linkMinecraftAccount({ discordId, discordUsername, discordAvatar, minecraftName: player.username, minecraftUuid: player.uuid });
    db.links[discordId].synced = true;
    persisted.save();
    return { synced: true };
  }

  /** Profilbilder bestehender Verknüpfungen nachtragen bzw. aktualisieren (z. B. nach dem Start). */
  async function refreshAvatars(fetchAvatar) {
    let changed = 0;
    for (const [discordId, l] of Object.entries(db.links)) {
      const url = await Promise.resolve(fetchAvatar(discordId)).catch(() => null);
      if (url && url !== l.avatar) {
        l.avatar = url;
        l.synced = false;
        changed += 1;
      }
    }
    if (changed) {
      persisted.save();
      await syncLinks();
    }
    return changed;
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
        await api.linkMinecraftAccount({ discordId, discordUsername: l.discordUsername, discordAvatar: l.avatar ?? null, minecraftName: l.name, minecraftUuid: l.uuid });
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
      // Nach Geld-Befehlen den Kontostand neu lesen – auch ohne Kontostand-Prüfung, damit die
      // Anzeige stimmt. Mit Prüfung werden offene Einzahlungen dabei abgeglichen.
      const moneyRelated = MONEY_COMMAND.test(cmd);
      const adopt = (value) => (config.balanceCheck ? settle(value) : setBalance(value));
      // Offene Einzahlungen zuerst abschließen, sonst würde die eigene Zahlung sie verfälschen.
      if (moneyRelated && config.balanceCheck && claims.length) {
        try {
          settle(await readBalance());
        } catch {
          // dann eben ohne
        }
      }
      const lines = [];
      captures.add(lines);
      const before = { ...stats };
      try {
        await command(cmd);
        await sleep(waitMs);
      } catch {
        return { error: 'offline_bot' };
      } finally {
        captures.delete(lines);
      }
      const received = { raw: stats.raw - before.raw, parsed: stats.parsed - before.parsed };
      let balance = db.lastBalance;
      if (moneyRelated && /^\/?(?:bal|balance)\b/i.test(cmd)) {
        // Antwort auf /balance gleich als Kontostand übernehmen
        for (const line of lines) {
          const g = matchFirst(patterns.balance, line);
          const value = g && parseAmount(g.amount, { allowZero: true });
          if (value !== null && value !== undefined && g) {
            adopt(value);
            balance = value;
            break;
          }
        }
      } else if (moneyRelated) {
        try {
          const after = await readBalance();
          if (config.balanceCheck && claims.length) settle(after);
          else setBalance(after);
          balance = after;
        } catch {
          // Kontostand bleibt der letzte bekannte
        }
      }
      return { lines, balance, received };
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

  /** Ändert eine Einstellung aus /panel. Ergebnis: { ok, note? } oder { error }. */
  function setSetting(key, value) {
    const check = SETTINGS[key];
    if (!check) return { error: 'Unbekannte Einstellung.' };
    const err = check(value, config);
    if (err) return { error: err };
    db.settings[key] = value;
    config[key] = value;
    const note = null;
    persisted.flush();
    return { ok: true, note };
  }

  /** Trennt und verbindet neu (z. B. nach geänderten Join-Befehlen). */
  function reconnect() {
    if (bot) {
      try {
        bot.quit();
      } catch {
        // egal
      }
    } else {
      connect();
    }
  }

  const settings = () => ({
    balanceCheck: Boolean(config.balanceCheck),
    payoutsEnabled: Boolean(config.payoutsEnabled),
    payoutMax: config.payoutMax ?? 0,
    joinCommands: [...(config.joinCommands ?? [])],
    changed: Object.keys(db.settings),
  });

  const info = () => ({
    online: state.online,
    connecting: state.connecting,
    since: state.since,
    lastError: state.lastError,
    username: bot?.username ?? null,
    host: config.host,
    balance: db.lastBalance,
    balanceCheck: Boolean(config.balanceCheck),
    players: bot?.players ? Object.keys(bot.players).length : null,
    recent: [...recentSystem],
    rawRecent: [...rawRecent],
    stats: { ...stats },
  });

  return {
    enabled: true,
    state,
    info,
    runCommand,
    pay,
    settings,
    setSetting,
    reconnect,
    start,
    stop,
    startDiscordLink,
    refreshAvatars,
    setDiscordLinkHandler: (fn) => { onDiscordLinked = fn; },
    setWebsiteLoginHandler: (fn) => { onWebsiteLogin = fn; },
    saveLink,
    forgetLink,
    links: () => db.links,
    // für Tests
    _internal: { onSystemMessage, payoutTick, flushOutbox, db, exclusive },
  };
}

/** Klartext aus einer Chat-Komponente (JSON-Text, Objekt oder NBT). */
function componentText(content) {
  let c = content;
  try {
    if (c && typeof c === 'object' && 'type' in c && 'value' in c) c = JSON.parse(require('prismarine-chat').processNbtMessage(c));
    else if (typeof c === 'string' && /^[[{"]/.test(c.trim())) c = JSON.parse(c);
  } catch {
    return typeof content === 'string' ? content : '';
  }
  const walk = (x) => {
    if (x === null || x === undefined) return '';
    if (typeof x === 'string' || typeof x === 'number') return String(x);
    if (Array.isArray(x)) return x.map(walk).join('');
    let out = x.text ?? x[''] ?? '';
    if (x.translate) out += x.with ? `${x.translate} ${x.with.map(walk).join(' ')}` : x.translate;
    if (x.extra) out += x.extra.map(walk).join('');
    return String(out);
  };
  return walk(c).replace(/§[0-9a-fk-or]/gi, '');
}

// Einstellungen, die /panel ändern darf, mit Prüfung (Rückgabe: Fehlertext oder null).
const SETTINGS = {
  balanceCheck: (v) => (typeof v === 'boolean' ? null : 'Ungültiger Wert.'),
  payoutsEnabled: (v, cfg) => {
    if (typeof v !== 'boolean') return 'Ungültiger Wert.';
    if (v && !(cfg.payoutMax > 0)) return 'Erst ein Auszahlungs-Limit setzen.';
    return null;
  },
  payoutMax: (v) => (Number.isFinite(v) && v > 0 && v <= 1e12 ? null : 'Das Limit muss eine Zahl über 0 sein.'),
  joinCommands: (v) => {
    if (!Array.isArray(v) || v.length > 5) return 'Höchstens 5 Join-Befehle.';
    if (v.some((c) => typeof c !== 'string' || !c.startsWith('/') || c.length > 100 || /[\r\n]/.test(c))) return 'Jeder Join-Befehl beginnt mit / und ist höchstens 100 Zeichen lang.';
    return null;
  },
};
const pickSettings = (saved) => Object.fromEntries(Object.entries(saved ?? {}).filter(([k, v]) => SETTINGS[k] && !SETTINGS[k](v, { balanceCheck: true, payoutMax: saved.payoutMax ?? 1 })));

module.exports = { createMinecraftService, fill, SETTINGS, componentText };

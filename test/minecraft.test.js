'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { parseAmount } = require('../src/minecraft/amount');
const { buildPatterns, matchFirst } = require('../src/minecraft/patterns');
const { reconcile } = require('../src/minecraft/ledger');
const { LinkCodes } = require('../src/minecraft/linkCodes');
const { createMinecraftService } = require('../src/minecraft/service');

test('Beträge: 15k, Tausenderpunkte, Kommas, Währungszeichen', () => {
  const cases = { '15k': 15000, '15.000': 15000, '15,000': 15000, '$15,000.50': 15000.5, '15.000,50': 15000.5, '1,5k': 1500, '2,5 Mio': 2500000, '15000$': 15000, '1.000.000': 1000000, '1.5': 1.5 };
  for (const [raw, want] of Object.entries(cases)) assert.equal(parseAmount(raw), want, raw);
  for (const raw of ['abc', '', '0', '-5', '1.000.00']) assert.equal(parseAmount(raw), null, raw);
  assert.equal(parseAmount('0', { allowZero: true }), 0);
});

test('Zahlungsmuster erkennen Systemnachrichten, aber keine nachgeahmten Chat-Zeilen', () => {
  const { pay, balance } = buildPatterns();
  const hit = (t) => matchFirst(pay, t);
  assert.deepEqual({ ...hit('$15,000 has been received from Steve.') }, { amount: '$15,000', name: 'Steve' });
  assert.equal(hit('[Money] 15.000$ wurden von Steve erhalten.').name, 'Steve');
  assert.equal(hit('Du hast 15k von Alex_99 erhalten!').amount, '15k');
  assert.equal(hit('Steve hat dir 500 gezahlt.').name, 'Steve');
  // Echtes HugoSMP-Format (Screenshot)
  const hugo = hit('[HugoSMP] Du hast $1.000 von Reschoo erhalten.');
  assert.equal(hugo.name, 'Reschoo');
  assert.equal(parseAmount(hugo.amount), 1000);
  assert.equal(parseAmount(matchFirst(balance, '[HugoSMP] Dein Kontostand: $1.000').amount), 1000);
  // Chat-Formate „Name: …“ oder „[Rang] Name » …“ dürfen nicht passen.
  assert.equal(hit('Hacker: $15,000 has been received from Hacker.'), null);
  assert.equal(hit('[VIP] Hacker » $15,000 has been received from Hacker.'), null);
  assert.equal(hit('<Hacker> Du hast 15k von Hacker erhalten'), null);
  assert.equal(matchFirst(balance, 'Kontostand: 1.250$').amount, '1.250$');
  assert.equal(matchFirst(balance, 'Balance: $0').amount, '$0');
  assert.throws(() => buildPatterns({ payPattern: '(?<amount>\\d+)' }), /name/);
});

test('reconcile: nur gedeckte Zahlungen zählen', () => {
  const a = { name: 'A', amount: 100 };
  const b = { name: 'B', amount: 50 };
  assert.deepEqual(reconcile([a, b], 150), { confirmed: [a, b], unconfirmed: [], surplus: 0, decreased: false });
  // Echte (A) und gefälschte (B) Zahlung zugleich: keine wird gutgeschrieben, beide gehen zur Prüfung
  const r = reconcile([b, a], 100);
  assert.deepEqual(r.confirmed, []);
  assert.deepEqual(r.unconfirmed, [b, a]);
  assert.equal(reconcile([a, b], 200).surplus, 50);
  assert.equal(reconcile([], 30).surplus, 30);
  assert.equal(reconcile([a], -10).decreased, true);
});

test('LinkCodes: Ablauf, Fehlversuche, Wartezeit', () => {
  let t = 0;
  const codes = new LinkCodes({ now: () => t, ttlMs: 1000, resendMs: 100, maxAttempts: 2 });
  const { code } = codes.create('1', { username: 'Steve' });
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.ok(codes.create('1', {}).retryAfterMs > 0);
  assert.deepEqual(codes.verify('1', code.toLowerCase()), { player: { username: 'Steve' } });
  assert.deepEqual(codes.verify('1', code), { error: 'missing' }, 'nur einmal gültig');
  t = 200;
  codes.create('1', { username: 'Steve' });
  assert.equal(codes.verify('1', 'XXXXXX').error, 'wrong');
  assert.equal(codes.verify('1', 'XXXXXX').error, 'locked');
  t = 400;
  codes.create('2', {});
  t = 2000;
  assert.equal(codes.verify('2', 'AAAAAA').error, 'expired');
});

// --- Dienst mit nachgebautem Minecraft-Server ------------------------------

function fakeWorld() {
  const world = { balance: 1000, sent: [], bots: [], payWorks: true };
  world.createBot = () => {
    const bot = new EventEmitter();
    bot.username = 'HugoPredict';
    bot.players = { Steve: { username: 'Steve', uuid: 'uuid-steve' } };
    bot.quit = () => bot.emit('end', 'quit');
    if (world.withClient) bot._client = new EventEmitter();
    bot.chat = (text) => {
      world.sent.push(text);
      if (text === '/balance') setImmediate(() => bot.emit('messagestr', `Kontostand: ${world.balance.toLocaleString('de-DE')}$`, 'system'));
      const pay = text.match(/^\/pay (\w+) (\d+)$/);
      if (pay && world.payWorks) world.balance -= Number(pay[2]);
    };
    world.bots.push(bot);
    setImmediate(() => bot.emit('spawn'));
    return bot;
  };
  return world;
}

function fakeApi() {
  const calls = { deposits: [], links: [], completed: [], failed: [] };
  return {
    calls,
    configured: true,
    payouts: [],
    reportDeposit: async (d) => { calls.deposits.push(d); return { linked: true, credited: d.amount / 10 }; },
    linkMinecraftAccount: async (l) => { calls.links.push(l); return { linked: true }; },
    listPayouts: async function () { return this.payouts; },
    completePayout: async (id) => { calls.completed.push(id); },
    failPayout: async (id, info) => { calls.failed.push({ id, ...info }); },
  };
}

const config = {
  host: 'hugosmp.test', port: 25565, account: 'bot@example.com', version: '', joinCommands: [],
  whisperCommand: '/msg {name} {text}', payCommand: '/pay {name} {amount}', payConfirmCommand: '', balanceCommand: '/balance',
  payPattern: '', balancePattern: '', balanceCheck: true, payoutsEnabled: true, payoutMax: 10000, payoutIntervalSeconds: 3600,
};

async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Zeitüberschreitung');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function setup(overrides = {}) {
  const world = fakeWorld();
  const api = fakeApi();
  const reports = [];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mc-'));
  const mc = createMinecraftService({
    config: { ...config, ...overrides }, api, dataDir, createBot: world.createBot, report: (route, e) => reports.push({ route, ...e }),
    logger: { info() {}, warn() {}, error() {} }, chatDelayMs: 0, settleMs: 5, payoutCheckMs: 5, commandWaitMs: 20,
  });
  return { world, api, reports, mc, dataDir };
}

test('Einzahlung zählt nur mit gestiegenem Kontostand', async (t) => {
  const { world, api, reports, mc } = setup();
  t.after(() => mc.stop());
  mc.start();
  await until(() => mc.state.online && mc._internal.db.lastBalance === 1000);
  const bot = world.bots[0];

  // Echte Zahlung: Kontostand steigt
  world.balance += 15000;
  bot.emit('messagestr', '$15,000 has been received from Steve.', 'system');
  await until(() => api.calls.deposits.length === 1);
  assert.equal(api.calls.deposits[0].amount, 15000);
  assert.equal(api.calls.deposits[0].minecraftUuid, 'uuid-steve');
  await until(() => world.sent.some((m) => m.startsWith('/msg Steve 15.000 erhalten')));

  // Gefälschte Zahlung: Kontostand unverändert → keine Gutschrift
  bot.emit('messagestr', '$5,000 has been received from Steve.', 'system');
  await until(() => reports.some((r) => r.title === 'Minecraft: Zahlung nicht bestätigt'));
  assert.equal(api.calls.deposits.length, 1);

  // Spieler-Chat wird ignoriert
  bot.emit('messagestr', '$5,000 has been received from Steve.', 'chat');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(api.calls.deposits.length, 1);
});

test('Einzahlung ohne Website wird vorgemerkt und später gemeldet', async (t) => {
  const { world, api, mc } = setup();
  t.after(() => mc.stop());
  api.configured = false;
  mc.start();
  await until(() => mc._internal.db.lastBalance === 1000);
  world.balance += 200;
  world.bots[0].emit('messagestr', 'Steve hat dir 200 gezahlt.', 'system');
  await until(() => Object.keys(mc._internal.db.outbox).length === 1);
  assert.equal(api.calls.deposits.length, 0);
  api.configured = true;
  await mc._internal.flushOutbox();
  assert.equal(api.calls.deposits.length, 1);
  assert.equal(Object.keys(mc._internal.db.outbox).length, 0);
});

test('Auszahlung: einmal zahlen, am Kontostand prüfen, nie doppelt', async (t) => {
  const { world, api, mc } = setup();
  t.after(() => mc.stop());
  mc.start();
  await until(() => mc._internal.db.lastBalance === 1000);
  api.payouts = [{ id: 'p1', minecraftName: 'Steve', amount: 400 }];
  await mc._internal.payoutTick();
  assert.equal(world.balance, 600);
  assert.deepEqual(api.calls.completed, ['p1']);
  await mc._internal.payoutTick();
  assert.equal(world.sent.filter((m) => m.startsWith('/pay')).length, 1, 'nicht doppelt');

  // Über dem Limit → abgelehnt, nichts gezahlt
  api.payouts = [{ id: 'p2', minecraftName: 'Steve', amount: 50000 }];
  await mc._internal.payoutTick();
  assert.equal(api.calls.failed[0].id, 'p2');
  assert.equal(world.balance, 600);
});

test('Auszahlung ohne sichtbare Wirkung wird als unklar gemeldet und nicht wiederholt', async (t) => {
  const { world, api, reports, mc } = setup();
  t.after(() => mc.stop());
  mc.start();
  await until(() => mc._internal.db.lastBalance === 1000);
  world.payWorks = false;
  api.payouts = [{ id: 'p3', minecraftName: 'Steve', amount: 100 }];
  await mc._internal.payoutTick();
  await mc._internal.payoutTick();
  assert.deepEqual(api.calls.failed.map((f) => [f.id, f.uncertain]), [['p3', true]]);
  assert.equal(world.sent.filter((m) => m.startsWith('/pay')).length, 1);
  assert.ok(reports.some((r) => r.title === 'Minecraft: Auszahlung unklar'));
});

test('Kontoverknüpfung: Code nur an Spieler, die online sind', async (t) => {
  const { world, api, mc } = setup();
  t.after(() => mc.stop());
  mc.start();
  await until(() => mc.state.online);
  assert.deepEqual(await mc.sendLinkCode('111111111111111111', 'Notch'), { error: 'not_online' });
  const res = await mc.sendLinkCode('111111111111111111', 'steve');
  assert.equal(res.player.username, 'Steve');
  const msg = world.sent.find((m) => m.startsWith('/msg Steve Dein HugoPredict-Code:'));
  const code = msg.match(/Code: ([A-Z2-9]{6})/)[1];
  assert.equal(mc.confirmLinkCode('111111111111111111', 'FALSCH').error, 'wrong');
  const ok = mc.confirmLinkCode('111111111111111111', code);
  assert.equal(ok.player.uuid, 'uuid-steve');
  assert.deepEqual(await mc.saveLink({ discordId: '111111111111111111', discordUsername: 'steve', player: ok.player }), { synced: true });
  assert.equal(api.calls.links[0].minecraftUuid, 'uuid-steve');
  // Dasselbe Minecraft-Konto kann kein zweites Discord-Konto verknüpfen
  assert.deepEqual(await mc.sendLinkCode('222222222222222222', 'Steve'), { error: 'taken' });
});

test('MC_BALANCE_CHECK=false: Zahlungsnachricht zählt sofort, ohne /balance', async (t) => {
  const { world, api, mc } = setup({ balanceCheck: false });
  t.after(() => mc.stop());
  mc.start();
  await until(() => mc.state.online);
  world.bots[0].emit('messagestr', '[HugoSMP] Du hast $300 von Steve erhalten.', 'system');
  await until(() => api.calls.deposits.length === 1);
  assert.equal(api.calls.deposits[0].amount, 300);
  assert.equal(world.sent.filter((m) => m === '/balance').length, 0, 'kein /balance, auch nicht beim Start');
  assert.equal(mc.info().balanceCheck, false);
});

test('Login per Flüstern: HugoSMP-Format, Absender aus der Systemzeile', async (t) => {
  const { world, api, mc, reports } = setup();
  t.after(() => mc.stop());
  const seen = [];
  api.confirmLogin = async (l) => { seen.push(l); return l.code === 'abcd2345efgh'; };
  mc.start();
  await until(() => mc.state.online);
  const bot = world.bots[0];
  const sys = (line) => bot.emit('messagestr', line, 'system');
  // Nachgemachte Zeilen im Spieler- und Clan-Chat zählen nicht
  sys('Hacker: [Nachricht] Alpha_Noah -> Du: abcd2345efgh');
  sys('[NDCW] Hacker: [Nachricht] Alpha_Noah -> Du: abcd2345efgh');
  // mineflayer-„whisper“ wird nicht ausgewertet
  bot.emit('whisper', 'Alpha_Noah', 'abcd2345efgh');
  // Eigenes Echo ist kein Fehlalarm
  sys('[Nachricht] Du -> Alpha_Noah: 1.000 erhalten. Verknüpfe dein Konto im Discord, dann wird es gutgeschrieben.');
  sys('[Nachricht] Steve -> Du: hallo wie gehts');
  sys('[Nachricht] Steve -> Du: abcd2345efgh');
  await until(() => world.sent.some((m) => m.startsWith('/msg Steve Du bist auf der Website angemeldet')));
  assert.deepEqual(seen, [{ minecraftName: 'Steve', code: 'abcd2345efgh' }]);
  sys('[Nachricht] Steve -> Du: zzzz2345efgh');
  await until(() => world.sent.some((m) => m.startsWith('/msg Steve Code ungueltig')));
  // Kurzer 5-stelliger Code (z. B. KE2KM) wird ebenfalls weitergegeben
  sys('[Nachricht] Steve -> Du: KE2KM');
  await until(() => seen.some((l) => l.code === 'KE2KM'));
  sys('[Nachricht] Steve -> Du: login');
  await until(() => world.sent.some((m) => m.startsWith('/msg Steve Oeffne die Website')));
  // Höchstens 5 Code-Versuche pro Minute
  for (let i = 0; i < 6; i++) sys(`[Nachricht] Raten -> Du: aaaa2345eff${i}`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.filter((l) => l.minecraftName === 'Raten').length, 5);
  assert.ok(!reports.some((r) => /nicht erkannt/.test(r.title)), 'kein Fehlalarm');
});

test('MC_WHISPER_PATTERN: nur am Zeilenanfang, Pflichtgruppen werden geprüft', () => {
  const { whisper } = buildPatterns({ whisperPattern: '^\\[MSG\\] (?<name>\\w+) -> Dir: (?<message>.+)$' });
  assert.deepEqual({ ...matchFirst(whisper, '[MSG] Steve -> Dir: abcd2345efgh') }, { name: 'Steve', message: 'abcd2345efgh' });
  assert.equal(matchFirst(whisper, 'Hacker: [MSG] Steve -> Dir: abcd2345efgh'), null);
  assert.throws(() => buildPatterns({ whisperPattern: '(?<name>\\w+): (?<message>.+)' }), /\^/);
  assert.throws(() => buildPatterns({ whisperPattern: '^(?<name>\\w+)' }), /message/);
});

test('HugoSMP-Format: „[HugoSMP] Dein Kontostand: …“ wird erkannt', () => {
  const { balance } = buildPatterns();
  for (const [line, want] of [['[HugoSMP] Dein Kontostand: 1.234$', 1234], ['[HugoSMP] Dein Kontostand: 0$', 0], ['[HugoSMP] Dein Kontostand: 2.500 Coins', 2500]]) {
    assert.equal(parseAmount(matchFirst(balance, line).amount, { allowZero: true }), want, line);
  }
  assert.equal(matchFirst(balance, '[HugoSMP] Mit /money log siehst du deine Transaktionen.'), null);
});

test('Panel: Befehl mit Serverantwort, /pay führt den Kontostand nach', async (t) => {
  const { world, mc, reports } = setup();
  t.after(() => mc.stop());
  mc.start();
  await until(() => mc.state.online && mc._internal.db.lastBalance === 1000);
  const bot = world.bots[0];
  const chat = bot.chat;
  bot.chat = (text) => {
    chat(text);
    if (text === '/money log') setImmediate(() => bot.emit('messagestr', '[HugoSMP] Keine Transaktionen.', 'system'));
  };

  const log = await mc.runCommand('/money log');
  assert.deepEqual(log.lines, ['[HugoSMP] Keine Transaktionen.']);
  assert.equal((await mc.runCommand('  ')).error, 'empty');

  assert.equal((await mc.pay('a b', '5')).error, 'bad_name');
  assert.equal((await mc.pay('Steve', 'viel')).error, 'bad_amount');
  const res = await mc.pay('Steve', '300');
  assert.ok(world.sent.includes('/pay Steve 300'));
  assert.equal(res.balance, 700);
  assert.equal(mc._internal.db.lastBalance, 700, 'Kontostand nach der Zahlung neu gelesen');

  // Danach wird eine echte Einzahlung weiter richtig erkannt
  world.balance += 50;
  bot.emit('messagestr', 'Steve hat dir 50 gezahlt.', 'system');
  await until(() => mc._internal.db.lastBalance === 750);
  assert.ok(!reports.some((r) => /gesunken|Unerklärt/.test(r.title)), 'keine Fehlalarme');

  // /balance übernimmt den Kontostand direkt
  world.balance = 900;
  const bal = await mc.runCommand('/balance');
  assert.equal(bal.balance, 900);
  assert.equal(mc.info().online, true);
});

test('Panel-Einstellungen: geprüft, gespeichert, nach Neustart wirksam', async (t) => {
  const { mc, dataDir, world, api } = setup({ balanceCheck: false, payoutMax: 0, payoutsEnabled: false });
  t.after(() => mc.stop());
  assert.match(mc.setSetting('payoutsEnabled', true).error, /Kontostand-Prüfung/);
  assert.match(mc.setSetting('joinCommands', ['server smp']).error, /beginnt mit \//);
  assert.equal(mc.setSetting('evil', 1).error, 'Unbekannte Einstellung.');
  assert.ok(mc.setSetting('joinCommands', ['/server smp']).ok);
  assert.ok(mc.setSetting('balanceCheck', true).ok);
  assert.match(mc.setSetting('payoutsEnabled', true).error, /Limit/);
  assert.ok(mc.setSetting('payoutMax', 5000).ok);
  assert.ok(mc.setSetting('payoutsEnabled', true).ok);
  // Prüfung aus → Auszahlungen gehen mit aus
  const off = mc.setSetting('balanceCheck', false);
  assert.match(off.note, /Auszahlungen/);
  assert.equal(mc.settings().payoutsEnabled, false);
  mc.stop();

  // Neuer Dienst mit derselben Datenablage übernimmt die Einstellungen vor der .env
  const again = createMinecraftService({
    config: { ...config, balanceCheck: true, joinCommands: [] }, api, dataDir, createBot: world.createBot, report: () => {},
    logger: { info() {}, warn() {}, error() {} }, chatDelayMs: 0, commandWaitMs: 20,
  });
  t.after(() => again.stop());
  assert.deepEqual(again.settings().joinCommands, ['/server smp']);
  assert.equal(again.settings().balanceCheck, false);
  again.start();
  await until(() => world.sent.includes('/server smp'));
});

test('Systemnachrichten aus dem Paket: voller Text, auch wenn mineflayer ihn kürzt', async (t) => {
  const { world, api, mc } = setup({ balanceCheck: false });
  t.after(() => mc.stop());
  world.withClient = true;
  mc.start();
  await until(() => mc.state.online);
  const bot = world.bots[0];
  const content = JSON.stringify({ text: '', extra: [{ text: '[HugoSMP] ', color: 'red' }, { text: 'Du hast ' }, { text: '$1.000', color: 'gold' }, { text: ' von Reschoo erhalten.' }] });
  // mineflayer liefert bei HugoSMP nur den Tag – darf nicht zählen
  bot.emit('messagestr', '[HugoSMP]', 'system');
  bot._client.emit('system_chat', { content, isActionBar: false });
  await until(() => api.calls.deposits.length === 1);
  assert.equal(api.calls.deposits[0].amount, 1000);
  assert.equal(api.calls.deposits[0].minecraftName, 'Reschoo');
  // Actionbar wird nie ausgewertet
  bot._client.emit('system_chat', { content: JSON.stringify({ text: '[HugoSMP] Du hast $5 von Steve erhalten.' }), isActionBar: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(api.calls.deposits.length, 1);
  assert.equal(mc.info().stats.raw, 2);
});

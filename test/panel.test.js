'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mainView, payConfirmView } = require('../src/panel/minecraftPanel');
const { isPanelAdmin } = require('../src/panel/access');
const panelInteraction = require('../src/interactions/panel');
const { textLength, TEXT_LIMIT } = require('../src/lib/ui');

const OWNER = '1489628580123250870';

function fakeMc() {
  const calls = [];
  return {
    calls,
    info: () => ({ online: true, connecting: false, since: new Date(), lastError: null, username: 'HugoPredict', host: 'hugosmp.net', balance: 15000, players: 12, recent: ['[HugoSMP] Willkommen!'] }),
    runCommand: async (cmd) => { calls.push(cmd); return { lines: [`[HugoSMP] ok ${cmd}`], balance: 15000 }; },
    pay: async (name, amount) => { calls.push(`pay ${name} ${amount}`); return { lines: ['[HugoSMP] Gezahlt.'], balance: 14000 }; },
    st: { balanceCheck: false, payoutsEnabled: false, payoutMax: 0, joinCommands: [] },
    settings() { return { ...this.st }; },
    setSetting(k, v) { calls.push(`set ${k}=${JSON.stringify(v)}`); this.st[k] = v; return { ok: true }; },
    reconnect() { calls.push('reconnect'); },
  };
}
function deps(mc) {
  return {
    env: { panelAdminIds: [OWNER], minecraft: { balanceCommand: '/balance' } },
    store: { guild: () => ({ channels: { minecraftPanel: 'mcp' } }) },
    minecraft: mc, checkRate: () => true, logger: { info() {} }, ctx: { audit: async () => {} },
  };
}
function interaction(userId, { button = true, fields = {}, channelId = 'x', canView = false } = {}) {
  const out = [];
  return {
    out,
    user: { id: userId, tag: 'x' }, guild: null, replied: false, deferred: false,
    guildId: 'G', channelId, inGuild: () => true, member: {},
    channel: { permissionsFor: () => ({ has: () => canView }) },
    isButton: () => button, isModalSubmit: () => !button,
    fields: { getTextInputValue: (k) => fields[k] },
    reply: async (p) => out.push(p), deferUpdate: async () => {}, deferReply: async (p) => out.push({ deferred: p }), editReply: async (p) => out.push(p),
    showModal: async (m) => out.push({ modal: m.toJSON() }),
  };
}
const json = (p) => JSON.stringify(p.components?.map((c) => c.toJSON?.() ?? c) ?? p);

test('/panel: nur die eingetragene Discord-ID', async () => {
  const mc = fakeMc();
  assert.equal(isPanelAdmin(deps(mc), OWNER), true);
  assert.equal(isPanelAdmin(deps(mc), '123'), false);
  const i = interaction('42', { button: false, fields: { cmd: '/pay Hacker 1000000' } });
  await panelInteraction.handle(i, deps(mc), ['cmdmodal']);
  assert.match(JSON.stringify(i.out.at(-1)), /Keine Berechtigung/);
  assert.equal(mc.calls.length, 0);
});

test('Panel-Ansicht: Status, Antwort und Buttons innerhalb der Limits', () => {
  const view = mainView(fakeMc(), { title: 'Ausgeführt: /money log', lines: Array(30).fill('x'.repeat(200)) });
  assert.ok(textLength(view) <= TEXT_LIMIT);
  assert.equal(view.files.length, 0, 'kein Logo-Anhang: Panel wird bearbeitet');
  assert.doesNotMatch(json(view), /attachment:\/\//);
  const s = json(view);
  assert.match(s, /Online/);
  assert.match(s, /15\.000/);
  for (const id of ['cmd', 'pay', 'balance', 'refresh']) assert.match(s, new RegExp(`hm:panel:${id}"`));
  assert.match(json(mainView(null)), /ausgeschaltet/);
});

test('Panel: Befehl ausführen und /pay erst nach Bestätigung', async () => {
  const mc = fakeMc();
  const d = deps(mc);
  const cmd = interaction(OWNER, { button: false, fields: { cmd: '/money log' } });
  await panelInteraction.handle(cmd, d, ['cmdmodal']);
  assert.deepEqual(mc.calls, ['/money log']);
  assert.match(json(cmd.out.at(-1)), /ok \/money log/);

  const bad = interaction(OWNER, { button: false, fields: { name: 'Steve', amount: 'viel' } });
  await panelInteraction.handle(bad, d, ['paymodal']);
  assert.match(json(bad.out.at(-1)), /Ungültiger Betrag/);

  const modal = interaction(OWNER, { button: false, fields: { name: 'Steve', amount: '15k' } });
  await panelInteraction.handle(modal, d, ['paymodal']);
  assert.equal(mc.calls.length, 1, 'noch nicht gezahlt');
  assert.match(json(modal.out.at(-1)), /15\.000.*Steve/);
  assert.match(json(payConfirmView('Steve', 15000)), /hm:panel:payok/);

  await panelInteraction.handle(interaction(OWNER), d, ['payok']);
  assert.equal(mc.calls.at(-1), 'pay Steve 15000');
  // Zweites Bestätigen zahlt nicht erneut
  await panelInteraction.handle(interaction(OWNER), d, ['payok']);
  assert.equal(mc.calls.filter((c) => c.startsWith('pay')).length, 1);
});

test('Panel: Einstellungen umschalten und Join-Befehle setzen', async () => {
  const mc = fakeMc();
  const d = deps(mc);
  await panelInteraction.handle(interaction(OWNER), d, ['toggle', 'balanceCheck']);
  assert.equal(mc.calls.at(-1), 'set balanceCheck=true');
  const join = interaction(OWNER, { button: false, fields: { cmds: '/server smp\n\n /warp spawn ' } });
  await panelInteraction.handle(join, d, ['joinmodal']);
  assert.equal(mc.calls.at(-1), 'set joinCommands=["/server smp","/warp spawn"]');
  assert.match(json(join.out.at(-1)), /Gespeichert/);
  await panelInteraction.handle(interaction('42'), d, ['toggle', 'payoutsEnabled']);
  assert.ok(!mc.calls.some((c) => c.startsWith('set payoutsEnabled')), 'Fremde dürfen nichts ändern');
});

test('Panel zeigt nur Serverantworten, keine Broadcasts', () => {
  const view = mainView(fakeMc(), { title: 'Ausgeführt: /balance', lines: ['Nidoyu sucht einen 1vs1-RTP-Gegner', '[HugoSMP] Dein Kontostand: $101.000', '5trq: hallo'] });
  const s = json(view);
  assert.match(s, /Dein Kontostand/);
  assert.doesNotMatch(s, /RTP-Gegner|hallo/);
});

test('Festes Panel: nutzbar für alle, die #minecraft-panel sehen – Antwort privat', async () => {
  const mc = fakeMc();
  const d = deps(mc);
  // Sieht den Channel nicht → abgewiesen
  const blind = interaction('42', { button: false, fields: { cmd: '/money' }, channelId: 'mcp', canView: false });
  await panelInteraction.handle(blind, d, ['cmdmodal']);
  assert.match(JSON.stringify(blind.out.at(-1)), /Keine Berechtigung/);
  // Anderer Channel → abgewiesen, auch wenn sichtbar
  const elsewhere = interaction('42', { button: false, fields: { cmd: '/money' }, channelId: 'team', canView: true });
  await panelInteraction.handle(elsewhere, d, ['cmdmodal']);
  assert.match(JSON.stringify(elsewhere.out.at(-1)), /Keine Berechtigung/);
  assert.equal(mc.calls.length, 0);
  // Im Channel und sichtbar → ausgeführt, Antwort als private Nachricht
  const ok = interaction('42', { button: false, fields: { cmd: '/money' }, channelId: 'mcp', canView: true });
  await panelInteraction.handle(ok, d, ['cmdmodal']);
  assert.deepEqual(mc.calls, ['/money']);
  assert.ok(ok.out[0].deferred, 'privat geantwortet statt das feste Panel zu bearbeiten');
});

test('Website-Login als Bot: nur der Inhaber', async () => {
  const mc = fakeMc();
  const seen = [];
  const d = { ...deps(mc), api: { confirmLogin: async (l) => { seen.push(l); return l.code === 'KE2KM'; } } };
  const own = interaction(OWNER);
  await panelInteraction.handle(own, d, ['settings']);
  assert.match(json(own.out.at(-1)), /hm:panel:weblogin/);
  const other = interaction('42', { channelId: 'mcp', canView: true });
  await panelInteraction.handle(other, d, ['settings']);
  assert.doesNotMatch(json(other.out.at(-1)), /hm:panel:weblogin/);
  await panelInteraction.handle(interaction('42', { button: false, fields: { code: 'KE2KM' }, channelId: 'mcp', canView: true }), d, ['webloginmodal']);
  assert.equal(seen.length, 0, 'andere können sich nicht als Bot anmelden');
  const ok = interaction(OWNER, { button: false, fields: { code: 'KE2KM' } });
  await panelInteraction.handle(ok, d, ['webloginmodal']);
  assert.deepEqual(seen, [{ minecraftName: 'HugoPredict', code: 'KE2KM' }]);
  assert.match(json(ok.out.at(-1)), /angemeldet/);
});

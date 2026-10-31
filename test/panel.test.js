'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { PAGES, buildPage, logs, restartConfirm } = require('../src/panel/pages');
const { isPanelAdmin } = require('../src/panel/access');
const panelInteraction = require('../src/interactions/panel');
const { createActivityLog } = require('../src/services/activityLog');
const { textLength, TEXT_LIMIT } = require('../src/lib/ui');

const OWNER = '1489628580123250870';

function fakeClient() {
  const guild = { id: '1', name: 'Hugo Predict | HugoSMP', memberCount: 57, available: true, premiumTier: 3, joinedTimestamp: Date.parse('2026-10-20') };
  return {
    isReady: () => true, uptime: 3_600_000, ws: { ping: 64 },
    user: { tag: 'Hugo Predict Helper#0001', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png' },
    guilds: { cache: new Collection([['1', guild]]) },
  };
}
const summary = {
  users: 12, mcPlayers: 9, discordLinks: 7, balances: 15000, positionsValue: 2500, trades: 40, volume: 9000, fees: 90,
  deposits: { count: 5, sum: 20000, unclaimed: 0 }, withdrawals: { pending: { count: 1, sum: 500 }, done: { count: 2, sum: 1000 } },
  markets: { open: 2 }, top: [{ username: 'Steve', mcName: 'Steve', balance: 5000 }],
};
function deps(api) {
  const activity = createActivityLog();
  activity.push({ kind: 'audit', title: 'Ankündigung veröffentlicht' });
  activity.push({ kind: 'warn', title: 'Minecraft: Kontostand nicht erkannt' });
  return {
    env: { panelAdminIds: [OWNER], currency: 'HugoCoins', websiteUrl: '', marketFeedIntervalSeconds: 60, marketFeedMaxMarkets: 25, maxOpenTicketsPerUser: 2, logLevel: 'info', minecraft: { enabled: true, host: 'hugosmp.net', port: 25565, account: 'bot@example.com', payoutsEnabled: false } },
    api, activity, version: 'abc1234',
    store: { guild: () => ({ moderation: { cases: [{ number: 3, action: 'timeout', targetId: '5', at: '2026-10-31T10:00:00Z' }] } }) },
    minecraft: { state: { online: true, since: new Date() } },
  };
}
const websiteApi = {
  configured: true,
  panelSummary: async () => summary,
  panelUsers: async ({ q }) => ({ total: 1, users: [{ id: 1, username: 'Steve', mcName: 'Steve', balance: 5000, createdAt: '2026-10-30T10:00:00Z', discordId: '123456789012345678', discordName: 'steve' }].filter(() => !q || q === 'steve') }),
  panelMarkets: async () => ({ markets: [
    { id: 1, title: 'Gewinnt Team Nord?', status: 'open', volume: 900, outcomes: [{ label: 'Ja', price: 0.62 }, { label: 'Nein', price: 0.38 }], result: null },
    { id: 2, title: 'Kommt das Update?', status: 'resolved', volume: 300, outcomes: [{ label: 'Ja', price: 1 }], result: 'Ja' },
  ] }),
  panelTransactions: async () => ({ transactions: [{ id: '1', type: 'deposit', label: 'Einzahlung', amount: 500, user: 'Steve', createdAt: '2026-10-31T09:00:00Z' }] }),
};

const countComponents = (c) => 1 + (c.components ?? []).reduce((s, x) => s + countComponents(x), 0) + (c.accessory ? 1 : 0);

test('/panel: nur die eingetragene Discord-ID', () => {
  const d = deps(websiteApi);
  assert.equal(isPanelAdmin(d, OWNER), true);
  assert.equal(isPanelAdmin(d, '123'), false);
});

test('Panel-Seiten: alle Seiten mit Daten, innerhalb der Discord-Limits', async () => {
  const d = deps(websiteApi);
  for (const p of PAGES) {
    const payload = await buildPage(p.key, { client: fakeClient(), deps: d, state: { q: '', offset: 0, txType: '' } });
    const json = payload.components.map((c) => c.toJSON());
    const text = JSON.stringify(json);
    assert.ok(textLength(payload) <= TEXT_LIMIT, `${p.key}: Text zu lang`);
    assert.ok(json.reduce((s, c) => s + countComponents(c), 0) <= 40, `${p.key}: zu viele Komponenten`);
    assert.match(text, /hm:panel:nav/, `${p.key}: Navigation fehlt`);
    assert.ok(!text.includes('bot@example.com'), 'E-Mail nicht im Klartext');
  }
  const dash = JSON.stringify((await buildPage('dashboard', { client: fakeClient(), deps: d, state: {} })).components.map((c) => c.toJSON()));
  assert.match(dash, /64 ms/);
  assert.match(dash, /Registrierte Minecraft-Spieler \*\*9\*\*/);
  const eco = JSON.stringify((await buildPage('economy', { client: fakeClient(), deps: d, state: {} })).components.map((c) => c.toJSON()));
  assert.match(eco, /Gesamtumlauf \*\*17\.500 HugoCoins/);
  const act = JSON.stringify((await buildPage('activity', { client: fakeClient(), deps: d, state: {} })).components.map((c) => c.toJSON()));
  assert.match(act, /Kontostand nicht erkannt/);
  assert.match(act, /Fall #3/);
  assert.ok(textLength(restartConfirm()) < TEXT_LIMIT);
  assert.ok(textLength(await logs({}, 'out')) < TEXT_LIMIT);
});

test('Panel ohne Website: sauberer Hinweis statt erfundener Zahlen', async () => {
  const d = deps({ configured: false });
  for (const key of ['users', 'economy', 'markets', 'transactions']) {
    const text = JSON.stringify((await buildPage(key, { client: fakeClient(), deps: d, state: { q: '', offset: 0, txType: '' } })).components.map((c) => c.toJSON()));
    assert.match(text, /nicht verbunden/, key);
  }
  const failing = { configured: true, panelSummary: async () => { throw new Error('down'); } };
  const dash = JSON.stringify((await buildPage('dashboard', { client: fakeClient(), deps: deps(failing), state: {} })).components.map((c) => c.toJSON()));
  assert.match(dash, /Spieler: /);
});

test('Panel-Interaktionen: Fremde werden abgewiesen, Neustart nur nach Bestätigung', async () => {
  const replies = [];
  let restarted = false;
  const d = { ...deps(websiteApi), checkRate: () => true, logger: { info() {} }, ctx: { audit: async () => {} }, services: { restartBot: () => { restarted = true; } } };
  const base = (userId) => ({
    user: { id: userId, tag: 'x' }, client: fakeClient(), guild: null, replied: false, deferred: false,
    isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    reply: async (p) => replies.push(p), deferUpdate: async () => {}, editReply: async (p) => replies.push(p), update: async (p) => replies.push(p),
  });
  await panelInteraction.handle(base('42'), d, ['restartok']);
  assert.match(JSON.stringify(replies.at(-1)), /Keine Berechtigung/);
  await panelInteraction.handle(base(OWNER), d, ['restart']);
  assert.equal(restarted, false, 'erst bestätigen');
  assert.match(JSON.stringify(replies.at(-1).components.map((c) => c.toJSON())), /hm:panel:restartok/);
  await panelInteraction.handle(base(OWNER), d, ['restartok']);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(restarted, true);
});

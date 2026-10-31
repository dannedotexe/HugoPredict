'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { marketCard, marketHash } = require('../src/services/marketFeed');
const { normalizeMarket } = require('../src/lib/hugoApi');

const json = (p) => JSON.stringify(p.components.map((c) => c.toJSON()));

test('Prognose-Karte zeigt echte Ausgänge, Kategorie und Emoji', () => {
  const m = normalizeMarket({
    id: 7, title: 'Wie schwer ist Lutscha77', status: 'open', volume: 0, yesPrice: null, noPrice: null,
    outcomes: [{ label: 'über 100kg', price: 0.5 }, { label: 'unter 100kg', price: 0.5 }], category: 'Echte Welt', emoji: '🐋',
  });
  const s = json(marketCard(m, { currency: '$' }));
  assert.match(s, /über 100kg\*\* 50/);
  assert.match(s, /unter 100kg\*\* 50/);
  assert.doesNotMatch(s, /\*\*Ja\*\*/);
  assert.match(s, /Echte Welt/);
  assert.match(s, /🐋 Wie schwer ist Lutscha77/);
  // Ja/Nein bleibt wie bisher
  const yn = normalizeMarket({ id: 8, title: 'Gewinnt Clan A?', status: 'open', yesPrice: 0.62, noPrice: 0.38, outcomes: [{ label: 'Ja', price: 0.62 }, { label: 'Nein', price: 0.38 }] });
  assert.match(json(marketCard(yn, { currency: '$' })), /\*\*Ja\*\* 62/);
  // Geänderte Ausgänge oder Titel → Karte wird bearbeitet
  assert.notEqual(marketHash(m), marketHash({ ...m, outcomes: [{ label: 'über 120kg', price: 0.5 }, m.outcomes[1]] }));
  assert.notEqual(marketHash(m), marketHash({ ...m, title: 'Wie viel wiegt Lutscha77' }));
});

test('Nach der Entscheidung: DM mit Ergebnis an verknüpfte Spieler, nur einmal, keine alten', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { Store } = require('../src/lib/store');
  const { createMarketFeed } = require('../src/services/marketFeed');
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-dm-')));
  const g = store.guild('G');
  g.channels.marketOverview = 'C';
  g.layoutVersion = 2;
  const old = { id: '1', title: 'Alt?', status: 'resolved', outcome: 'Ja', outcomes: [] };
  const fresh = { id: '2', title: 'Neu?', status: 'resolved', outcome: 'Nein', outcomes: [], emoji: '🐋' };
  let resolved = [old];
  const api = {
    configured: true,
    listMarkets: async ({ status }) => (status === 'resolved' ? resolved : []),
    marketResults: async (id) => ({ title: id === '2' ? 'Neu?' : 'Alt?', result: 'Nein', results: [{ discordId: '111111111111111111', pnl: 120, payout: 220, won: true }, { discordId: '222222222222222222', pnl: -50, payout: 0, won: false }] }),
  };
  const dms = [];
  const member = (id) => ({ id, send: async (p) => dms.push({ id, text: JSON.stringify(p.components.map((c) => c.toJSON())) }) });
  const channel = { id: 'C', isTextBased: () => true, messages: { fetch: async () => null }, send: async () => ({ id: 'm' }) };
  const guild = { id: 'G', members: { fetch: async (id) => member(id) } };
  const ctx = { channel: async () => channel, roleId: () => null, audit: async () => {} };
  const feed = createMarketFeed({ api, store, env: { currency: '$', marketFeedMaxMarkets: 25 }, ctx, logger: { warn() {} }, statusService: { recordSync() {} } });

  await feed.syncGuild(guild);
  assert.equal(dms.length, 0, 'beim ersten Lauf keine DMs für alte Entscheidungen');
  resolved = [old, fresh];
  await feed.syncGuild(guild);
  assert.equal(dms.length, 2);
  assert.match(dms.find((d) => d.id === '111111111111111111').text, /Glückwunsch[\s\S]*\+120/);
  assert.match(dms.find((d) => d.id === '222222222222222222').text, /verloren/);
  await feed.syncGuild(guild);
  assert.equal(dms.length, 2, 'nur einmal');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { panelDefinitions } = require('../src/setup/panels');
const { suggestionModal, suggestionEmbed } = require('../src/interactions/suggestions');
const { ticketModal } = require('../src/interactions/tickets');
const { TICKET_TYPES } = require('../src/config/serverLayout');
const { marketEmbed, marketComponents } = require('../src/services/marketFeed');
const { leaderboardEmbed, BOARDS } = require('../src/services/leaderboards');
const { listPayload } = require('../src/commands/markets');
const { resultEmbed } = require('../src/commands/setup-server');
const { loadCommands } = require('../src/registry');

const json = (x) => (typeof x?.toJSON === 'function' ? x.toJSON() : x);
const env = { websiteUrl: 'https://market.example', currency: 'HC' };

test('Alle Panels sind gültige Discord-Payloads (mit und ohne Website-URL)', () => {
  for (const e of [env, { ...env, websiteUrl: '' }]) {
    for (const def of panelDefinitions()) {
      const p = def.build({ guild: { id: '1' }, env: e, ids: { rules: '2', verification: '3', ticketCreate: '4', communityVotes: '5' } });
      p.embeds.forEach(json);
      p.components.forEach(json);
      assert.ok(p.components.length <= 5, def.key);
    }
  }
});

test('Modals sind gültig', () => {
  json(suggestionModal());
  for (const t of TICKET_TYPES) json(ticketModal(t));
});

test('Embeds für Märkte, Ranglisten, Vorschläge und Setup-Ergebnis', () => {
  const m = { id: '1', title: 'T'.repeat(300), description: 'D'.repeat(1000), yesPrice: 0.4, noPrice: 0.6, volume: 10, status: 'resolved', outcome: 'YES', url: 'https://x.test/m/1', closesAt: '2026-11-01T00:00:00Z' };
  json(marketEmbed(m, env));
  marketComponents(m).forEach(json);
  assert.equal(marketComponents({ ...m, url: null }).length, 0);
  for (const b of BOARDS) {
    json(leaderboardEmbed(b, { entries: [], period: null, generatedAt: null }, env));
    json(leaderboardEmbed(b, { entries: [{ rank: 1, username: 'a', discordId: null, value: 0.7, detail: '12 Märkte' }], period: 'KW 44', generatedAt: '2026-10-29T00:00:00Z' }, env));
  }
  json(suggestionEmbed({ number: 1, title: 't', description: 'd', outcomes: 'Ja / Nein', source: 's', closes: '', authorId: '1', status: 'open', votes: { a: 'up' } }));
  const lp = listPayload([m, { ...m, id: '2' }], 'open', 'HC');
  lp.embeds.forEach(json);
  lp.components.forEach(json);
  json(resultEmbed({ created: ['a'], updated: [], existing: [], warnings: ['w'], errors: ['e'] }));
});

test('Slash-Commands sind gültig und vollständig', () => {
  const names = [...loadCommands().keys()].sort();
  assert.deepEqual(names, ['balance', 'daily', 'help', 'history', 'leaderboard', 'markets', 'portfolio', 'setup-panels', 'setup-server', 'verify', 'vorschlag']);
  for (const c of loadCommands().values()) assert.equal(c.data.toJSON().contexts[0], 0);
});

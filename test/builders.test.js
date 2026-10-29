'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { panelDefinitions } = require('../src/setup/panels');
const { suggestionModal, suggestionEmbed } = require('../src/interactions/suggestions');
const { ticketModal } = require('../src/interactions/tickets');
const { announcementModal, announcementEmbed } = require('../src/interactions/announcements');
const { TICKET_TYPES } = require('../src/config/serverLayout');
const { marketEmbed, marketComponents } = require('../src/services/marketFeed');
const { leaderboardEmbed, BOARDS } = require('../src/services/leaderboards');
const { listPayload } = require('../src/commands/markets');
const { resultEmbed, previewEmbed } = require('../src/commands/setup-server');
const { loadCommands } = require('../src/registry');

const json = (x) => (typeof x?.toJSON === 'function' ? x.toJSON() : x);
const env = { websiteUrl: 'https://market.example', currency: 'HC' };
const EMOJI = /\p{Extended_Pictographic}/u;

function embedChars(list) {
  return list.map(json).reduce((a, e) => a + (e.title ?? '').length + (e.description ?? '').length + (e.footer?.text ?? '').length
    + (e.author?.name ?? '').length + (e.fields ?? []).reduce((b, f) => b + f.name.length + f.value.length, 0), 0);
}

test('Panels sind gültig, unter dem 6000-Zeichen-Limit und ohne Emojis', () => {
  for (const e of [env, { ...env, websiteUrl: '' }]) {
    for (const def of panelDefinitions()) {
      const p = def.build({ guild: { id: '1' }, env: e, ids: {} });
      p.embeds.forEach(json);
      p.components.forEach(json);
      assert.ok(p.embeds.length <= 10 && embedChars(p.embeds) <= 6000, def.key);
      assert.ok(!EMOJI.test(JSON.stringify(p.embeds.map(json))), `${def.key} enthält Emojis`);
    }
  }
});

test('Ticket-Panel nutzt ein Auswahlmenü mit allen Anliegen', () => {
  const p = panelDefinitions().find((d) => d.key === 'tickets').build({ env });
  const menu = json(p.components[0]).components[0];
  assert.equal(menu.custom_id, 'hm:ticket:select');
  assert.deepEqual(menu.options.map((o) => o.value), TICKET_TYPES.map((t) => t.key));
});

test('Modals sind gültig', () => {
  json(suggestionModal());
  json(announcementModal());
  for (const t of TICKET_TYPES) json(ticketModal(t));
});

test('Embeds für Märkte, Ranglisten, Vorschläge, Ankündigungen und Setup', () => {
  for (const status of ['open', 'paused', 'closed', 'resolved']) {
    const m = { id: '1', title: 'T'.repeat(300), description: 'D'.repeat(1000), yesPrice: 0.4, noPrice: 0.6, volume: 10, status, outcome: 'Ja', url: 'https://x.test/m/1', closesAt: '2026-11-01T00:00:00Z' };
    const e = json(marketEmbed(m, env));
    assert.match(e.author.name, /^Markt · /);
    marketComponents(m).forEach(json);
  }
  for (const b of BOARDS) {
    json(leaderboardEmbed(b, { entries: [], period: null, generatedAt: null }, env));
    json(leaderboardEmbed(b, { entries: [{ rank: 1, username: 'a', discordId: null, value: 0.7, detail: '12 Märkte' }], period: 'KW 44', generatedAt: '2026-10-29T00:00:00Z' }, env));
  }
  json(suggestionEmbed({ number: 1, title: 't', description: 'd', outcomes: 'Ja / Nein', source: 's', closes: '', authorId: '1', status: 'open' }));
  json(announcementEmbed({ title: 'Wartung', body: 'Text', link: 'https://x.de', authorName: 'Team' }));
  const lp = listPayload([{ id: '1', title: 'A', yesPrice: 0.5 }, { id: '2', title: 'B' }], 'paused', 'HC');
  lp.embeds.forEach(json);
  lp.components.forEach(json);
  json(resultEmbed({ created: ['a'], updated: ['b → c'], existing: [], warnings: ['w'], errors: ['e'], obsolete: ['#x'], archived: ['#y'] }));
  json(previewEmbed({ rolesNew: 0, rolesRenamed: ['a → b'], categoriesNew: 0, categoriesRenamed: [], channelsNew: ['#n'], channelsMigrated: ['#o → #n'], unchanged: 1, obsolete: ['#x'], obsoleteChannels: 1 }, { sync: false, archive: true }));
});

test('Slash-Commands sind gültig und vollständig', () => {
  const names = [...loadCommands().keys()].sort();
  assert.deepEqual(names, ['ankündigung', 'aufräumen', 'balance', 'daily', 'help', 'history', 'leaderboard', 'markets', 'ping', 'portfolio', 'setup-panels', 'setup-server', 'verify', 'vorschlag']);
  for (const c of loadCommands().values()) assert.equal(c.data.toJSON().contexts[0], 0);
});

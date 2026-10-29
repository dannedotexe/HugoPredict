'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { panelDefinitions } = require('../src/setup/panels');
const { suggestionModal, suggestionCard } = require('../src/interactions/suggestions');
const { ticketModal } = require('../src/interactions/tickets');
const { announcementModal, announcementCard } = require('../src/interactions/announcements');
const { TICKET_TYPES } = require('../src/config/serverLayout');
const { marketCard, priceBar } = require('../src/services/marketFeed');
const { leaderboardCard, BOARDS } = require('../src/services/leaderboards');
const { statsCard } = require('../src/services/stats');
const { welcomePayload } = require('../src/services/welcome');
const { listPayload } = require('../src/commands/markets');
const { textLength, TEXT_LIMIT } = require('../src/lib/ui');
const { loadCommands } = require('../src/registry');

const env = { websiteUrl: 'https://market.example', currency: 'HC' };
const EMOJI = /\p{Extended_Pictographic}/u;

function countComponents(payload) {
  let n = 0;
  const walk = (c) => {
    n++;
    (c.components ?? []).forEach(walk);
    if (c.accessory) n++;
  };
  payload.components.map((c) => c.toJSON()).forEach(walk);
  return n;
}

/** Prüft eine Karte gegen die Discord-Grenzen für Components V2. */
function assertCard(payload, label) {
  assert.ok(payload.flags & MessageFlags.IsComponentsV2, `${label}: Components-V2-Flag`);
  assert.equal(payload.embeds, undefined, `${label}: keine Embeds`);
  assert.equal(payload.content, undefined, `${label}: kein Content`);
  const json = JSON.stringify(payload.components.map((c) => c.toJSON()));
  assert.ok(textLength(payload) <= TEXT_LIMIT, `${label}: Text ${textLength(payload)} > ${TEXT_LIMIT}`);
  assert.ok(countComponents(payload) <= 40, `${label}: ${countComponents(payload)} Komponenten`);
  assert.ok(!EMOJI.test(json), `${label}: Standard-Emojis gefunden`);
  if (json.includes('attachment://')) assert.equal(payload.files.length, 1, `${label}: Logo-Anhang`);
  return json;
}

test('Panels sind gültige Karten (mit und ohne Website-URL)', () => {
  for (const e of [env, { ...env, websiteUrl: '' }]) {
    for (const def of panelDefinitions()) {
      const json = assertCard(def.build({ guild: { id: '1' }, env: e, roleIds: {}, channelIds: {} }), def.key);
      // Haupt-Panels mit großer Überschrift und Logo, Zusatzkarten kompakt
      if (['docs', 'tickets'].includes(def.key)) {
        assert.match(json, /"content":"# /, `${def.key}: große Überschrift`);
        assert.match(json, /attachment:\/\/hugopredict\.png/, `${def.key}: Logo oben rechts`);
      }
    }
  }
});

test('Ticket-Panel nutzt ein Auswahlmenü mit allen Anliegen', () => {
  const p = panelDefinitions().find((d) => d.key === 'tickets').build({ env });
  const menu = p.components[0].toJSON().components.find((c) => c.type === 1).components[0];
  assert.equal(menu.custom_id, 'hm:ticket:select');
  assert.deepEqual(menu.options.map((o) => o.value), TICKET_TYPES.map((t) => t.key));
});

test('Modals sind gültig', () => {
  suggestionModal().toJSON();
  announcementModal().toJSON();
  for (const t of TICKET_TYPES) ticketModal(t).toJSON();
});

test('Karten für Märkte, Ranglisten, Vorschläge, Ankündigungen, Statistik und Begrüßung', () => {
  for (const status of ['open', 'paused', 'closed', 'resolved']) {
    const m = { id: '1', title: 'T'.repeat(300), description: 'D'.repeat(1000), yesPrice: 0.4, noPrice: 0.6, volume: 10, status, outcome: 'Ja', url: 'https://x.test/m/1', closesAt: '2026-11-01T00:00:00Z' };
    const json = assertCard(marketCard(m, env), `Markt ${status}`);
    assert.match(json, /Markt · /);
    assertCard(marketCard({ ...m, url: null }, env, { ephemeral: true }), 'Markt ohne Link');
  }
  assert.equal(priceBar(0.5, 10), '`▰▰▰▰▰▱▱▱▱▱`');
  assert.equal(priceBar(null), null);
  for (const b of BOARDS) {
    assertCard(leaderboardCard(b, { entries: [], period: null, generatedAt: null }, env), b.type);
    const entries = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, username: `u${i}`, discordId: null, value: 0.7, detail: '12 Märkte' }));
    assertCard(leaderboardCard(b, { entries, period: 'KW 44', generatedAt: '2026-10-29T00:00:00Z' }, env), `${b.type} voll`);
  }
  for (const status of ['open', 'accepted', 'rejected']) {
    assertCard(suggestionCard({ number: 1, title: 't', description: 'd', outcomes: 'Ja / Nein', source: 's', closes: '', authorId: '1', status, createdAt: '2026-10-29T00:00:00Z', decision: status === 'open' ? null : { by: '2', reason: 'r' } }), `Vorschlag ${status}`);
  }
  assertCard(announcementCard({ title: 'Wartung', body: 'Text'.repeat(800), link: 'https://x.de', authorName: 'Team' }), 'Ankündigung');
  assertCard(statsCard({ members: 10, membersIntent: false }), 'Statistik');
  assertCard(welcomePayload({ guildId: '1', guildName: 'HugoPredict', ids: { docs: '2', support: '3' }, websiteUrl: 'https://x.de' }), 'Begrüßung');
  const markets = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: 'Markt '.repeat(15), yesPrice: 0.5 }));
  assertCard(listPayload(markets, 'paused', 'HC'), '/markets');
});

test('Slash-Commands sind gültig und vollständig', () => {
  const names = [...loadCommands().keys()].sort();
  assert.deepEqual(names, ['ankündigung', 'aufräumen', 'balance', 'daily', 'help', 'history', 'leaderboard', 'markets', 'mod', 'ping', 'portfolio', 'setup-panels', 'verify', 'vorschlag']);
  for (const c of loadCommands().values()) assert.equal(c.data.toJSON().contexts[0], 0);
});

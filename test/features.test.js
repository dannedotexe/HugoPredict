'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection } = require('discord.js');
const { parseBerlinTime } = require('../src/lib/berlinTime');
const { Store } = require('../src/lib/store');
const { createScheduler } = require('../src/services/scheduler');
const notify = require('../src/interactions/notify');
const { scheduledCard } = require('../src/interactions/announcements');
const { marketCard } = require('../src/services/marketFeed');

const tmpStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-feat-')));

test('Zeitangaben in deutscher Zeit (Winter- und Sommerzeit)', () => {
  const now = Date.parse('2026-10-29T15:00:00Z'); // 16:00 in Berlin
  const iso = (s, n = now) => new Date(parseBerlinTime(s, n).at).toISOString();
  assert.equal(iso('20:00'), '2026-10-29T19:00:00.000Z');
  assert.equal(iso('15:30'), '2026-10-30T14:30:00.000Z', 'vergangene Uhrzeit → morgen');
  assert.equal(iso('morgen 18:30'), '2026-10-30T17:30:00.000Z');
  assert.equal(iso('14.11. 20:00'), '2026-11-14T19:00:00.000Z');
  assert.equal(iso('14.11.2026, 20:00 Uhr'), '2026-11-14T19:00:00.000Z');
  assert.equal(iso('01.07.2027 12:00', Date.parse('2027-06-01T00:00:00Z')), '2027-07-01T10:00:00.000Z', 'Sommerzeit');
  for (const bad of ['31.02. 10:00', '25:00', 'gestern', '01.01.2027 00:00']) assert.equal(parseBerlinTime(bad, now).ok, false, bad);
});

test('Benachrichtigungs-Buttons melden an und wieder ab', async () => {
  const roles = new Set();
  const replies = [];
  const interaction = {
    isButton: () => true, inGuild: () => true, guild: { id: 'G' },
    member: { roles: { cache: { has: (id) => roles.has(id) }, add: async (id) => roles.add(id), remove: async (id) => roles.delete(id) } },
    replied: false, deferred: false, reply: async (p) => replies.push(p),
  };
  const deps = { checkRate: () => true, ctx: { roleId: (g, k) => (k === 'notifyMarkets' ? 'R1' : null) }, logger: console };
  await notify.handle(interaction, deps, ['notifyMarkets']);
  assert.ok(roles.has('R1'));
  await notify.handle(interaction, deps, ['notifyMarkets']);
  assert.ok(!roles.has('R1'));
  await notify.handle(interaction, deps, ['member']); // keine Benachrichtigungs-Rolle → ignoriert
  assert.equal(replies.length, 2);
});

test('Zeitplaner veröffentlicht fällige Ankündigungen genau einmal', async () => {
  const store = tmpStore();
  const g = store.guild('G');
  g.channels.announcements = 'C';
  g.roles.notifyNews = 'R';
  g.scheduled = [
    { id: 'a', at: Date.now() - 1000, title: 'Fällig', body: 'x', authorId: '1', ping: true },
    { id: 'b', at: Date.now() + 3_600_000, title: 'Später', body: 'y', authorId: '1', ping: false },
  ];
  const sent = [];
  const channel = { isTextBased: () => true, send: async (p) => { sent.push(p); return { url: 'https://discord.com/x' }; } };
  const deps = { ctx: { channel: async () => channel, roleId: (gid, k) => g.roles[k], audit: async () => {} } };
  const scheduler = createScheduler({ store, logger: console, deps });
  const client = { guilds: { cache: new Collection([['G', { id: 'G' }]]) } };
  await scheduler.tick(client);
  await scheduler.tick(client);
  assert.equal(sent.length, 1, 'nur einmal');
  assert.deepEqual(sent[0].allowedMentions, { roles: ['R'] }, 'mit Ping der Rolle');
  assert.deepEqual(g.scheduled.map((a) => a.id), ['b']);
  scheduledCard(g.scheduled.map((a) => ({ ...a }))).components[0].toJSON();
  scheduledCard([]).components[0].toJSON();
});

test('Marktkarte pingt nur, wenn eine Rolle übergeben wird', () => {
  const m = { id: '1', title: 'T', status: 'open', yesPrice: 0.5 };
  const env = { currency: 'HugoCoins' };
  assert.deepEqual(marketCard(m, env, { pingRoleId: 'R' }).allowedMentions, { roles: ['R'] });
  assert.match(JSON.stringify(marketCard(m, env, { pingRoleId: 'R' }).components[0].toJSON()), /<@&R>/);
  assert.deepEqual(marketCard(m, env).allowedMentions, { parse: [] });
});

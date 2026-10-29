'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection } = require('discord.js');
const { Store } = require('../src/lib/store');
const notify = require('../src/interactions/notify');
const { publishAnnouncement } = require('../src/interactions/announcements');
const { marketCard } = require('../src/services/marketFeed');

const tmpStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-feat-')));

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

test('Ankündigung pingt die Rolle nur auf Wunsch', async () => {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (p) => { sent.push(p); return { url: 'https://discord.com/x' }; } };
  const deps = { ctx: { channel: async () => channel, roleId: () => 'R', audit: async () => {} } };
  await publishAnnouncement({ id: 'G' }, { title: 'A', body: 'x', authorId: '1', ping: true }, deps);
  await publishAnnouncement({ id: 'G' }, { title: 'B', body: 'y', authorId: '1', ping: false }, deps);
  assert.deepEqual(sent[0].allowedMentions, { roles: ['R'] });
  assert.deepEqual(sent[1].allowedMentions, { parse: [] });
});

test('Marktkarte pingt nur, wenn eine Rolle übergeben wird', () => {
  const m = { id: '1', title: 'T', status: 'open', yesPrice: 0.5 };
  const env = { currency: 'HugoCoins' };
  assert.deepEqual(marketCard(m, env, { pingRoleId: 'R' }).allowedMentions, { roles: ['R'] });
  assert.match(JSON.stringify(marketCard(m, env, { pingRoleId: 'R' }).components[0].toJSON()), /<@&R>/);
  assert.deepEqual(marketCard(m, env).allowedMentions, { parse: [] });
});

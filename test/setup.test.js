'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const { runSetup, planSetup } = require('../src/setup/setupServer');
const { Store } = require('../src/lib/store');
const L = require('../src/config/serverLayout');

/** Minimaler Fake-Server, der die von runSetup genutzte discord.js-API nachbildet. */
function fakeGuild(botPerms) {
  let seq = 1000;
  const roles = new Collection();
  const channels = new Collection();
  const everyone = { id: 'G', name: '@everyone', position: 0, managed: false };
  roles.set('G', everyone);
  const botRole = { id: 'BR', name: 'Bot', position: 1, managed: true };
  roles.set('BR', botRole);
  const memberRoles = new Collection([['BR', botRole]]);
  const me = {
    id: 'BOT',
    permissions: new PermissionsBitField(botPerms),
    roles: { highest: botRole, cache: memberRoles, add: async (r) => memberRoles.set(r.id, r) },
  };
  const guild = {
    id: 'G', name: 'Test', members: { me, fetchMe: async () => me },
    roles: {
      cache: roles, everyone, fetch: async () => roles,
      create: async (o) => {
        // neue Rollen landen direkt über @everyone, Bot-Rolle rutscht nach oben
        for (const r of roles.values()) if (r.id !== 'G') r.position += 1;
        const r = { id: String(seq++), position: 1, managed: false, ...o, edit: async (x) => Object.assign(r, x) };
        roles.set(r.id, r);
        return r;
      },
      setPositions: async (list) => list.forEach(({ role, position }) => { roles.get(role).position = position; }),
    },
    channels: {
      cache: channels, fetch: async () => channels,
      create: async (o) => {
        const c = { id: String(seq++), parentId: o.parent ?? null, topic: o.topic, ...o,
          permissionOverwrites: { set: async (ow) => { c.ow = ow; } }, setTopic: async (t) => { c.topic = t; } };
        c.ow = o.permissionOverwrites;
        channels.set(c.id, c);
        return c;
      },
    },
  };
  return guild;
}

const tmpStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-setup-')));
const allBot = L.REQUIRED_BOT_PERMISSIONS.reduce((a, p) => a | p, 0n);

test('Setup erstellt alles und ist beim zweiten Lauf idempotent', async () => {
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  const first = await runSetup(guild, store);
  assert.deepEqual(first.errors, []);
  const total = L.ROLES.length + L.CATEGORIES.length + L.allChannels().length;
  assert.equal(first.created.length, total);
  assert.equal(guild.channels.cache.size, L.CATEGORIES.length + L.allChannels().length);

  // Reihenfolge der Rollen entspricht dem Layout
  const ids = L.ROLES.map((r) => store.guild('G').roles[r.key]);
  const pos = ids.map((id) => guild.roles.cache.get(id).position);
  assert.deepEqual([...pos].sort((a, b) => b - a), pos);

  // Administrator-Recht kann der Bot nicht vergeben → Hinweis statt Fehler
  assert.ok(first.warnings.some((w) => w.includes('🛡️ Administrator')));

  const sizeBefore = guild.channels.cache.size + guild.roles.cache.size;
  const second = await runSetup(guild, store);
  assert.equal(second.created.length, 0);
  assert.equal(guild.channels.cache.size + guild.roles.cache.size, sizeBefore);
  assert.equal(planSetup(guild, store).channelsNew.length, 0);
});

test('Team-Channel-Overwrites: Mitglieder ohne Sicht, Bot mit Zugriff', async () => {
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  await runSetup(guild, store);
  const g = store.guild('G');
  const ow = guild.channels.cache.get(g.channels.economyLogs).ow;
  const everyone = ow.find((o) => o.id === 'G');
  assert.ok((everyone.deny & P.ViewChannel) === P.ViewChannel);
  assert.ok(!ow.some((o) => o.id === g.roles.member || o.id === g.roles.developer || o.id === g.roles.support));
  assert.ok((ow.find((o) => o.id === 'BOT').allow & P.ViewChannel) === P.ViewChannel);
});

test('Fehlende Bot-Rechte brechen verständlich ab', async () => {
  const guild = fakeGuild(P.ViewChannel | P.SendMessages);
  const res = await runSetup(guild, tmpStore());
  assert.equal(res.created.length, 0);
  assert.match(res.errors[0], /ManageRoles/);
});

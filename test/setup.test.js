'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, ChannelType, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const { runSetup, planSetup } = require('../src/setup/setupServer');
const { planCleanup, runCleanup } = require('../src/setup/cleanup');
const { Store } = require('../src/lib/store');
const L = require('../src/config/serverLayout');
const { LEGACY_CATEGORIES, LEGACY_ROLES } = require('../src/config/legacyLayout');

/** Minimaler Fake-Server, der die von runSetup genutzte discord.js-API nachbildet. */
function fakeGuild(botPerms) {
  let seq = 1000;
  const roles = new Collection();
  const channels = new Collection();
  const deleted = [];
  const everyone = { id: 'G', name: '@everyone', position: 0, managed: false };
  roles.set('G', everyone);
  const botRole = { id: 'BR', name: 'HugoPredict', position: 1, managed: true };
  roles.set('BR', botRole);
  const memberRoles = new Collection([['BR', botRole]]);
  const me = {
    id: 'BOT',
    permissions: new PermissionsBitField(botPerms),
    roles: { highest: botRole, cache: memberRoles, add: async (r) => memberRoles.set(r.id, r) },
  };
  const makeChannel = (o) => {
    const c = {
      id: String(seq++), name: o.name, type: o.type, parentId: o.parent ?? null, topic: o.topic, ow: o.permissionOverwrites, messages: ['bestehende Nachricht'], setPosition: async () => c,
      edit: async (x) => {
        if (x.name !== undefined) c.name = x.name;
        if (x.parent !== undefined) c.parentId = x.parent;
        if (x.permissionOverwrites) c.ow = x.permissionOverwrites;
        if (x.topic !== undefined) c.topic = x.topic;
        return c;
      },
      delete: async () => { deleted.push(c.id); channels.delete(c.id); },
    };
    channels.set(c.id, c);
    return c;
  };
  const guild = {
    id: 'G', name: 'Test', deleted, members: { me, fetchMe: async () => me },
    roles: {
      cache: roles, everyone, fetch: async () => roles,
      create: async (o) => {
        for (const r of roles.values()) if (r.id !== 'G') r.position += 1;
        const r = { id: String(seq++), position: 1, managed: false, ...o };
        r.edit = async (x) => Object.assign(r, x);
        r.delete = async () => { deleted.push(r.id); roles.delete(r.id); };
        roles.set(r.id, r);
        return r;
      },
      setPositions: async (list) => list.forEach(({ role, position }) => { roles.get(role).position = position; }),
    },
    channels: { cache: channels, fetch: async () => channels, create: async (o) => makeChannel(o), setPositions: async () => {} },
  };
  return guild;
}

/** Baut einen Server in der FRÜHEREN Struktur nach (wie ihn das alte /setup-server erzeugt hat). */
async function legacyGuild({ withStore }) {
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  const g = store.guild('G');
  for (const [key, name] of LEGACY_ROLES) {
    const r = await guild.roles.create({ name });
    if (withStore) g.roles[key] = r.id;
  }
  for (const cat of LEGACY_CATEGORIES) {
    const c = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory });
    if (withStore) g.categories[cat.key] = c.id;
    for (const [key, name, type] of cat.channels) {
      const ch = await guild.channels.create({ name, type, parent: c.id });
      if (withStore) g.channels[key] = ch.id;
    }
  }
  if (withStore) g.setupCompletedAt = '2026-10-28T00:00:00Z';
  return { guild, store };
}

const tmpStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-setup-')));
const allBot = L.REQUIRED_BOT_PERMISSIONS.reduce((a, p) => a | p, 0n);
const legacyChannelCount = LEGACY_CATEGORIES.reduce((a, c) => a + c.channels.length, 0);
// Channels des neuen Layouts, die einen Vorgänger haben (werden migriert statt neu angelegt)
const migratable = L.allChannels().filter((c) => c.legacy?.length).length;
const brandNew = L.allChannels().length - migratable;

test('Neuer Server: alles wird erstellt, zweiter Lauf ist idempotent', async () => {
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  const first = await runSetup(guild, store);
  assert.deepEqual(first.errors, []);
  assert.equal(first.created.length, L.ROLES.length + L.CATEGORIES.length + L.allChannels().length);
  assert.equal(first.obsolete.length, 0);
  assert.ok(first.warnings.some((w) => w.startsWith('| Administrator:')), 'Hinweis zum Administrator-Recht');

  const ids = L.ROLES.map((r) => store.guild('G').roles[r.key]);
  const pos = ids.map((id) => guild.roles.cache.get(id).position);
  assert.deepEqual([...pos].sort((a, b) => b - a), pos, 'Rollen-Reihenfolge');

  const before = guild.channels.cache.size + guild.roles.cache.size;
  const second = await runSetup(guild, store);
  assert.equal(second.created.length + second.updated.length, 0);
  assert.equal(guild.channels.cache.size + guild.roles.cache.size, before);
});

for (const withStore of [true, false]) {
  test(`Migration der früheren Struktur (${withStore ? 'mit' : 'ohne'} gespeicherte IDs): umbenennen statt duplizieren, nichts löschen`, async () => {
    const { guild, store } = await legacyGuild({ withStore });
    const g = store.guild('G');
    const oldLive = guild.channels.cache.find((c) => c.name === '📈・live-markets');
    const channelsBefore = guild.channels.cache.size;
    const rolesBefore = guild.roles.cache.size;

    const plan = planSetup(guild, store);
    assert.equal(plan.channelsNew.length, brandNew, 'nur Channels ohne Vorgänger werden neu angelegt');
    assert.equal(plan.channelsMigrated.length, migratable);
    const newRoles = L.ROLES.filter((r) => !r.legacyNames?.some((n) => guild.roles.cache.some((x) => x.name === n))).length;
    assert.equal(plan.rolesNew, newRoles, 'nur Rollen ohne Vorgänger sind neu');
    assert.equal(plan.rolesRenamed.length, L.ROLES.length - newRoles);

    const res = await runSetup(guild, store);
    assert.deepEqual(res.errors, []);
    assert.equal(res.created.length, brandNew + newRoles, 'keine Duplikate');
    assert.equal(guild.channels.cache.size, channelsBefore + brandNew, 'kein Channel gelöscht, nur neue hinzugefügt');
    assert.equal(guild.roles.cache.size, rolesBefore + newRoles, 'keine Rolle gelöscht, nur neue hinzugefügt');
    assert.equal(guild.deleted.length, 0);

    // Vorgänger behält ID und Nachrichten, bekommt neuen Namen, neue Kategorie und neue Rechte
    assert.equal(g.channels.marketOverview, oldLive.id);
    assert.equal(oldLive.name, '📈┃prognosen');
    assert.equal(oldLive.parentId, g.categories.info);
    assert.deepEqual(oldLive.messages, ['bestehende Nachricht']);
    const audit = guild.channels.cache.get(g.channels.audit);
    assert.equal(audit.name, '🧾┃prüfprotokoll');
    assert.ok((audit.ow.find((o) => o.id === 'G').deny & P.ViewChannel) === P.ViewChannel, 'Prüfprotokoll geschützt');
    assert.ok(!audit.ow.some((o) => o.id === g.roles.member || o.id === g.roles.support), 'kein Zugriff für Mitglied/Kundenservice');

    // Rollen umbenannt
    assert.equal(guild.roles.cache.get(g.roles.owner).name, '| Inhaber');
    assert.equal(guild.roles.cache.get(g.roles.support).name, '| Supporter');
    assert.equal(guild.roles.cache.get(g.roles.bots).name, '| Hugo Predict');

    // Veraltetes nur gemeldet
    const obsoleteChannels = legacyChannelCount - migratable;
    assert.equal(res.obsolete.filter((o) => o.startsWith('#')).length, obsoleteChannels);
    assert.ok(res.obsolete.includes('Rolle 💎 Diamond Trader'));
    assert.ok(res.obsolete.includes('Kategorie 📊 MARKETS'));
    assert.equal(res.archived.length, 0);

    // Zweiter Lauf: nichts mehr zu tun
    const again = await runSetup(guild, store);
    assert.equal(again.created.length + again.updated.length, 0);
    assert.equal(planSetup(guild, store).channelsMigrated.length, 0);
  });
}

test('Archivieren verschiebt veraltete Channels in eine versteckte Kategorie, ohne zu löschen', async () => {
  const { guild, store } = await legacyGuild({ withStore: true });
  const before = guild.channels.cache.size;
  const res = await runSetup(guild, store, { archiveObsolete: true });
  assert.deepEqual(res.errors, []);
  const archiveId = store.guild('G').categories.archive;
  const archive = guild.channels.cache.get(archiveId);
  assert.equal(archive.name, 'ARCHIV');
  assert.equal(guild.channels.cache.size, before + 1 + brandNew, 'nur Archiv-Kategorie und neue Channels kommen hinzu');
  assert.equal(guild.deleted.length, 0);
  const archived = guild.channels.cache.filter((c) => c.parentId === archiveId);
  assert.equal(archived.size, legacyChannelCount - migratable);
  for (const ch of archived.values()) {
    const ev = ch.ow.find((o) => o.id === 'G');
    assert.ok((ev.deny & P.ViewChannel) === P.ViewChannel, `${ch.name} ist versteckt`);
    assert.deepEqual(ch.messages, ['bestehende Nachricht']);
  }
  // Erneutes Archivieren legt keine zweite Archiv-Kategorie an
  const again = await runSetup(guild, store, { archiveObsolete: true });
  assert.equal(again.created.length, 0);
  assert.equal(guild.channels.cache.filter((c) => c.name === 'ARCHIV').size, 1);
});

test('Zwischenversion: Kundenservice und Bot werden zu Supporter und Hugo Predict', async () => {
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  await guild.roles.create({ name: 'Kundenservice' });
  await guild.roles.create({ name: 'Bot' });
  const res = await runSetup(guild, store);
  assert.deepEqual(res.errors, []);
  const g = store.guild('G');
  assert.equal(guild.roles.cache.get(g.roles.support).name, '| Supporter');
  assert.equal(guild.roles.cache.get(g.roles.bots).name, '| Hugo Predict');
  assert.equal(guild.roles.cache.filter((r) => r.name === '| Supporter').size, 1, 'kein Duplikat');
});

test('Rollen-Icons nur mit Boost-Funktion und ohne vorhandenes Icon', async () => {
  for (const features of [[], ['ROLE_ICONS']]) {
    const guild = fakeGuild(allBot);
    guild.features = features;
    const store = tmpStore();
    const origCreate = guild.roles.create;
    guild.roles.create = async (o) => {
      const r = await origCreate(o);
      r.icon = null;
      r.setIcon = async (buf) => { assert.ok(Buffer.isBuffer(buf)); r.icon = 'hash'; };
      return r;
    };
    const res = await runSetup(guild, store);
    const icons = res.updated.filter((u) => u.startsWith('Rollen-Icon'));
    assert.equal(icons.length, features.length ? L.ROLES.length : 0);
    const again = await runSetup(guild, store);
    assert.equal(again.updated.filter((u) => u.startsWith('Rollen-Icon')).length, 0, 'vorhandene Icons bleiben');
  }
});

test('Aufräumen löscht nur Archiv, leere Alt-Kategorien und optional alte Rollen', async () => {
  const { guild, store } = await legacyGuild({ withStore: true });
  await runSetup(guild, store, { archiveObsolete: true });
  const g = store.guild('G');
  const activeIds = [...L.allChannels().map((c) => g.channels[c.key]), ...L.CATEGORIES.map((c) => g.categories[c.key])];
  const activeRoles = L.ROLES.map((r) => g.roles[r.key]);

  // Eine alte Kategorie mit einem verbliebenen Channel darf nicht gelöscht werden
  const keepCat = guild.channels.cache.find((c) => c.name === '🔊 VOICE');
  const stray = await guild.channels.create({ name: 'eigener-channel', type: ChannelType.GuildText, parent: keepCat.id });

  const withoutRoles = planCleanup(guild, store);
  assert.equal(withoutRoles.roles.length, 0);
  const plan = planCleanup(guild, store, { includeRoles: true });
  assert.equal(plan.channels.length, legacyChannelCount - migratable);
  assert.ok(plan.categories.some((c) => c.name === 'ARCHIV'));
  assert.ok(plan.categories.some((c) => c.name === '📊 MARKETS'));
  assert.ok(!plan.categories.some((c) => c.id === keepCat.id), 'nicht leere Kategorie bleibt');
  assert.deepEqual(plan.roles.map((r) => r.name).sort(), ['💎 Diamond Trader', '📈 Trader']);

  const res = await runCleanup(guild, store, plan);
  assert.deepEqual(res.errors, []);
  for (const id of activeIds) assert.ok(guild.channels.cache.has(id), `aktiver Channel ${id} erhalten`);
  for (const id of activeRoles) assert.ok(guild.roles.cache.has(id), `aktive Rolle ${id} erhalten`);
  assert.ok(guild.channels.cache.has(stray.id) && guild.channels.cache.has(keepCat.id));
  assert.ok(!guild.channels.cache.some((c) => c.name === 'ARCHIV'));
  assert.equal(g.categories.archive, undefined, 'Store bereinigt');

  // Danach ist die Struktur weiterhin vollständig und idempotent
  const again = await runSetup(guild, store);
  assert.equal(again.created.length, 0);
  assert.equal(planCleanup(guild, store, { includeRoles: true }).channels.length, 0);
});

test('Fehlende Bot-Rechte brechen verständlich ab', async () => {
  const res = await runSetup(fakeGuild(P.ViewChannel | P.SendMessages), tmpStore());
  assert.equal(res.created.length, 0);
  assert.match(res.errors[0], /ManageRoles/);
});

test('syncRoleNames benennt nur Rollen mit früherem Namen um', async () => {
  const { syncRoleNames } = require('../src/setup/setupServer');
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  const g = store.guild('G');
  const support = await guild.roles.create({ name: 'Kundenservice' });
  const bot = await guild.roles.create({ name: 'Bot' });
  const owner = await guild.roles.create({ name: 'Mein eigener Name' });
  for (const r of [support, bot, owner]) r.setName = async (n) => { r.name = n; };
  Object.assign(g.roles, { support: support.id, bots: bot.id, owner: owner.id });
  const res = await syncRoleNames(guild, store);
  assert.deepEqual(res.renamed.sort(), ['Bot → | Hugo Predict', 'Kundenservice → | Supporter']);
  assert.equal(owner.name, 'Mein eigener Name', 'frei vergebene Namen bleiben');
  assert.equal((await syncRoleNames(guild, store)).renamed.length, 0, 'idempotent');
});

test('ensureMissingChannels legt nur fehlende Channels an und ändert nichts Bestehendes', async () => {
  const { ensureMissingChannels } = require('../src/setup/setupServer');
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  await runSetup(guild, store);
  const g = store.guild('G');
  // #willkommen entfernen, wie auf einem Server, der vor der Erweiterung eingerichtet wurde
  const greeting = guild.channels.cache.get(g.channels.greeting);
  guild.channels.cache.delete(greeting.id);
  delete g.channels.greeting;
  const snap = (c) => JSON.stringify([c.name, c.parentId, c.ow], (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const before = new Map([...guild.channels.cache.values()].map((c) => [c.id, snap(c)]));
  for (const c of guild.channels.cache.values()) c.setPosition = async () => {};
  const res = await ensureMissingChannels(guild, store);
  assert.deepEqual(res.created, ['#👋┃willkommen']);
  const created = guild.channels.cache.get(g.channels.greeting);
  assert.equal(created.parentId, g.categories.info);
  for (const [id, saved] of before) assert.equal(snap(guild.channels.cache.get(id)), saved, 'unverändert');
  created.setPosition = async () => {};
  assert.equal((await ensureMissingChannels(guild, store)).created.length, 0, 'idempotent');
});

test('syncChannelNames benennt #dokumentation in #regeln um, sonst nichts', async () => {
  const { syncChannelNames } = require('../src/setup/setupServer');
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  await runSetup(guild, store);
  const g = store.guild('G');
  const docs = guild.channels.cache.get(g.channels.docs);
  docs.name = 'dokumentation';
  const custom = guild.channels.cache.get(g.channels.discussions);
  custom.name = 'mein-chat';
  for (const c of guild.channels.cache.values()) c.setName = async (n) => { c.name = n; };
  const res = await syncChannelNames(guild, store);
  assert.deepEqual(res.renamed.filter((r) => r.startsWith('#dokumentation')), ['#dokumentation → #📜┃regeln']);
  assert.equal(docs.name, '📜┃regeln');
  assert.equal(custom.name, 'mein-chat', 'selbst gewählte Namen bleiben');
  assert.equal((await syncChannelNames(guild, store)).renamed.length, 0);
});

test('ensureMissingRoles legt nur neue Rollen an', async () => {
  const { ensureMissingRoles } = require('../src/setup/setupServer');
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  await runSetup(guild, store);
  const g = store.guild('G');
  const keep = guild.roles.cache.get(g.roles.owner);
  guild.roles.cache.delete(g.roles.notifyMarkets);
  delete g.roles.notifyMarkets;
  const res = await ensureMissingRoles(guild, store);
  assert.deepEqual(res.created, ['ping:Neue Prognosen']);
  assert.ok(guild.roles.cache.has(keep.id));
  // Bewusst gelöschte optionale Rollen kommen nicht zurück
  for (const k of ['developer', 'moderator']) { guild.roles.cache.delete(g.roles[k]); delete g.roles[k]; }
  assert.equal((await ensureMissingRoles(guild, store)).created.length, 0, 'optionale Rollen nicht neu');
  assert.equal((await ensureMissingRoles(guild, store)).created.length, 0, 'idempotent');
});

test('syncChannelNames setzt den Strich vor alle bisherigen Namen', async () => {
  const { syncChannelNames } = require('../src/setup/setupServer');
  const guild = fakeGuild(allBot);
  const store = tmpStore();
  await runSetup(guild, store);
  const g = store.guild('G');
  for (const def of L.allChannels()) {
    const ch = guild.channels.cache.get(g.channels[def.key]);
    ch.name = def.previousNames[0]; // aktueller Stand auf dem Server (nur Strich)
    ch.setName = async (n) => { ch.name = n; };
  }
  const res = await syncChannelNames(guild, store);
  assert.equal(res.renamed.length, L.allChannels().length);
  for (const def of L.allChannels()) assert.equal(guild.channels.cache.get(g.channels[def.key]).name, def.name);
});

test('lockNicknames entzieht @everyone und Community-Rollen „Nickname ändern“', async () => {
  const { lockNicknames } = require('../src/setup/setupServer');
  const mk = (id, name, position, perms) => {
    const r = { id, name, position, permissions: new PermissionsBitField(perms) };
    r.setPermissions = async (p) => { r.permissions = new PermissionsBitField(p); };
    return r;
  };
  const everyone = mk('G', '@everyone', 0, [P.ViewChannel, P.ChangeNickname]);
  const member = mk('M', '| Mitglied', 1, [P.ChangeNickname]);
  const admin = mk('A', '| Administrator', 2, [P.ChangeNickname, P.ManageNicknames]);
  const cache = new Map([[everyone.id, everyone], [member.id, member], [admin.id, admin]]);
  const guild = { id: 'G', roles: { everyone, cache }, members: { me: { roles: { highest: { position: 10 } } } } };
  const store = tmpStore();
  Object.assign(store.guild('G').roles, { member: 'M', admin: 'A' });
  const res = await lockNicknames(guild, store);
  assert.deepEqual(res.changed, ['@everyone', '| Mitglied']);
  assert.ok(!everyone.permissions.has(P.ChangeNickname) && everyone.permissions.has(P.ViewChannel));
  assert.ok(!member.permissions.has(P.ChangeNickname));
  assert.ok(admin.permissions.has(P.ChangeNickname), 'Teamrollen unverändert');
  assert.equal((await lockNicknames(guild, store)).changed.length, 0, 'idempotent');
});

test('retireChangedChannels: leerer alter Channel wird ersetzt, benutzter umbenannt', async () => {
  const { retireChangedChannels } = require('../src/setup/setupServer');
  const L2 = require('../src/config/serverLayout');
  const ideas = L2.allChannels().find((c) => c.key === 'ideas');
  assert.equal(ideas.type, ChannelType.GuildForum);
  assert.ok(ideas.forum.availableTags.some((t) => t.name === 'Angenommen' && t.moderated));
  assert.ok(ideas.forum.availableTags.some((t) => t.name === 'Bot' && !t.moderated));

  const make = (id, botOnly) => {
    const ch = {
      id, name: '💡┃vorschläge', type: ChannelType.GuildText, isTextBased: () => true, deleted: false,
      messages: { fetch: async () => new Collection([['1', { author: { bot: botOnly } }]]) },
      delete: async () => { ch.deleted = true; }, setName: async (n) => { ch.name = n; },
    };
    return ch;
  };
  for (const botOnly of [true, false]) {
    const store = tmpStore();
    const old = make('OLD', botOnly);
    store.guild('G').channels.ideas = 'OLD';
    const guild = { id: 'G', channels: { cache: new Collection([['OLD', old]]) } };
    const res = await retireChangedChannels(guild, store);
    assert.equal(store.guild('G').channels.ideas, undefined, 'Platz frei für das Forum');
    if (botOnly) assert.ok(old.deleted && res.removed.length === 1);
    else assert.ok(!old.deleted && old.name === '💡┃vorschläge-alt' && res.kept.length === 1, 'Inhalte bleiben erhalten');
  }
});

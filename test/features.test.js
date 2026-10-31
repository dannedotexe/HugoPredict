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

test('Benachrichtigungs-Karte zieht nach #pings um; alte Nachricht wird entfernt', async () => {
  const { publishPanels } = require('../src/setup/panels');
  const store = tmpStore();
  const g = store.guild('G');
  const BOT = 'BOT';
  const deleted = [];
  let seq = 1;
  const makeChannel = (id) => {
    const msgs = new Map();
    return {
      id, isTextBased: () => true, msgs,
      send: async () => { const m = { id: `m${seq++}`, author: { id: BOT }, edit: async () => m, delete: async () => { deleted.push(m.id); msgs.delete(m.id); } }; msgs.set(m.id, m); return m; },
      messages: { fetch: async (mid) => msgs.get(mid) ?? null },
    };
  };
  const channels = new Collection(['docs', 'pings', 'support', 'mo', 'sys', 'ctl', 'apply', 'howto', 'mcp', 'ver'].map((id) => [id, makeChannel(id)]));
  Object.assign(g.channels, { docs: 'docs', pings: 'pings', support: 'support', marketOverview: 'mo', system: 'sys', supportControl: 'ctl', apply: 'apply', howto: 'howto', minecraftPanel: 'mcp', verify: 'ver' });
  const oldMsg = await channels.get('docs').send();
  g.panels.notify = { channelId: 'docs', messageId: oldMsg.id };
  const guild = { id: 'G', client: { user: { id: BOT } }, channels: { cache: channels, fetch: async (id) => channels.get(id) } };
  const res = await publishPanels(guild, { store, env: { currency: 'HugoCoins', websiteUrl: '' }, statusService: { buildPayload: async () => ({ components: [] }) } });
  assert.deepEqual(res.errors, []);
  assert.ok(deleted.includes(oldMsg.id), 'alte Karte in #regeln entfernt');
  assert.equal(g.panels.notify.channelId, 'pings');
  assert.ok(channels.get('pings').msgs.has(g.panels.notify.messageId));
});

test('Kontoverknüpfung vergibt nur Mitglied und Verifiziert und setzt den Minecraft-Namen', async () => {
  const { checkVerification } = require('../src/interactions/verification');
  const added = [];
  const interaction = {
    guild: { id: 'G' }, user: { id: '1' },
    member: { nickname: null, roles: { cache: new Collection(), add: async (ids) => added.push(...ids) }, setNickname: async (n) => { interaction.member.nickname = n; } },
    replied: false, deferred: false,
    deferReply: async () => { interaction.deferred = true; }, editReply: async () => {}, followUp: async () => {}, reply: async () => {},
  };
  const ids = { member: 'M', verified: 'V', notifyMarkets: 'N1', notifyNews: 'N2' };
  const deps = {
    api: { getVerificationStatus: async () => ({ verified: true, minecraftName: 'Steve' }) },
    ctx: { roleId: (g, k) => ids[k], audit: async () => {}, hasRoleKey: () => false }, logger: console,
  };
  await checkVerification(interaction, deps);
  assert.deepEqual(added.sort(), ['M', 'V']);
  assert.equal(interaction.member.nickname, 'Steve', 'Server-Name = Minecraft-Name');
});

test('Minecraft-Code in Discord: falscher Code meldet Versuche, richtiger vergibt Rollen und Namen', async () => {
  const { confirmMinecraftCode } = require('../src/interactions/verification');
  const replies = [];
  const added = [];
  const makeInteraction = () => {
    const i = {
      guild: { id: 'G' }, user: { id: '1', username: 'steve' },
      member: { nickname: null, roles: { cache: new Collection(), add: async (ids) => added.push(...ids) }, setNickname: async (n) => { i.member.nickname = n; } },
      replied: false, deferred: false,
      deferReply: async () => { i.deferred = true; }, editReply: async (p) => replies.push(p), followUp: async (p) => replies.push(p), reply: async (p) => replies.push(p),
    };
    return i;
  };
  const results = [{ error: 'wrong', attemptsLeft: 4 }, { player: { username: 'Steve', uuid: 'u' } }];
  const deps = {
    minecraft: { confirmLinkCode: () => results.shift(), saveLink: async () => ({ synced: false }), forgetLink: () => {} },
    ctx: { roleId: (g, k) => ({ member: 'M', verified: 'V' })[k], audit: async () => {}, hasRoleKey: () => false }, logger: console,
  };
  await confirmMinecraftCode(makeInteraction(), 'XXXXXX', deps);
  assert.match(JSON.stringify(replies.at(-1)), /Noch 4 Versuch/);
  const ok = makeInteraction();
  await confirmMinecraftCode(ok, 'ABCDEF', deps);
  assert.deepEqual(added.sort(), ['M', 'V']);
  assert.equal(ok.member.nickname, 'Steve');
  assert.match(JSON.stringify(replies.at(-1)), /sobald sie verbunden ist/);
});

test('Warteraum meldet wartende Person einmal mit Supporter-Ping', async () => {
  const { createSupportVoiceService } = require('../src/services/supportVoice');
  const store = tmpStore();
  Object.assign(store.guild('G').channels, { waitingRoom: 'W', supportRoom1: 'S1' });
  const sent = [];
  const channel = { isTextBased: () => true, send: async (p) => sent.push(p) };
  const ctx = { channel: async () => channel, roleId: (g, k) => (k === 'support' ? 'R' : null), can: () => false };
  const svc = createSupportVoiceService({ store, ctx, logger: console, renderDelayMs: 1e6 });
  const guild = { id: 'G', channels: { cache: new Collection() } };
  const member = { id: '7', user: { bot: false } };
  await svc.onVoiceStateUpdate({ channelId: null }, { guild, member, channelId: 'W' });
  await svc.onVoiceStateUpdate({ channelId: 'W' }, { guild, member, channelId: 'S1' }); // verschoben
  await svc.onVoiceStateUpdate({ channelId: null }, { guild, member, channelId: 'W' }); // innerhalb 5 min erneut
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { roles: ['R'] });
  assert.match(JSON.stringify(sent[0]), /<#S1>/);
  assert.match(JSON.stringify(sent[0]), /Platz 1/);
});

test('Warteschlange im Warteraum-Chat: Reihenfolge nach Ankunft, Team zählt nicht, Limit sichtbar', async () => {
  const { createSupportVoiceService } = require('../src/services/supportVoice');
  const store = tmpStore();
  store.guild('G').channels.waitingRoom = 'W';
  let t = 1_000_000;
  const posted = [];
  const members = new Collection();
  const waiting = {
    id: 'W', members, isTextBased: () => true,
    send: async (p) => { posted.push(p); return { id: 'q1', edit: async (e) => { posted.push(e); return { id: 'q1' }; } }; },
    messages: { fetch: async () => ({ id: 'q1', edit: async (e) => { posted.push(e); return { id: 'q1' }; } }) },
  };
  const guild = { id: 'G', channels: { cache: new Collection([['W', waiting]]) } };
  const ctx = { channel: async () => ({ isTextBased: () => true, send: async () => {} }), roleId: () => null, can: (m) => m.id === 'staff' };
  const svc = createSupportVoiceService({ store, ctx, logger: console, now: () => t, renderDelayMs: 1e6 });
  const join = async (id) => {
    const m = { id, user: { bot: false } };
    members.set(id, m);
    t += 1000;
    await svc.onVoiceStateUpdate({ channelId: null }, { guild, member: m, channelId: 'W' });
  };
  await join('anna');
  await join('staff');
  await join('ben');
  let text = JSON.stringify(svc.buildQueueCard(guild));
  assert.ok(text.indexOf('<@anna>') < text.indexOf('<@ben>'), 'Anna zuerst');
  assert.ok(!text.includes('<@staff> · wartet'), 'Team steht nicht in der Schlange');
  assert.match(text, /2 von 5 Plätzen belegt/);
  assert.match(text, /Team im Support.*<@staff>/, 'Team wird angezeigt');
  // Team in einem Support-Raum zählt ebenfalls
  members.delete('staff');
  store.guild('G').channels.supportRoom1 = 'S1';
  guild.channels.cache.set('S1', { members: new Collection([['staff', { id: 'staff', user: { bot: false } }]]) });
  assert.match(JSON.stringify(svc.buildQueueCard(guild)), /Team im Support.*<@staff>/);

  members.delete('anna');
  await svc.onVoiceStateUpdate({ channelId: 'W' }, { guild, member: { id: 'anna', user: {} }, channelId: null });
  await svc.refresh(guild);
  text = JSON.stringify(posted.at(-1));
  assert.match(text, /\*\*1\.\*\* <@ben>/);
  assert.equal(store.guild('G').panels.queue.messageId, 'q1');
  assert.deepEqual(posted.at(-1).allowedMentions, { parse: [] }, 'niemand wird gepingt');
});

test('Support-Warteraum öffnen/schließen ändert „Verbinden“ und meldet nur, wenn offen', async () => {
  const { createSupportVoiceService, setSupportOpen } = require('../src/services/supportVoice');
  const { panelDefinitions } = require('../src/setup/panels');
  const store = tmpStore();
  store.guild('G').channels.waitingRoom = 'W';
  const edits = [];
  const waiting = { permissionOverwrites: { edit: async (target, perms) => edits.push([target, perms]) } };
  const guild = { id: 'G', roles: { everyone: 'EV' }, channels: { cache: new Collection([['W', waiting]]), fetch: async () => null } };
  assert.equal(await setSupportOpen(guild, store, false), true);
  assert.deepEqual(edits[0], ['EV', { Connect: false }]);
  assert.equal(store.guild('G').supportVoice.open, false);

  const sent = [];
  const ctx = { channel: async () => ({ isTextBased: () => true, send: async (p) => sent.push(p) }), roleId: () => null, can: () => false };
  const svc = createSupportVoiceService({ store, ctx, logger: console, renderDelayMs: 1e6 });
  await svc.onVoiceStateUpdate({ channelId: null }, { guild, member: { id: '7', user: {} }, channelId: 'W' });
  assert.equal(sent.length, 0, 'geschlossen: keine Meldung');

  const control = panelDefinitions().find((d) => d.key === 'supportControl');
  const closed = JSON.stringify(control.build({ channelIds: { waitingRoom: 'W' }, supportOpen: false }));
  assert.match(closed, /Geschlossen/);
  const tickets = JSON.stringify(panelDefinitions().find((d) => d.key === 'tickets').build({ channelIds: { waitingRoom: 'W' }, supportOpen: true }));
  assert.match(tickets, /Sprach-Support/);
});

test('Warteraum leeren trennt nur Wartende, nicht Team oder Bots', async () => {
  const { emptyWaitingRoom } = require('../src/services/supportVoice');
  const store = tmpStore();
  store.guild('G').channels.waitingRoom = 'W';
  const kicked = [];
  const m = (id, extra = {}) => ({ id, user: { bot: false }, voice: { disconnect: async () => kicked.push(id) }, ...extra });
  const members = new Collection([['a', m('a')], ['b', m('b')], ['staff', m('staff')], ['bot', m('bot', { user: { bot: true } })]]);
  const guild = { id: 'G', channels: { cache: new Collection([['W', { members }]]) } };
  assert.equal(await emptyWaitingRoom(guild, store, (x) => x.id === 'staff'), 2);
  assert.deepEqual(kicked.sort(), ['a', 'b']);
  store.guild('G').channels.waitingRoom = null;
  assert.equal(await emptyWaitingRoom(guild, store, () => false), null);
});

test('Warteraum-Chat: Schreibsperre für alle, nur fehlende Rechte werden gesetzt', async () => {
  const { syncWaitingRoom } = require('../src/services/supportVoice');
  const { PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
  const store = tmpStore();
  Object.assign(store.guild('G').channels, { waitingRoom: 'W' });
  Object.assign(store.guild('G').roles, { support: 'SUP' });
  const edits = [];
  const cache = new Collection();
  const waiting = {
    userLimit: 0,
    setUserLimit: async (n) => { waiting.userLimit = n; },
    permissionOverwrites: {
      cache,
      edit: async (target, perms) => {
        const id = target.id ?? target;
        edits.push([id, perms]);
        const allow = Object.entries(perms).filter(([, v]) => v).map(([k]) => P[k]);
        const deny = Object.entries(perms).filter(([, v]) => !v).map(([k]) => P[k]);
        cache.set(id, { allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) });
      },
    },
  };
  const guild = { id: 'G', roles: { everyone: { id: 'EV' }, cache: new Collection([['SUP', {}]]) }, channels: { cache: new Collection([['W', waiting]]) } };
  await syncWaitingRoom(guild, store);
  assert.equal(waiting.userLimit, 5);
  assert.deepEqual(edits.map((e) => e[0]), ['EV', 'SUP']);
  assert.equal(edits[0][1].SendMessages, false);
  await syncWaitingRoom(guild, store);
  assert.equal(edits.length, 2, 'zweiter Lauf ändert nichts');
});

test('Nächsten holen: Platz 1 in den eigenen Support-Raum, Gespräch beenden trennt nur Gäste', async () => {
  const { createSupportVoiceService } = require('../src/services/supportVoice');
  const store = tmpStore();
  Object.assign(store.guild('G').channels, { waitingRoom: 'W', supportRoom1: 'S1', supportRoom2: 'S2' });
  let t = 1000;
  const rooms = { W: new Collection(), S1: new Collection(), S2: new Collection() };
  const dms = [];
  const person = (id) => {
    const m = {
      id, user: { bot: false, username: id }, displayName: id,
      voice: { channelId: null, setChannel: async (room) => { rooms[m.voice.channelId].delete(id); rooms[room.id].set(id, m); m.voice.channelId = room.id; }, disconnect: async () => { rooms[m.voice.channelId].delete(id); m.voice.channelId = null; } },
      send: async (text) => dms.push([id, text]),
    };
    return m;
  };
  const place = (m, roomId) => { rooms[roomId].set(m.id, m); m.voice.channelId = roomId; };
  const channel = (id) => ({ id, name: id, members: rooms[id], isTextBased: () => false });
  const guild = { id: 'G', channels: { cache: new Collection(Object.keys(rooms).map((id) => [id, channel(id)])) } };
  const ctx = { channel: async () => null, roleId: () => null, can: (m) => m.id === 'staff' };
  const svc = createSupportVoiceService({ store, ctx, logger: console, now: () => t, renderDelayMs: 1e6 });

  const staff = person('staff');
  const anna = person('anna');
  const ben = person('ben');
  for (const m of [anna, ben]) {
    place(m, 'W');
    t += 1000;
    await svc.onVoiceStateUpdate({ channelId: null }, { guild, member: m, channelId: 'W' });
  }
  place(staff, 'S2');

  let res = await svc.takeNext(guild, staff);
  assert.equal(res.member.id, 'anna', 'Platz 1 zuerst');
  assert.equal(anna.voice.channelId, 'S2', 'in den Raum des Teammitglieds');
  assert.match(dms[0][1], /Du bist dran/);
  assert.equal((await svc.takeNext(guild, staff)).error, 'room_busy', 'erst Gespräch beenden');

  res = await svc.endConversation(guild, staff);
  assert.equal(res.removed, 1);
  assert.equal(staff.voice.channelId, 'S2', 'Team bleibt');
  assert.equal(anna.voice.channelId, null);

  res = await svc.takeNext(guild, staff);
  assert.equal(res.member.id, 'ben');
  await svc.endConversation(guild, staff);
  assert.equal((await svc.takeNext(guild, staff)).error, 'empty');

  // Nicht in einem Support-Raum: nächster freier Raum, Beenden geht nicht
  place(person('carl'), 'W');
  staff.voice.channelId = null;
  rooms.S2.delete('staff');
  res = await svc.takeNext(guild, staff);
  assert.equal(res.room.id, 'S1');
  assert.equal((await svc.endConversation(guild, staff)).error, 'not_in_room');
});

test('Vorlage im Forum: einmal erstellen, angepinnt und gesperrt, danach nur bearbeiten', async () => {
  const { publishIdeasTemplate } = require('../src/setup/panels');
  const { ChannelType } = require('discord.js');
  const store = tmpStore();
  const g = store.guild('G');
  g.channels.ideas = 'F';
  const created = [];
  const edits = [];
  const thread = {
    id: 'T', archived: false, locked: false, pinned: false,
    flags: { has: () => thread.pinned },
    pin: async () => { thread.pinned = true; },
    setLocked: async (v) => { thread.locked = v; },
    fetchStarterMessage: async () => ({ edit: async (p) => edits.push(p) }),
  };
  const forum = {
    id: 'F', type: ChannelType.GuildForum,
    threads: { create: async (opts) => { created.push(opts); return thread; }, fetch: async (id) => (id === 'T' ? thread : null) },
  };
  const guild = { id: 'G', channels: { cache: new Collection([['F', forum]]) } };
  const first = await publishIdeasTemplate(guild, g);
  assert.equal(first.created, true);
  assert.match(created[0].name, /Vorlage/);
  assert.match(created[0].message.content, /Vorlage zum Kopieren/);
  assert.ok(thread.pinned && thread.locked);
  const second = await publishIdeasTemplate(guild, g);
  assert.equal(second.created, false);
  assert.equal(created.length, 1, 'nicht doppelt');
  assert.equal(edits.length, 1);
});

test('Forum-Vorschläge: neu → In Prüfung, neuer Status ersetzt den alten, Bereich bleibt', async () => {
  const { createIdeasForumService } = require('../src/services/ideasForum');
  const store = tmpStore();
  const g = store.guild('G');
  g.channels.ideas = 'F';
  g.panels.ideasTemplate = { channelId: 'F', threadId: 'TPL' };
  const parent = { availableTags: [
    { id: 'bot', name: 'Bot' }, { id: 'pruef', name: 'In Prüfung' }, { id: 'ok', name: 'Angenommen' }, { id: 'no', name: 'Abgelehnt' },
  ] };
  const post = (id, tags) => {
    const t = { id, guild: { id: 'G' }, parentId: 'F', parent, appliedTags: tags };
    t.setAppliedTags = async (next) => { t.appliedTags = next; };
    return t;
  };
  const svc = createIdeasForumService({ store, logger: console });
  const p = post('P1', ['bot']);
  await svc.onThreadCreate(p, true);
  assert.deepEqual(p.appliedTags, ['bot', 'pruef']);

  const before = { appliedTags: [...p.appliedTags] };
  p.appliedTags = ['bot', 'pruef', 'ok']; // Team setzt „Angenommen“
  await svc.onThreadUpdate(before, p);
  assert.deepEqual(p.appliedTags, ['bot', 'ok']);

  const tpl = post('TPL', []);
  await svc.onThreadCreate(tpl, true);
  assert.deepEqual(tpl.appliedTags, [], 'Vorlage bekommt keinen Status');
});

test('Bewerbungen: nur nach Regeln, eine offene pro Person, Annahme vergibt die Rolle', async () => {
  const apps = require('../src/interactions/applications');
  const { panelDefinitions } = require('../src/setup/panels');
  const { APPLICATION_POSITIONS } = require('../src/config/serverLayout');
  const store = tmpStore();
  const g = store.guild('G');
  g.channels.applications = 'APPS';
  const pos = APPLICATION_POSITIONS.find((p) => p.key === 'support');
  const roles = new Set();
  const member = { id: '5', joinedAt: new Date('2026-10-01'), roles: { add: async (id) => roles.add(id) } };
  const has = { member: false };
  const sent = [];
  const review = { id: 'APPS', isTextBased: () => true, send: async (p) => { sent.push(p); return { id: 'm1', edit: async (e) => { sent.push(e); return { id: 'm1' }; } }; }, messages: { fetch: async () => ({ id: 'm1', edit: async (e) => { sent.push(e); return { id: 'm1' }; } }) } };
  const audits = [];
  const deps = {
    store,
    locks: { run: async (k, fn) => ({ locked: false, value: await fn() }) },
    ctx: {
      hasRoleKey: (m, key) => Boolean(has[key]), roleId: (gid, key) => (key === 'support' ? 'SUP' : null),
      channel: async () => review, audit: async (...x) => audits.push(x), can: () => true,
    },
  };
  assert.match(apps.blockReason(member, pos, g, deps)[0], /Regeln/);
  has.member = true;
  assert.equal(apps.blockReason(member, pos, g, deps), null);

  const replies = [];
  const fields = { age: '16', minecraft: 'Steve', why: 'Ich helfe gern anderen und bin jeden Tag online auf HugoSMP.', experience: '', time: '5 Stunden' };
  const base = {
    guild: { id: 'G', members: { fetch: async () => member }, channels: { cache: new Collection([['APPS', review]]) } },
    user: { id: '5', username: 'steve' }, member, replied: false, deferred: false,
    deferReply: async function () { this.deferred = true; }, editReply: async (p) => replies.push(p), followUp: async (p) => replies.push(p),
    client: { users: { fetch: async () => ({ send: async (p) => replies.push(['dm', p]) }) } },
  };
  await apps.submit({ ...base, fields: { getTextInputValue: (id) => fields[id] } }, deps, pos);
  const a = Object.values(g.applications)[0];
  assert.equal(a.status, 'open');
  assert.match(JSON.stringify(sent[0]), /Bewerbung #1/);
  assert.match(apps.blockReason(member, pos, g, deps)[0], /läuft/, 'nur eine offene Bewerbung');

  await apps.decide({ ...base, user: { id: '1', username: 'danne' }, fields: { getTextInputValue: () => 'Willkommen!' } }, deps, a, 'accept');
  assert.equal(a.status, 'accepted');
  assert.ok(roles.has('SUP'), 'Rolle vergeben');
  assert.ok(replies.some((r) => Array.isArray(r) && r[0] === 'dm'), 'DM an die Person');
  assert.equal(audits.length, 1);

  const panel = JSON.stringify(panelDefinitions().find((d) => d.key === 'apply').build({ channelIds: {} }));
  assert.match(panel, /Supporter/);
  assert.match(panel, /Prognoseverwaltung/);
});

test('Channel-Namen in Ankündigungen werden zu Links', () => {
  const { linkChannelNames } = require('../src/lib/channelLinks');
  const ids = { apply: '111', docs: '222' };
  const out = linkChannelNames('Bewirb dich in #bewerben! Lies #regeln. #gibtsnicht bleibt, <#999> auch.', (k) => ids[k]);
  assert.equal(out, 'Bewirb dich in <#111>! Lies <#222>. #gibtsnicht bleibt, <#999> auch.');
  assert.equal(linkChannelNames('## Überschrift #bewerben', (k) => ids[k]), '## Überschrift <#111>');
});

test('Teamnamen: höchste Teamrolle als Zusatz, Entfernen beim Rollenverlust, Länge max. 32', async () => {
  const { desiredNickname, createStaffNamesService } = require('../src/services/staffNames');
  const has = new Set();
  const ctx = { hasRoleKey: (m, key) => has.has(key) };
  const member = (nickname) => {
    const m = { id: '9', guild: { ownerId: '1' }, user: { username: 'steve99', globalName: 'Steve' }, nickname, manageable: true };
    m.setNickname = async (n) => { m.nickname = n; };
    return m;
  };
  assert.equal(desiredNickname(member(null), ctx), 'Steve');
  has.add('support');
  assert.equal(desiredNickname(member('Steve'), ctx), 'Supporter | Steve');
  has.add('admin');
  assert.equal(desiredNickname(member('Supporter | Steve'), ctx), 'Admin | Steve', 'höchste Rolle zählt, alter Zusatz weg');
  assert.ok(desiredNickname(member('A'.repeat(40)), ctx).length <= 32);

  const svc = createStaffNamesService({ ctx, logger: console });
  const m = member('Admin | Steve');
  has.clear();
  assert.equal(await svc.apply(m), true);
  assert.equal(m.nickname, 'Steve', 'Zusatz entfernt');
  const owner = member(null);
  owner.id = '1';
  has.add('owner');
  assert.equal(await svc.apply(owner), false, 'Eigentümer wird nicht umbenannt');
});

test('Öffentlicher Status: ohne Fehlerdetails, Website „Kommt bald“ solange nicht verbunden', async () => {
  const { createStatusService } = require('../src/services/status');
  const store = tmpStore();
  const api = { configured: false };
  const svc = createStatusService({ api, store, env: {}, logger: console, minecraft: { state: { online: false, lastError: 'ECONNREFUSED 1.2.3.4' } } });
  await svc.checkApi();
  const text = JSON.stringify(await svc.buildPublicPayload());
  assert.match(text, /Kommt bald/);
  assert.match(text, /Gerade nicht verbunden/);
  assert.ok(!text.includes('ECONNREFUSED'), 'keine technischen Details');
  assert.ok(!text.includes('Prognosen'), 'keine Prognosen-Zeile');
  assert.match(text, /Störung/);
  const off = createStatusService({ api, store, env: {}, logger: console, minecraft: null });
  assert.match(JSON.stringify(await off.buildPublicPayload()), /Minecraft-Bot.*Kommt bald/, 'ausgeschaltet: „Kommt bald“');
});

test('Bot-Rolle: andere Bots bekommen „| Bots“, der eigene Bot und Menschen nicht', async () => {
  const { createBotRoleService } = require('../src/services/botRole');
  const svc = createBotRoleService({ ctx: { roleId: (g, k) => (k === 'otherBots' ? 'BR' : null) }, logger: console });
  const member = (id, bot) => {
    const roles = new Set();
    return { id, user: { bot, username: id }, guild: { id: 'G' }, client: { user: { id: 'SELF' } }, roles: { cache: { has: (r) => roles.has(r) }, add: async (r) => roles.add(r) }, _roles: roles };
  };
  const disboard = member('DISBOARD', true);
  assert.equal(await svc.assign(disboard), true);
  assert.ok(disboard._roles.has('BR'));
  assert.equal(await svc.assign(disboard), false, 'nicht doppelt');
  assert.equal(await svc.assign(member('SELF', true)), false, 'eigener Bot nicht');
  assert.equal(await svc.assign(member('steve', false)), false, 'Menschen nicht');
});

test('So-gehts-Karte: erklärt Prognosen und verlinkt die Channels', () => {
  const { panelDefinitions } = require('../src/setup/panels');
  const { textLength, TEXT_LIMIT } = require('../src/lib/ui');
  const payload = panelDefinitions().find((d) => d.key === 'howto').build({ env: { currency: 'HugoCoins', websiteUrl: '' }, channelIds: { docs: '1', pings: '2', marketOverview: '3', support: '4' } });
  const text = JSON.stringify(payload);
  for (const id of ['<#1>', '<#2>', '<#3>', '<#4>']) assert.ok(text.includes(id), id);
  assert.match(text, /Echtgeld/);
  assert.ok(textLength(payload) <= TEXT_LIMIT);
});

test('Konto verknüpfen zeigt /msg-Befehl, nach dem Flüstern Rollen und Name automatisch', async () => {
  const { startVerification, completeFromGame } = require('../src/interactions/verification');
  const replies = [];
  const added = [];
  const member = { id: '1', nickname: null, roles: { cache: new Collection(), add: async (ids) => added.push(...ids) }, setNickname: async (n) => { member.nickname = n; } };
  const interaction = {
    guild: { id: 'G' }, user: { id: '1', username: 'steve' }, member, replied: false, deferred: false,
    deferReply: async () => { interaction.deferred = true; }, editReply: async (p) => replies.push(p), followUp: async (p) => replies.push(p), reply: async (p) => replies.push(p),
  };
  const deps = {
    minecraft: { startDiscordLink: () => ({ code: 'KE2KM', expiresAt: new Date(Date.now() + 600000) }), info: () => ({ username: 'HugoPredict' }), state: { online: true } },
    ctx: { roleId: (g, k) => ({ member: 'M', verified: 'V' })[k], audit: async () => {}, hasRoleKey: () => false }, logger: console,
  };
  await startVerification(interaction, '', deps);
  assert.match(JSON.stringify(replies.at(-1).components.map((c) => c.toJSON())), /\/msg HugoPredict KE2KM/);
  const guild = { id: 'G', members: { fetch: async () => member } };
  await completeFromGame({ discordId: '1', player: { username: 'Steve', uuid: 'u' }, synced: true }, deps, { guilds: { cache: new Collection([['G', guild]]) } });
  assert.deepEqual(added.sort(), ['M', 'V']);
  assert.equal(member.nickname, 'Steve');
  assert.match(JSON.stringify(replies.at(-1).components.map((c) => c.toJSON())), /Konto verknüpft/);
});

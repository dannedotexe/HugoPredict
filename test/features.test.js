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
  const channels = new Collection(['docs', 'pings', 'support', 'mo', 'sys', 'ctl'].map((id) => [id, makeChannel(id)]));
  Object.assign(g.channels, { docs: 'docs', pings: 'pings', support: 'support', marketOverview: 'mo', system: 'sys', supportControl: 'ctl' });
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
    ctx: { roleId: (g, k) => ids[k], audit: async () => {} }, logger: console,
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
    ctx: { roleId: (g, k) => ({ member: 'M', verified: 'V' })[k], audit: async () => {} }, logger: console,
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
  assert.match(text, /Team im Warteraum.*<@staff>/, 'Team wird angezeigt');

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

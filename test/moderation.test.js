'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const mod = require('../src/lib/moderation');
const { Store } = require('../src/lib/store');
const { statsEmbed, collectStats } = require('../src/services/stats');
const { welcomePayload } = require('../src/services/welcome');
const { membersIntentAllowed, resolveIntents } = require('../src/lib/intents');

const member = (id, pos, perms = 0n) => ({ id, roles: { highest: { position: pos } }, permissions: new PermissionsBitField(perms) });
const guild = { ownerId: 'OWNER' };
const me = member('BOT', 10, P.ModerateMembers | P.KickMembers | P.BanMembers);
const actor = member('MOD', 5);

test('Moderation: Hierarchie und Schutzregeln', () => {
  assert.equal(mod.checkTarget('warn', { actor, target: member('U', 1), me, guild }), null);
  assert.match(mod.checkTarget('warn', { actor, target: actor, me, guild }), /selbst/);
  assert.match(mod.checkTarget('kick', { actor, target: member('OWNER', 1), me, guild }), /Eigentümer/);
  assert.match(mod.checkTarget('kick', { actor, target: member('X', 5), me, guild }), /gleich hohe oder höhere/);
  assert.match(mod.checkTarget('kick', { actor: member('OWNER', 20), target: member('X', 12), me, guild }), /über dem Bot/);
  assert.match(mod.checkTarget('timeout', { actor, target: member('A', 1, P.Administrator), me, guild }), /Administrator/);
  assert.match(mod.checkTarget('kick', { actor, target: null, me, guild }), /nicht auf dem Server/);
  assert.equal(mod.checkTarget('ban', { actor, target: null, me, guild }), null, 'Bann auch ohne Mitgliedschaft');
  const weakBot = member('BOT', 10);
  assert.match(mod.checkTarget('kick', { actor, target: member('U', 1), me: weakBot, guild }), /KickMembers/);
  assert.equal(mod.checkTarget('warn', { actor, target: member('U', 1), me: weakBot, guild }), null, 'Verwarnen braucht kein Bot-Recht');
});

test('Moderation: Fälle werden fortlaufend nummeriert und je Person abrufbar', () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mod-')));
  const a = mod.recordCase(store, 'G', { action: 'warn', targetId: 'U1', moderatorId: 'M', reason: 'Spam' });
  const b = mod.recordCase(store, 'G', { action: 'timeout', targetId: 'U1', moderatorId: 'M', reason: 'Wiederholt', durationMs: 3600000, number: 999 });
  mod.recordCase(store, 'G', { action: 'kick', targetId: 'U2', moderatorId: 'M', reason: 'x' });
  assert.deepEqual([a.number, b.number], [1, 2]);
  assert.equal(mod.casesFor(store, 'G', 'U1').length, 2);
  mod.caseEmbed(b).toJSON();
  mod.noticeEmbed(b, 'HugoPredict').toJSON();
  const h = mod.historyEmbed({ username: 'u' }, mod.casesFor(store, 'G', 'U1')).toJSON();
  assert.match(h.fields[0].value, /2 Eintrag.*1 Verwarnung/);
  assert.equal(mod.humanDuration(3600000), '1 Stunde');
});

test('Statistik: Embed mit und ohne Members-Intent', async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-stats-')));
  const g = store.guild('G');
  g.tickets = { a: { status: 'open' }, b: { status: 'closed' } };
  g.suggestions = { s: { status: 'open' } };
  mod.recordCase(store, 'G', { action: 'warn', targetId: 'U', moderatorId: 'M', reason: 'x' });
  const fakeGuild = { id: 'G', memberCount: 42 };
  const client = { guilds: { fetch: async () => ({ approximatePresenceCount: 7, approximateMemberCount: 43 }) } };
  const s = await collectStats(fakeGuild, { store, ctx: {}, membersIntent: false, client });
  assert.deepEqual([s.members, s.online, s.openTickets, s.openSuggestions, s.cases7d], [43, 7, 1, 1, 1]);
  const json = statsEmbed(s).toJSON();
  assert.ok(json.fields.some((f) => f.name === 'Hinweis'));
  assert.equal(json.fields.find((f) => f.name === 'Verifiziert').value, '—');
});

test('Begrüßung: gültige Direktnachricht mit Verweisen', () => {
  const p = welcomePayload({ guildId: '1', guildName: 'HugoPredict', ids: { docs: '2', support: '3' }, websiteUrl: 'https://x.de' });
  const e = p.embeds[0].toJSON();
  assert.match(e.description, /<#2>/);
  assert.match(e.description, /<#3>/);
  const buttons = p.components[0].toJSON().components;
  assert.equal(buttons[0].url, 'https://discord.com/channels/1/2');
  assert.equal(welcomePayload({ guildId: '1', guildName: 'X' }).components.length, 0);
});

test('Intents: Members-Intent nur bei Freigabe, Fehler führen zum sicheren Verzicht', async () => {
  assert.equal(await membersIntentAllowed('t', { get: async () => ({ flags: 1 << 14 }) }), true);
  assert.equal(await membersIntentAllowed('t', { get: async () => ({ flags: 1 << 15 }) }), true);
  assert.equal(await membersIntentAllowed('t', { get: async () => ({ flags: 0 }) }), false);
  assert.equal(await membersIntentAllowed('t', { get: async () => { throw new Error('401'); } }), false);
  const r = await resolveIntents('t', { get: async () => ({ flags: 0 }) });
  assert.deepEqual([r.intents.length, r.members], [1, false]);
});

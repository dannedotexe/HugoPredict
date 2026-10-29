'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
const L = require('../src/config/serverLayout');

const roleKeys = new Set(L.ROLES.map((r) => r.key));
const allSpecs = () => [...L.CATEGORIES.map((c) => ({ name: c.name, permissions: c.permissions })), ...L.allChannels()];

test('Rollen in der geforderten Reihenfolge', () => {
  assert.deepEqual(L.ROLES.map((r) => r.name), [
    '👑 Owner', '🛡️ Administrator', '🛠️ Developer', '⚖️ Market Moderator', '🔨 Moderator', '🎫 Support',
    '💎 Diamond Trader', '📈 Trader', '⛏️ Verified', '👤 Member', '🤖 Bots',
  ]);
});

test('Administrator-Recht nur bei der Administrator-Rolle', () => {
  for (const r of L.ROLES) {
    assert.equal(r.permissions.includes(P.Administrator), r.key === 'admin', r.name);
  }
});

test('Keys und Channel-Namen sind eindeutig', () => {
  const keys = L.allChannels().map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(L.CATEGORIES.map((c) => c.key)).size, L.CATEGORIES.length);
});

test('Alle geforderten Channels sind vorhanden', () => {
  const counts = Object.fromEntries(L.CATEGORIES.map((c) => [c.key, c.channels.length]));
  assert.deepEqual(counts, { startHere: 6, markets: 8, trading: 8, hugosmp: 6, community: 7, support: 5, rankings: 4, voice: 3, team: 11, tickets: 0 });
  assert.ok(L.CATEGORIES.find((c) => c.key === 'voice').channels.every((c) => c.type === ChannelType.GuildVoice));
});

test('Overwrites verweisen nur auf existierende Rollen und enthalten den Bot', () => {
  for (const spec of allSpecs()) {
    for (const o of spec.permissions) {
      assert.ok(o.target === 'everyone' || o.target === 'bot' || roleKeys.has(o.target), `${spec.name}: ${o.target}`);
    }
    assert.ok(spec.permissions.some((o) => o.target === 'bot'), `${spec.name}: Bot-Overwrite fehlt`);
  }
});

test('Bot benötigt jedes Recht, das er in Overwrites vergibt', () => {
  const required = L.REQUIRED_BOT_PERMISSIONS.reduce((a, p) => a | p, 0n);
  for (const spec of allSpecs()) {
    for (const o of spec.permissions) {
      for (const p of [...o.allow, ...o.deny]) assert.ok((required & p) === p, `${spec.name}: ${p}`);
    }
  }
});

test('Team-Channels sind für Mitglieder unsichtbar', () => {
  const team = L.CATEGORIES.find((c) => c.key === 'team');
  for (const spec of [team, ...team.channels]) {
    const everyone = spec.permissions.find((o) => o.target === 'everyone');
    assert.ok(everyone.deny.includes(P.ViewChannel), spec.name);
    for (const k of L.MEMBER_TIER) assert.ok(!spec.permissions.some((o) => o.target === k), `${spec.name}: ${k}`);
  }
});

test('Wirtschafts-Logs nur für die Leitung, nicht für Developer/Support/Market Mod', () => {
  for (const key of ['economyLogs', 'transactionLogs', 'securityLogs']) {
    const ch = L.allChannels().find((c) => c.key === key);
    const roles = ch.permissions.filter((o) => roleKeys.has(o.target)).map((o) => o.target).sort();
    assert.deepEqual(roles, ['admin', 'owner'], key);
  }
});

test('Selbst vergebbare Rollen sind nicht privilegiert', () => {
  assert.deepEqual([...L.SELF_ASSIGNABLE_VIA_BOT].sort(), ['member', 'verified']);
  for (const k of L.SELF_ASSIGNABLE_VIA_BOT) assert.equal(L.ROLES.find((r) => r.key === k).permissions.length, 0);
});

test('Ticket-Typen verweisen auf existierende Rollen', () => {
  assert.equal(L.TICKET_TYPES.length, 5);
  for (const t of L.TICKET_TYPES) for (const r of t.roles) assert.ok(roleKeys.has(r));
});

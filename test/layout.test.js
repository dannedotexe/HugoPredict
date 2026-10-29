'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const L = require('../src/config/serverLayout');
const { LEGACY_CATEGORIES } = require('../src/config/legacyLayout');

const roleKeys = new Set(L.ROLES.map((r) => r.key));
const allSpecs = () => [
  ...L.CATEGORIES.map((c) => ({ name: c.name, permissions: c.permissions })),
  ...L.allChannels(),
  { name: L.ARCHIVE_CATEGORY.name, permissions: L.ARCHIVE_CATEGORY.permissions },
];
const channel = (key) => L.allChannels().find((c) => c.key === key);
const has = (list, p) => list.includes(p);

/** Effektive Rechte eines Mitglieds mit den angegebenen Rollen (Discord-Logik ohne Administrator). */
function effective(spec, roles) {
  const ows = spec.permissions;
  const sum = (o, k) => (o ? o[k].reduce((a, p) => a | p, 0n) : 0n);
  const everyone = ows.find((o) => o.target === 'everyone');
  let perms = 0xffffffffffffn; // Basisrechte großzügig angenommen
  perms = (perms & ~sum(everyone, 'deny')) | sum(everyone, 'allow');
  let allow = 0n;
  let deny = 0n;
  for (const o of ows.filter((x) => roles.includes(x.target))) {
    allow |= sum(o, 'allow');
    deny |= sum(o, 'deny');
  }
  return (perms & ~deny) | allow;
}
const can = (spec, roles, p) => (effective(spec, roles) & p) === p;

test('Rollen: deutsche Namen, geforderte Reihenfolge, ohne Emojis', () => {
  assert.deepEqual(L.ROLES.map((r) => r.name), ['Inhaber', 'Administrator', 'Entwickler', 'Marktverwaltung', 'Moderator', 'Support', 'Verifiziert', 'Mitglied', 'HugoPredict Bot']);
  for (const r of L.ROLES) assert.ok(r.description && r.icon, `${r.name}: Beschreibung und Icon`);
  for (const r of L.ROLES) assert.match(r.name, /^[A-Za-zÄÖÜäöüß ]+$/);
});

test('Struktur entspricht exakt der Vorgabe', () => {
  assert.deepEqual(L.CATEGORIES.map((c) => [c.name, c.channels.map((ch) => ch.name)]), [
    ['INFORMATIONEN', ['willkommen', 'ankündigungen', 'marktübersicht', 'regeln']],
    ['COMMUNITY', ['diskussionen', 'marktanalysen']],
    ['KUNDENSERVICE', ['support']],
    ['INTERN · PRIVAT', ['betrieb', 'prüfprotokoll', 'systemmeldungen', 'moderation', 'team']],
  ]);
  for (const ch of L.allChannels()) assert.match(ch.name, /^[a-zäöüß-]+$/, ch.name);
});

test('Administrator-Recht nur bei der Rolle Administrator', () => {
  for (const r of L.ROLES) assert.equal(r.permissions.includes(P.Administrator), r.key === 'admin', r.name);
});

test('Overwrites verweisen nur auf existierende Rollen und enthalten den Bot', () => {
  for (const spec of allSpecs()) {
    for (const o of spec.permissions) assert.ok(o.target === 'everyone' || o.target === 'bot' || roleKeys.has(o.target), `${spec.name}: ${o.target}`);
    assert.ok(spec.permissions.some((o) => o.target === 'bot'), `${spec.name}: Bot-Overwrite fehlt`);
  }
});

test('Bot benötigt jedes Recht, das er in Overwrites vergibt', () => {
  const required = L.REQUIRED_BOT_PERMISSIONS.reduce((a, p) => a | p, 0n) | P.ManageChannels;
  for (const spec of allSpecs()) {
    for (const o of spec.permissions) for (const p of [...o.allow, ...o.deny]) assert.ok((required & p) === p, `${spec.name}: ${p}`);
  }
});

test('Ankündigungen: lesen alle, schreiben nur Inhaber und Administrator', () => {
  const ch = channel('announcements');
  assert.ok(can(ch, [], P.ViewChannel));
  for (const roles of [[], ['member'], ['verified'], ['support'], ['moderator'], ['developer'], ['marketMod']]) {
    assert.ok(!can(ch, roles, P.SendMessages), `darf nicht schreiben: ${roles}`);
  }
  assert.ok(can(ch, ['owner'], P.SendMessages));
  assert.ok(can(ch, ['admin'], P.SendMessages));
});

test('Marktübersicht und Dokumentation sind schreibgeschützt; Marktverwaltung darf moderieren', () => {
  for (const key of ['marketOverview', 'docs', 'support']) {
    assert.ok(can(channel(key), [], P.ViewChannel), key);
    assert.ok(!can(channel(key), ['member', 'verified'], P.SendMessages), key);
  }
  assert.ok(can(channel('marketOverview'), ['marketMod'], P.ManageMessages));
  assert.ok(!can(channel('marketOverview'), ['marketMod'], P.SendMessages));
});

test('Community erst ab Mitglied', () => {
  for (const key of ['discussions', 'analyses']) {
    assert.ok(!can(channel(key), [], P.ViewChannel), key);
    assert.ok(can(channel(key), ['member'], P.SendMessages), key);
    assert.ok(can(channel(key), ['verified'], P.SendMessages), key);
  }
});

test('Interne Channels: für Mitglieder unsichtbar, Zugriff nur für zuständige Rollen', () => {
  const internal = L.CATEGORIES.find((c) => c.key === 'internal');
  for (const spec of [internal, ...internal.channels]) {
    for (const roles of [[], ['member'], ['verified'], ['member', 'verified']]) assert.ok(!can(spec, roles, P.ViewChannel), `${spec.name}: ${roles}`);
  }
  const visible = (key) => L.ROLES.map((r) => r.key).filter((k) => k !== 'admin' && can(channel(key), [k], P.ViewChannel)).sort();
  assert.deepEqual(visible('audit'), ['owner']);
  assert.deepEqual(visible('system'), ['developer', 'owner']);
  assert.deepEqual(visible('operations'), ['marketMod', 'owner']);
  assert.deepEqual(visible('moderation'), ['moderator', 'owner', 'support']);
  assert.deepEqual(visible('team'), ['developer', 'marketMod', 'moderator', 'owner', 'support']);
  assert.ok(!can(channel('audit'), ['owner'], P.SendMessages), 'Prüfprotokoll ist schreibgeschützt');
});

test('Selbst vergebbare Rollen sind nicht privilegiert', () => {
  assert.deepEqual([...L.SELF_ASSIGNABLE_VIA_BOT].sort(), ['member', 'verified']);
  for (const k of L.SELF_ASSIGNABLE_VIA_BOT) assert.equal(L.ROLES.find((r) => r.key === k).permissions.length, 0);
});

test('Ticket-Typen verweisen auf existierende Rollen', () => {
  assert.equal(L.TICKET_TYPES.length, 5);
  for (const t of L.TICKET_TYPES) for (const r of t.roles) assert.ok(roleKeys.has(r));
});

test('Protokoll-Routen zeigen auf interne Channels', () => {
  const internal = L.CATEGORIES.find((c) => c.key === 'internal').channels.map((c) => c.key);
  for (const target of Object.values(L.LOG_ROUTES)) assert.ok(internal.includes(target), target);
});

test('Vorgänger-Schlüssel existieren in der früheren Struktur und sind eindeutig', () => {
  const oldChannels = new Set(LEGACY_CATEGORIES.flatMap((c) => c.channels.map(([k]) => k)));
  const oldCats = new Set(LEGACY_CATEGORIES.map((c) => c.key));
  const seen = new Set();
  for (const cat of L.CATEGORIES) {
    for (const k of cat.legacy ?? []) assert.ok(oldCats.has(k), k);
    for (const ch of cat.channels) {
      for (const k of ch.legacy ?? []) {
        assert.ok(oldChannels.has(k), k);
        assert.ok(!seen.has(k), `doppelt: ${k}`);
        seen.add(k);
      }
    }
  }
});

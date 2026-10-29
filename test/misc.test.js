'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RateLimiter, LockSet } = require('../src/lib/rateLimit');
const { Store } = require('../src/lib/store');
const feed = require('../src/services/marketFeed');
const { dailyKey } = require('../src/commands/daily');
const { slug } = require('../src/interactions/tickets');
const { resolveOverwrites } = require('../src/setup/setupServer');
const { formatPrice, formatAmount } = require('../src/lib/embeds');

test('RateLimiter: Sliding Window', () => {
  let now = 0;
  const rl = new RateLimiter(() => now);
  const opts = { limit: 2, windowMs: 1000 };
  assert.ok(rl.hit('a', opts).ok);
  assert.ok(rl.hit('a', opts).ok);
  const r = rl.hit('a', opts);
  assert.equal(r.ok, false);
  assert.equal(r.retryAfterMs, 1000);
  now = 1001;
  assert.ok(rl.hit('a', opts).ok);
});

test('LockSet verhindert parallele Ausführung', async () => {
  const locks = new LockSet();
  let release;
  const first = locks.run('x', () => new Promise((r) => { release = r; }));
  const second = await locks.run('x', async () => 'nope');
  assert.equal(second.locked, true);
  release('ok');
  assert.deepEqual(await first, { locked: false, value: 'ok' });
});

test('Store speichert atomar und lädt wieder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-store-'));
  const s = new Store(dir);
  s.guild('1').channels.welcome = '42';
  s.flush();
  assert.equal(new Store(dir).guild('1').channels.welcome, '42');
  fs.writeFileSync(path.join(dir, 'store.json'), '{kaputt');
  assert.throws(() => new Store(dir), /beschädigt/);
});

test('Daily-Key ist pro Nutzer und Tag stabil', () => {
  const d = new Date('2026-10-29T23:59:00Z');
  assert.equal(dailyKey('1', d), 'discord-daily:1:2026-10-29');
  assert.notEqual(dailyKey('1', d), dailyKey('1', new Date('2026-10-30T00:00:01Z')));
});

test('Marktübersicht: Hash ignoriert Kleinstschwankungen', () => {
  const m = { title: 'X', yesPrice: 0.5, volume: 100, status: 'open' };
  assert.equal(feed.marketHash(m), feed.marketHash({ ...m, yesPrice: 0.502, volume: 100.3 }));
  assert.notEqual(feed.marketHash(m), feed.marketHash({ ...m, yesPrice: 0.52 }));
  assert.notEqual(feed.marketHash(m), feed.marketHash({ ...m, status: 'paused' }));
});

test('Marktübersicht: eine Nachricht pro Markt, Bearbeitung statt Neupost', () => {
  const a = { id: 'a', title: 'A', status: 'open', createdAt: '2026-01-02' };
  const b = { id: 'b', title: 'B', status: 'paused', createdAt: '2026-01-01' };
  const base = { resolved: [], seenResolved: new Set(), initialized: false, maxMarkets: 10 };

  // Ersteinrichtung: aktive Märkte werden (älteste zuerst) gepostet
  let actions = feed.planFeed({ ...base, active: [a, b], messages: {} });
  assert.deepEqual(actions.map((x) => [x.type, x.market.id]), [['post', 'b'], ['post', 'a']]);

  // Unverändert → keine Aktion; Statuswechsel → Bearbeitung
  const messages = { a: { messageId: '1', hash: feed.marketHash(a) }, b: { messageId: '2', hash: feed.marketHash(b) } };
  assert.equal(feed.planFeed({ ...base, active: [a, b], messages }).length, 0);
  actions = feed.planFeed({ ...base, active: [{ ...a, status: 'paused' }, b], messages });
  assert.deepEqual(actions.map((x) => [x.type, x.market.id]), [['edit', 'a']]);

  // Entscheidung eines bekannten Marktes → Bearbeitung der bestehenden Nachricht
  actions = feed.planFeed({ ...base, active: [b], resolved: [{ ...a, status: 'resolved', outcome: 'Ja' }], messages, initialized: true });
  assert.deepEqual(actions.map((x) => [x.type, x.market.id]), [['edit', 'a']]);
});

test('Marktübersicht: alte entschiedene Märkte werden bei der Ersteinrichtung nicht gepostet', () => {
  const r = { id: 'r', title: 'R', status: 'resolved' };
  const base = { active: [], messages: {}, maxMarkets: 10 };
  assert.equal(feed.planFeed({ ...base, resolved: [r], seenResolved: new Set(), initialized: false }).length, 0);
  assert.equal(feed.planFeed({ ...base, resolved: [r], seenResolved: new Set(['r']), initialized: true }).length, 0);
  assert.equal(feed.planFeed({ ...base, resolved: [r], seenResolved: new Set(), initialized: true }).length, 1);
});

test('Marktübersicht: Obergrenze für aktive Märkte', () => {
  const active = Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: String(i), status: 'open' }));
  const actions = feed.planFeed({ active, resolved: [], messages: { 0: { messageId: 'x', hash: feed.marketHash(active[0]) } }, seenResolved: new Set(), initialized: true, maxMarkets: 3 });
  assert.equal(actions.filter((x) => x.type === 'post').length, 2);
});

test('Formatierung zeigt fehlende Werte als —', () => {
  assert.equal(formatPrice(null), '—');
  assert.equal(formatPrice(0.625), '62,5 %');
  assert.equal(formatAmount(undefined, 'HC'), '—');
  assert.equal(formatAmount(1234.5, 'HC'), '1.234,5 HC');
});

test('Ticket-Slug', () => {
  assert.equal(slug('Hügo_Player!!'), 'hugo-player');
  assert.equal(slug('🔥'), 'user');
});

test('resolveOverwrites führt Ziele zusammen; allow gewinnt', () => {
  const guild = { roles: { everyone: { id: 'E' } } };
  const { overwrites, unresolved } = resolveOverwrites([
    { target: 'everyone', allow: [], deny: [1n] },
    { target: 'member', allow: [2n], deny: [4n] },
    { target: 'member', allow: [4n], deny: [] },
    { target: 'bot', allow: [8n], deny: [] },
    { target: 'missing', allow: [1n], deny: [] },
  ], { guild, me: { id: 'B' }, roleIds: { member: 'M' } });
  const byId = Object.fromEntries(overwrites.map((o) => [o.id, o]));
  assert.equal(byId.E.deny, 1n);
  assert.equal(byId.M.allow, 6n);
  assert.equal(byId.M.deny, 0n);
  assert.equal(byId.B.type, 1);
  assert.deepEqual(unresolved, ['missing']);
});

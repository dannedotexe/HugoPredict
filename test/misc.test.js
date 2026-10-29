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

test('Markt-Feed: Bald entschieden, Top-Volumen, Hash', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const ms = [
    { id: 'a', closesAt: '2026-10-30T12:00:00Z', volume: 5 },
    { id: 'b', closesAt: '2026-10-29T13:00:00Z', volume: null },
    { id: 'c', closesAt: '2026-12-01T00:00:00Z', volume: 50 },
    { id: 'd', closesAt: '2026-10-28T00:00:00Z', volume: 1 },
  ];
  assert.deepEqual(feed.closingSoon(ms, 48, now).map((m) => m.id), ['b', 'a']);
  assert.deepEqual(feed.topByVolume(ms).map((m) => m.id), ['c', 'a', 'd']);
  const m = { title: 'X', yesPrice: 0.5 };
  assert.notEqual(feed.marketHash(m), feed.marketHash({ ...m, yesPrice: 0.51 }));
});

test('Markt-Feed: Preisbewegungen mit Schwelle und Cooldown', () => {
  const state = {};
  const t0 = 10 * 60 * 60_000;
  assert.equal(feed.detectPriceMoves([{ id: 'a', yesPrice: 0.5 }], state, t0).length, 0); // Initialisierung
  assert.equal(feed.detectPriceMoves([{ id: 'a', yesPrice: 0.53 }], state, t0).length, 0); // unter Schwelle
  assert.equal(feed.detectPriceMoves([{ id: 'a', yesPrice: 0.6 }], state, t0).length, 1);
  assert.equal(feed.detectPriceMoves([{ id: 'a', yesPrice: 0.7 }], state, t0 + 60_000).length, 0); // Cooldown
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

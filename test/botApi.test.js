import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.DB_FILE = ':memory:';
process.env.FEE_PERCENT = '0';
process.env.HUGO_API_KEY = 'k'.repeat(32);
const svc = await import('../src/services.js');
const { db } = await import('../src/db.js');
const { botApi } = await import('../src/botApi.js');
const { botState } = await import('../src/bot.js');

let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/bot', botApi);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/bot`;
});
after(() => server.close());

async function call(method, path, body, key = process.env.HUGO_API_KEY) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const post = (path, body = {}) => call('POST', path, body);
const userId = (name) => db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
const balance = (name) => db.prepare('SELECT balance FROM users WHERE username = ?').get(name).balance;
const deposit = (id, amount, minecraftName = 'CaroMC') => post('/minecraft/deposits', { id, minecraftName, minecraftUuid: null, amount });

test('wrong or missing key is refused', async () => {
  assert.equal((await call('GET', '/health', undefined, 'falsch')).status, 401);
  assert.deepEqual((await call('GET', '/health')).body, { status: 'ok' });
});

test('deposit report is idempotent and held until the website link', async () => {
  svc.register('caro', 'password1');
  assert.deepEqual((await deposit('d1', 100)).body, { accepted: true, linked: false, credited: null });
  await deposit('d1', 100);

  const code = svc.startLink(userId('caro'));
  const wrong = await post('/minecraft/website-links', { minecraftName: 'CaroMC', code: 'FFFFFF' });
  assert.equal(wrong.status, 400);
  assert.ok(wrong.body.message);
  const linked = await post('/minecraft/website-links', { minecraftName: 'CaroMC', code });
  assert.deepEqual(linked.body, { linked: true, username: 'caro', claimed: 100 });
  assert.equal(balance('caro'), 100);

  assert.deepEqual((await deposit('d2', 50, 'caromc')).body, { accepted: true, linked: true, credited: 50 });
  await deposit('d2', 50, 'caromc');
  assert.equal(balance('caro'), 150);
  assert.equal((await deposit('d3', -5)).status, 422);
});

test('bot only sees approved payouts; complete and fail settle once', async () => {
  const uid = userId('caro');
  const payouts = async () => (await call('GET', '/minecraft/payouts?status=approved')).body.payouts;
  const a = svc.requestWithdrawal(uid, 10).id;
  assert.deepEqual(await payouts(), []);
  assert.equal((await post(`/minecraft/payouts/${a}/complete`)).status, 409);
  svc.approveWithdrawal(a);
  assert.deepEqual(await payouts(), [{ id: String(a), minecraftName: 'CaroMC', amount: 10 }]);
  assert.throws(() => svc.cancelWithdrawal(uid, a), /storniert/);

  await post(`/minecraft/payouts/${a}/complete`, { paidAt: new Date().toISOString() });
  assert.equal((await post(`/minecraft/payouts/${a}/complete`)).status, 200);
  assert.deepEqual(await payouts(), []);
  assert.equal((await post(`/minecraft/payouts/${a}/fail`, { reason: 'x' })).status, 409);
  assert.equal(balance('caro'), 140);

  const b = svc.requestWithdrawal(uid, 20).id;
  svc.approveWithdrawal(b);
  await post(`/minecraft/payouts/${b}/fail`, { reason: 'Limit', uncertain: false });
  await post(`/minecraft/payouts/${b}/fail`, { reason: 'Limit', uncertain: false });
  assert.equal(balance('caro'), 140);

  const c = svc.requestWithdrawal(uid, 30).id;
  svc.approveWithdrawal(c);
  await post(`/minecraft/payouts/${c}/fail`, { reason: 'unklar', uncertain: true });
  assert.equal(balance('caro'), 110);
  assert.deepEqual(await payouts(), []);
});

test('discord link rejects an account taken by someone else', async () => {
  const link = (discordId) => post('/minecraft/links', { discordId, discordUsername: 'x', minecraftName: 'CaroMC', minecraftUuid: 'uuid-1' });
  assert.deepEqual((await link('100000000000000001')).body, { linked: true });
  assert.equal((await link('100000000000000001')).status, 200);
  assert.equal((await link('100000000000000002')).status, 409);
});

test('markets use the shape the bot expects', async () => {
  const { id } = svc.createMarket({ title: 'Gewinnt Clan A?', category: 'clan', outcomes: ['Ja', 'Nein'] });
  const [m] = (await call('GET', '/markets?status=open&limit=5')).body.markets;
  assert.equal(m.id, String(id));
  assert.equal(m.yesPrice, 0.5);
  assert.deepEqual((await call('GET', '/markets?status=resolved')).body.markets, []);
  svc.cancelMarket(id);
  assert.equal((await call('GET', '/markets?status=rejected')).body.markets[0].id, String(id));
  assert.equal((await call('GET', '/markets?status=x')).status, 422);
});

test('heartbeat drives the online status', async () => {
  await post('/minecraft/heartbeat', { online: true, username: 'HugoBot' });
  assert.equal(botState.online, true);
  assert.equal(botState.username, 'HugoBot');
  await post('/minecraft/heartbeat', { online: false, username: null });
  assert.equal(botState.online, false);
  assert.equal(botState.username, 'HugoBot');
});

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
  assert.equal((await post('/minecraft/website-links', { minecraftName: 'CaroMC', code })).status, 404);
  assert.equal(svc.completeLink('CaroMC', code).claimed, 100);
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

test('login code is single use, creates the account and claims held deposits', async () => {
  process.env.ADMIN_MC = 'Alpha_Noah';
  await deposit('held-1', 70, 'Alpha_Noah');
  const { body } = await post('/minecraft/login-codes', { minecraftName: 'Alpha_Noah' });
  assert.equal(body.code.length, 8);
  assert.equal((await post('/minecraft/login-codes', { minecraftName: 'alpha_noah' })).status, 409);

  const token = svc.loginWithCode(body.code.toLowerCase());
  const user = svc.userBySession(token);
  assert.equal(user.mc_name, 'Alpha_Noah');
  assert.equal(user.isAdmin, true);
  assert.equal(user.balance, 70);
  assert.throws(() => svc.loginWithCode(body.code), /ungültig/);
  assert.throws(() => svc.loginWithCode(''), /ungültig/);
});

test('admin follows the Minecraft name, not a matching username', async () => {
  process.env.ADMIN_MC = 'Alpha_Noah';
  svc.register('Alpha_Noah2', 'password1');
  const squatter = svc.register('alpha_NOAH_x', 'password1');
  assert.equal(svc.userBySession(squatter).isAdmin, false);

  // A username grabbed earlier must neither block nor inherit the real player's login.
  db.prepare('UPDATE users SET username = ? WHERE username = ?').run('Dieb_Name', 'Alpha_Noah2');
  svc.register('Opfer_MC', 'password1');
  const { code } = svc.createLoginCode('Opfer_MC');
  const user = svc.userBySession(svc.loginWithCode(code));
  assert.equal(user.username, 'Opfer_MC_2');
  assert.equal(user.mc_name, 'Opfer_MC');
});

test('expired login code is refused', () => {
  const { code } = svc.createLoginCode('Spaet_MC');
  db.prepare('UPDATE login_codes SET expires_at = 1 WHERE mc_name = ?').run('Spaet_MC');
  assert.throws(() => svc.loginWithCode(code), /abgelaufen/);
});

test('heartbeat drives the online status', async () => {
  await post('/minecraft/heartbeat', { online: true, username: 'HugoBot' });
  assert.equal(botState.online, true);
  assert.equal(botState.username, 'HugoBot');
  await post('/minecraft/heartbeat', { online: false, username: null });
  assert.equal(botState.online, false);
  assert.equal(botState.username, 'HugoBot');
});

test('Discord-Befehle: Guthaben, Portfolio, Verlauf und Rangliste über die Verknüpfung', async () => {
  const discordId = '777777777777777777';
  // Noch nicht verknüpft → 404 mit not_linked
  const missing = await call('GET', `/users/discord/${discordId}/balance`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'not_linked');

  // Konto entsteht per Login-Code, Verknüpfung kommt vom Bot
  const { code } = (await post('/minecraft/login-codes', { minecraftName: 'DiscoMC' })).body;
  svc.loginWithCode(code);
  assert.equal((await post('/minecraft/links', { discordId, discordUsername: 'disco', minecraftName: 'DiscoMC', minecraftUuid: 'uuid-disco' })).status, 200);
  await deposit('disco-1', 300, 'DiscoMC');

  const bal = await call('GET', `/users/discord/${discordId}/balance`);
  assert.equal(bal.status, 200);
  assert.equal(bal.body.balance, 300);
  assert.equal(bal.body.username, 'DiscoMC');

  const tx = await call('GET', `/users/discord/${discordId}/transactions?limit=5`);
  assert.equal(tx.body.transactions[0].description, 'Einzahlung');
  assert.equal(tx.body.transactions[0].amount, 300);

  const pf = await call('GET', `/users/discord/${discordId}/portfolio`);
  assert.deepEqual(pf.body.positions, []);

  const lb = await call('GET', '/leaderboards/all-time?limit=5');
  assert.equal(lb.status, 200);
  assert.ok(Array.isArray(lb.body.entries));
  assert.equal((await call('GET', '/leaderboards/weekly')).status, 404);
});

test('Admin-Panel: Kennzahlen, Nutzer, Märkte und Transaktionen nur mit Schlüssel', async () => {
  assert.equal((await call('GET', '/admin/summary', undefined, 'falsch')).status, 401);
  const { code } = (await post('/minecraft/login-codes', { minecraftName: 'PanelMC' })).body;
  svc.loginWithCode(code);
  await post('/minecraft/links', { discordId: '888888888888888888', discordUsername: 'panel', minecraftName: 'PanelMC', minecraftUuid: 'uuid-panel' });
  await deposit('panel-1', 120, 'PanelMC');

  const sum = (await call('GET', '/admin/summary')).body;
  assert.ok(sum.users >= 1 && sum.mcPlayers >= 1);
  assert.ok(sum.deposits.sum >= 120);
  assert.ok(Array.isArray(sum.top));

  const users = (await call('GET', '/admin/users?q=panel')).body;
  assert.equal(users.users[0].mcName, 'PanelMC');
  assert.equal(users.users[0].discordId, '888888888888888888');
  assert.equal(users.users[0].balance, 120);

  const tx = (await call('GET', '/admin/transactions?type=deposit&limit=5')).body;
  assert.ok(tx.transactions.every((t) => t.type === 'deposit'));
  assert.equal((await call('GET', '/admin/markets')).status, 200);
});

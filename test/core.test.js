import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.FEE_PERCENT = '0';
const lmsr = await import('../src/lmsr.js');
const svc = await import('../src/services.js');
const { db } = await import('../src/db.js');
const { matchDeposit, parseAmount } = await import('../src/bot.js');

const userId = (name) => db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
const balance = (name) => db.prepare('SELECT balance FROM users WHERE username = ?').get(name).balance;

test('lmsr: buying exactly `amount` costs exactly `amount`', () => {
  const qs = [10, -5, 3];
  const x = lmsr.sharesForAmount(qs, 100, 1, 42);
  const after = qs.slice(); after[1] += x;
  assert.ok(Math.abs(lmsr.cost(after, 100) - lmsr.cost(qs, 100) - 42) < 1e-9);
  assert.ok(Math.abs(lmsr.sellValue(after, 100, 1, x) - 42) < 1e-9);
});

test('deposit → link → buy → resolve → withdraw', () => {
  svc.register('alice', 'password1');
  svc.register('bob', 'password2');

  // Deposit before linking is held and credited on link.
  svc.recordDeposit('AliceMC', 100, 'raw');
  const code = svc.startLink(userId('alice'));
  assert.equal(svc.completeLink('AliceMC', code).claimed, 100);
  assert.equal(balance('alice'), 100);

  svc.completeLink('BobMC', svc.startLink(userId('bob')));
  svc.recordDeposit('bobmc', 50, 'raw');
  assert.equal(balance('bob'), 50);

  const { id } = svc.createMarket({ title: 'Gewinnt Clan A?', category: 'clan', outcomes: ['Ja', 'Nein'] });
  const [yes, no] = svc.getMarket(id).outcomes;
  const a = svc.buy(userId('alice'), id, yes.id, 60);
  svc.buy(userId('bob'), id, no.id, 50);
  assert.throws(() => svc.buy(userId('bob'), id, no.id, 1), /Guthaben/);

  svc.resolveMarket(id, yes.id);
  assert.equal(balance('alice'), Math.round((40 + a.shares) * 100) / 100);
  assert.equal(balance('bob'), 0);
  assert.throws(() => svc.buy(userId('alice'), id, yes.id, 5), /geschlossen/);

  svc.requestWithdrawal(userId('alice'), 30);
  const w = svc.nextWithdrawal();
  assert.equal(w.mc_name, 'AliceMC');
  svc.markWithdrawal(w.id, 'failed', 'test');
  assert.equal(balance('alice'), Math.round((40 + a.shares) * 100) / 100);
});

test('cancel refunds net stake', () => {
  svc.adminCredit('bob', 100);
  const { id } = svc.createMarket({ title: 'Nächste Meta?', category: 'meta', outcomes: ['Mace', 'Crystal', 'Axt'] });
  const o = svc.getMarket(id).outcomes;
  const r = svc.buy(userId('bob'), id, o[2].id, 80);
  svc.sell(userId('bob'), id, o[2].id, r.shares / 2);
  svc.cancelMarket(id);
  assert.equal(balance('bob'), 100);
});

test('deposit patterns only match system-style lines', () => {
  const patterns = [String.raw`^\$?(?<amount>[\d.,]+[kKmM]?)\$? has been received from (?<player>\w{3,16})\.?$`].map((p) => new RegExp(p, 'i'));
  assert.deepEqual(matchDeposit('$1,500 has been received from Steve.', patterns), { player: 'Steve', amount: 1500 });
  assert.equal(matchDeposit('<Steve> $1,500 has been received from Steve.', patterns), null);
  assert.equal(parseAmount('2.5k'), 2500);
});

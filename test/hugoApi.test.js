'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HugoApi, ApiError, userMessage } = require('../src/lib/hugoApi');

const ID = '123456789012345678';

function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  };
  return { fetchImpl, calls };
}

const make = (responses) => {
  const m = mockFetch(responses);
  return { api: new HugoApi({ baseUrl: 'https://example.test/api', apiKey: 'k', fetchImpl: m.fetchImpl }), calls: m.calls };
};

test('ohne Konfiguration: not_configured, kein Request', async () => {
  const api = new HugoApi({ fetchImpl: () => assert.fail('kein Request erwartet') });
  await assert.rejects(api.getBalance(ID), (e) => e instanceof ApiError && e.code === 'not_configured');
});

test('Guthaben wird mit Auth-Header geladen', async () => {
  const { api, calls } = make([{ status: 200, body: { balance: 150.5, available: 100 } }]);
  const b = await api.getBalance(ID);
  assert.equal(b.balance, 150.5);
  assert.equal(b.locked, null);
  assert.equal(calls[0].url, `https://example.test/api/users/discord/${ID}/balance`);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
});

test('ungültige Discord-ID wird abgelehnt', async () => {
  const { api } = make([]);
  await assert.rejects(api.getBalance('../admin'), TypeError);
});

test('404 mit code not_linked', async () => {
  const { api } = make([{ status: 404, body: { code: 'not_linked' } }]);
  await assert.rejects(api.getBalance(ID), (e) => e.code === 'not_linked');
});

test('Daily: Idempotency-Key, Erfolg nur bei claimed=true', async () => {
  const { api, calls } = make([{ status: 200, body: { claimed: true, amount: 50, balance: 200 } }]);
  const r = await api.claimDaily(ID, 'key-1');
  assert.equal(r.claimed, true);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'key-1');
});

test('Daily: unklare Antwort wird NICHT als Erfolg gewertet', async () => {
  const { api } = make([{ status: 200, body: { ok: true } }]);
  await assert.rejects(api.claimDaily(ID, 'k'), (e) => e.code === 'invalid_response');
});

test('Daily: 409 = bereits abgeholt', async () => {
  const { api } = make([{ status: 409, body: { nextClaimAt: '2030-01-01T00:00:00Z' } }]);
  const r = await api.claimDaily(ID, 'k');
  assert.deepEqual(r, { claimed: false, nextClaimAt: '2030-01-01T00:00:00Z' });
});

test('POST wird bei 5xx nicht wiederholt, GET einmal', async () => {
  const post = make([{ status: 500 }, { status: 200, body: { claimed: true, amount: 1 } }]);
  await assert.rejects(post.api.claimDaily(ID, 'k'), (e) => e.code === 'server');
  assert.equal(post.calls.length, 1);

  const get = make([{ status: 503 }, { status: 200, body: { markets: [{ id: 1, title: 'A' }, { foo: 1 }] } }]);
  const markets = await get.api.listMarkets();
  assert.equal(get.calls.length, 2);
  assert.equal(markets.length, 1);
  assert.equal(markets[0].id, '1');
});

test('Timeout wird erkannt', async () => {
  const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { api } = make([err, err]);
  await assert.rejects(api.listMarkets(), (e) => e.code === 'timeout');
});

test('Nutzermeldungen enthalten keine internen Details', () => {
  const msg = userMessage(new ApiError('server', 'GET /x: HTTP 500 secret'));
  assert.ok(!msg.includes('secret'));
});

test('Ranglisten filtern unvollständige Einträge', async () => {
  const { api } = make([{ status: 200, body: { entries: [{ username: 'a', value: 10 }, { username: 'b' }] } }]);
  const lb = await api.getLeaderboard('weekly');
  assert.equal(lb.entries.length, 1);
  await assert.rejects(api.getLeaderboard('erfunden'), TypeError);
});

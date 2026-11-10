'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createViewer } = require('../src/minecraft/viewer');

test('Bot-Sicht: nur mit signiertem Link, danach per Cookie; nur lokal', async (t) => {
  const port = 39500 + Math.floor(Math.random() * 400);
  const v = createViewer({ port, secret: 'geheim', logger: { info() {}, warn() {} } });
  t.after(() => v.close());
  await new Promise((r) => setTimeout(r, 300));
  const base = `http://127.0.0.1:${port}/mc-sicht`;
  assert.equal((await fetch(`${base}/`)).status, 403, 'ohne Link kein Zugang');
  assert.equal((await fetch(`${base}/?t=123.abc`, { redirect: 'manual' })).status, 403, 'gefälschter Link');
  const res = await fetch(`${base}/?t=${v.createToken()}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^mcv=\d{13}\./);
  const page = await fetch(`${base}/`, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/i);
  assert.equal(createViewer({ port: 0, secret: 'x', logger: console }), null, 'ohne Port aus');
});

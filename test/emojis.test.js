'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Collection, ButtonBuilder, ButtonStyle } = require('discord.js');
const { EmojiRegistry, emojis, withEmoji } = require('../src/lib/emojis');
const { ROLES, TICKET_TYPES } = require('../src/config/serverLayout');
const { sections } = require('../src/config/docs');
const { STATUS_LABELS } = require('../src/services/marketFeed');
const { panelDefinitions } = require('../src/setup/panels');
const { textLength, TEXT_LIMIT } = require('../src/lib/ui');

const quiet = { info() {}, warn() {} };

function fakeClient(existingNames = []) {
  let seq = 1;
  const existing = new Collection(existingNames.map((name) => [String(seq), { id: String(seq++), name }]));
  const created = [];
  return {
    created,
    application: {
      emojis: {
        fetch: async () => existing,
        create: async ({ attachment, name }) => {
          assert.ok(fs.existsSync(attachment));
          created.push(name);
          return { id: String(100 + seq++), name };
        },
      },
    },
  };
}

test('Alle verwendeten Icons existieren als 128×128-PNG unter 256 KB', () => {
  const reg = new EmojiRegistry();
  const keys = new Set(reg.files().map((f) => f.slice(0, -4)));
  const needed = [
    ...ROLES.map((r) => r.icon), ...TICKET_TYPES.map((t) => t.key), ...Object.keys(STATUS_LABELS).filter((s) => s !== 'rejected'),
    ...sections({ currency: 'HC', websiteUrl: '' }).map((s) => s.icon),
    'logo', 'roles', 'support', 'check', 'link', 'external', 'lock', 'claim', 'error', 'verified', 'warning',
  ];
  for (const k of needed) assert.ok(keys.has(k), `Icon fehlt: ${k}`);
  for (const f of reg.files()) {
    const buf = fs.readFileSync(reg.filePath(f.slice(0, -4)));
    assert.ok(buf.length < 256 * 1024, f);
    assert.equal(buf.readUInt32BE(16), 128, `${f} Breite`);
    assert.equal(buf.readUInt32BE(20), 128, `${f} Höhe`);
  }
});

test('Registry lädt nur fehlende Emojis hoch und liefert Markup', async () => {
  const reg = new EmojiRegistry();
  const total = reg.files().length;
  const client = fakeClient(['hp_owner', 'hp_check']);
  await reg.sync(client, quiet);
  assert.equal(client.created.length, total - 2);
  assert.ok(!client.created.includes('hp_owner'));
  assert.match(reg.icon('owner'), /^<:hp_owner:\d+> $/);
  assert.deepEqual(Object.keys(reg.component('check')), ['id', 'name']);
  assert.equal(reg.icon('gibtsnicht'), '');
  assert.equal(reg.component('gibtsnicht'), undefined);
});

test('Ohne Emojis: kein Ersatz durch Standard-Emojis', () => {
  const reg = new EmojiRegistry();
  assert.equal(reg.icon('owner'), '');
  const b = withEmoji(new ButtonBuilder().setCustomId('x').setLabel('X').setStyle(ButtonStyle.Primary), 'gibtsnicht');
  assert.equal(b.toJSON().emoji, undefined);
});

test('Panels mit aktiven Emojis bleiben gültig und unter den Discord-Limits', async () => {
  await emojis.sync(fakeClient(), quiet);
  try {
    // Längste realistische IDs, damit die Längenprüfung den ungünstigsten Fall abdeckt
    const id = '1234567890123456789';
    const roleIds = Object.fromEntries(ROLES.map((r) => [r.key, id]));
    for (const def of panelDefinitions()) {
      const p = def.build({ env: { currency: 'HC', websiteUrl: 'https://x.de' }, roleIds, channelIds: { support: id, announcements: id } });
      assert.ok(textLength(p) <= TEXT_LIMIT, `${def.key}: ${textLength(p)} Zeichen`);
      const json = JSON.stringify(p.components.map((c) => c.toJSON()));
      assert.match(json, /<:hp_/);
    }
    const docs = JSON.stringify(panelDefinitions()[0].build({ env: { currency: 'HC', websiteUrl: '' }, roleIds }).components[0].toJSON());
    assert.ok(!docs.includes('<@&'), 'keine Rollenliste in #regeln');
    const menu = panelDefinitions().find((d) => d.key === 'tickets').build({}).components[0].toJSON().components.find((c) => c.type === 1).components[0];
    assert.ok(menu.options.every((o) => o.emoji?.id), 'Auswahlmenü mit Icons');
  } finally {
    emojis.map.clear();
  }
});

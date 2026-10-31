'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatusService } = require('../src/services/status');

test('Status: oft prüfen, aber nur bei Änderungen bearbeiten', async () => {
  let healthy = true;
  const api = { configured: true, health: async () => ({ ok: healthy }) };
  const minecraft = { state: { online: true, since: new Date('2026-10-31T08:00:00Z'), lastError: null } };
  const edits = [];
  const channel = {
    id: 'c', isTextBased: () => true,
    messages: { fetch: async () => ({ id: 'm', edit: async (p) => { edits.push(p); return { id: 'm' }; } }) },
    send: async (p) => { edits.push(p); return { id: 'm' }; },
  };
  const g = { panels: { publicStatus: { channelId: 'c', messageId: 'm' } } };
  const guild = { id: '1', channels: { cache: new Map([['c', channel]]), fetch: async () => channel } };
  const client = { guilds: { cache: new Map([['1', guild]]) } };
  const status = createStatusService({ api, store: { guild: () => g, save() {} }, env: {}, logger: { warn() {}, debug() {} }, minecraft });

  await status.tick(client);
  await status.tick(client);
  await status.tick(client);
  assert.equal(edits.length, 1, 'unverändert → keine weitere Bearbeitung');

  minecraft.state.online = false;
  await status.tick(client);
  assert.equal(edits.length, 2, 'Minecraft-Bot offline → sofort aktualisiert');
  healthy = false;
  await status.tick(client);
  assert.equal(edits.length, 3, 'Website gestört → sofort aktualisiert');
  await status.tick(client, { force: true });
  assert.equal(edits.length, 4);
});

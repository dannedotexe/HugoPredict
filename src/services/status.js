'use strict';

const { discordTime } = require('../lib/embeds');
const { userMessage } = require('../lib/hugoApi');
const { emojis } = require('../lib/emojis');
const { card, upsert } = require('../lib/ui');
const theme = require('../config/theme');

function createStatusService({ api, store, env, logger }) {
  const startedAt = new Date();
  const state = { apiOk: null, apiCheckedAt: null, apiError: null, lastSyncOk: null, lastSyncAt: null };

  async function checkApi() {
    if (!api.configured) {
      Object.assign(state, { apiOk: false, apiCheckedAt: new Date(), apiError: 'nicht konfiguriert' });
      return;
    }
    try {
      const { ok } = await api.health();
      Object.assign(state, { apiOk: ok, apiCheckedAt: new Date(), apiError: ok ? null : 'Health-Check meldet Fehler' });
    } catch (err) {
      Object.assign(state, { apiOk: false, apiCheckedAt: new Date(), apiError: userMessage(err) });
    }
  }

  function recordSync(ok, err) {
    state.lastSyncOk = ok;
    state.lastSyncAt = new Date();
    if (!ok && err) logger.debug('Sync fehlgeschlagen:', err.message);
  }

  const line = (ok, text) => `${emojis.icon(ok === null ? 'closed' : ok ? 'resolved' : 'warning')}${text}`;

  async function buildPayload() {
    const healthy = state.apiOk === true;
    return card({
      title: 'Systemstatus',
      icon: 'open',
      intro: healthy ? 'Alle Systeme sind betriebsbereit.' : api.configured ? 'Mindestens ein System meldet eine Störung.' : 'Die Website ist noch nicht angebunden.',
      accent: healthy ? theme.colors.success : api.configured ? theme.colors.warning : theme.colors.neutral,
      blocks: [
        { heading: 'Discord-Bot', body: line(true, `Betriebsbereit · gestartet ${discordTime(startedAt, 'R')}`) },
        { heading: 'Website-API', body: api.configured ? line(state.apiOk, state.apiOk ? 'Betriebsbereit' : `Gestört${state.apiError ? ` · ${state.apiError}` : ''}`) : line(null, 'Nicht verbunden') },
        { heading: 'Marktübersicht', body: state.lastSyncAt ? line(state.lastSyncOk, `${state.lastSyncOk ? 'Synchron' : 'Gestört'} · ${discordTime(state.lastSyncAt, 'R')}`) : line(null, 'Noch keine Synchronisierung') },
      ],
      footer: `Zuletzt geprüft ${discordTime(new Date(), 't')}`,
    });
  }

  async function tick(client) {
    await checkApi();
    const payload = await buildPayload();
    for (const guild of client.guilds.cache.values()) {
      const g = store.guild(guild.id);
      const ref = g.panels.status;
      if (!ref) continue;
      try {
        const channel = guild.channels.cache.get(ref.channelId) ?? (await guild.channels.fetch(ref.channelId).catch(() => null));
        if (!channel?.isTextBased()) continue;
        const msg = await upsert(channel, ref, payload);
        if (msg.id !== ref.messageId) {
          g.panels.status = { channelId: channel.id, messageId: msg.id };
          store.save();
        }
      } catch (err) {
        logger.warn('Status-Panel:', err.message);
      }
    }
  }

  return { tick, buildPayload, recordSync, checkApi, state, env };
}

module.exports = { createStatusService };

'use strict';

const { embeds, discordTime } = require('../lib/embeds');
const { userMessage } = require('../lib/hugoApi');
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

  async function buildEmbed() {
    const dot = (ok) => (ok === null ? 'Unbekannt' : ok ? 'Betriebsbereit' : 'Gestört');
    const allOk = state.apiOk === true;
    return embeds.base(allOk ? theme.colors.success : api.configured ? theme.colors.warning : theme.colors.neutral)
      .setTitle('Systemstatus')
      .addFields(
        { name: 'Discord-Bot', value: `Betriebsbereit · gestartet ${discordTime(startedAt, 'R')}`, inline: false },
        {
          name: 'Website-API',
          value: api.configured ? `${dot(state.apiOk)}${state.apiError ? `\n${state.apiError}` : ''}` : 'Nicht verbunden',
          inline: false,
        },
        { name: 'Marktübersicht', value: state.lastSyncAt ? `${dot(state.lastSyncOk)} · ${discordTime(state.lastSyncAt, 'R')}` : 'Noch keine Synchronisierung', inline: false },
        { name: 'Website', value: env.websiteUrl || '—', inline: false },
      )
      .setFooter({ text: `${theme.brand} · Zuletzt geprüft` });
  }

  async function tick(client) {
    await checkApi();
    const embed = await buildEmbed();
    for (const guild of client.guilds.cache.values()) {
      const ref = store.guild(guild.id).panels.status;
      if (!ref) continue;
      try {
        const channel = guild.channels.cache.get(ref.channelId) ?? (await guild.channels.fetch(ref.channelId).catch(() => null));
        const msg = channel?.isTextBased() ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
        if (msg) await msg.edit({ embeds: [embed] });
      } catch (err) {
        logger.warn('Status-Panel:', err.message);
      }
    }
  }

  return { tick, buildEmbed, recordSync, checkApi, state };
}

module.exports = { createStatusService };

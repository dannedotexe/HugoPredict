'use strict';

const { discordTime } = require('../lib/embeds');
const { userMessage } = require('../lib/hugoApi');
const { emojis } = require('../lib/emojis');
const { card, upsert } = require('../lib/ui');
const theme = require('../config/theme');

function createStatusService({ api, store, env, logger, minecraft = null }) {
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
        {
          heading: 'Minecraft-Bot',
          body: !minecraft
            ? line(null, 'Nicht eingeschaltet (MC_ENABLED)')
            : minecraft.state.online
              ? line(true, `Auf HugoSMP · seit ${discordTime(minecraft.state.since, 'R')}`)
              : line(false, `Nicht verbunden${minecraft.state.lastError ? ` · ${String(minecraft.state.lastError).slice(0, 120)}` : ''}`),
        },
        { heading: 'Prognosen', body: state.lastSyncAt ? line(state.lastSyncOk, `${state.lastSyncOk ? 'Synchron' : 'Gestört'} · ${discordTime(state.lastSyncAt, 'R')}`) : line(null, 'Noch keine Synchronisierung') },
      ],
      footer: `Zuletzt geprüft ${discordTime(new Date(), 't')}`,
    });
  }

  /**
   * Öffentliche Statusseite für #status: nur „läuft / gestört / noch nicht
   * verfügbar“, ohne technische Fehlermeldungen.
   */
  async function buildPublicPayload() {
    const website = !api.configured ? null : state.apiOk === true;
    const mcOk = minecraft ? minecraft.state.online : null;
    const problems = [website === false, mcOk === false, state.lastSyncOk === false].some(Boolean);
    const pub = (ok, okText, badText, noneText) => line(ok, ok === null ? noneText : ok ? okText : badText);
    return card({
      title: 'Status',
      icon: 'open',
      intro: problems
        ? 'Gerade gibt es eine Störung. Wir kümmern uns darum, du musst nichts tun.'
        : 'Alles läuft. Hier siehst du jederzeit, ob Website und Bots erreichbar sind.',
      accent: problems ? theme.colors.warning : theme.colors.success,
      blocks: [
        { heading: 'Website', body: pub(website, 'Online', 'Gestört', 'Kommt bald') },
        { heading: 'Discord-Bot', body: line(true, `Online · seit ${discordTime(startedAt, 'R')}`) },
        { heading: 'Minecraft-Bot', body: pub(mcOk, 'Auf HugoSMP online', 'Gerade nicht verbunden', 'Kommt bald') },
        { heading: 'Prognosen', body: pub(api.configured ? state.lastSyncOk : null, `Aktuell${state.lastSyncAt ? ` · ${discordTime(state.lastSyncAt, 'R')}` : ''}`, 'Werden gerade nicht aktualisiert', 'Starten mit der Website') },
      ],
      footer: `Wird alle 5 Minuten aktualisiert · zuletzt ${discordTime(new Date(), 't')}`,
    });
  }

  async function updatePanel(guild, key, payload) {
    const g = store.guild(guild.id);
    const ref = g.panels[key];
    if (!ref) return;
    try {
      const channel = guild.channels.cache.get(ref.channelId) ?? (await guild.channels.fetch(ref.channelId).catch(() => null));
      if (!channel?.isTextBased()) return;
      const msg = await upsert(channel, ref, payload);
      if (msg.id !== ref.messageId) {
        g.panels[key] = { channelId: channel.id, messageId: msg.id };
        store.save();
      }
    } catch (err) {
      logger.warn(`Status-Panel (${key}):`, err.message);
    }
  }

  async function tick(client) {
    await checkApi();
    const payload = await buildPayload();
    const publicPayload = await buildPublicPayload();
    for (const guild of client.guilds.cache.values()) {
      await updatePanel(guild, 'status', payload);
      await updatePanel(guild, 'publicStatus', publicPayload);
    }
  }

  return { tick, buildPayload, buildPublicPayload, recordSync, checkApi, state, env };
}

module.exports = { createStatusService };

'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embeds, truncate, formatAmount, formatPrice, discordTime } = require('../lib/embeds');
const theme = require('../config/theme');

/*
 * #marktübersicht: Jeder Markt erhält genau EINE Nachricht. Sie entsteht, wenn
 * der Markt erstmals auftaucht, und wird bei Statuswechseln (pausiert,
 * Handel beendet, entschieden) oder relevanten Änderungen bearbeitet –
 * es entstehen keine Folgenachrichten und keine Benachrichtigungsflut.
 */

const STATUS_LABELS = {
  open: 'Offen',
  paused: 'Pausiert',
  closed: 'Handel beendet',
  resolved: 'Entschieden',
  rejected: 'Abgelehnt',
};
const STATUS_COLORS = {
  open: theme.colors.primary,
  paused: theme.colors.warning,
  closed: theme.colors.neutral,
  resolved: theme.colors.dark,
  rejected: theme.colors.danger,
};
const ACTIVE_STATUSES = ['open', 'paused', 'closed'];
const SEEN_LIMIT = 1000;

function marketEmbed(market, { currency }) {
  const e = embeds.base(STATUS_COLORS[market.status] ?? theme.colors.neutral)
    .setAuthor({ name: `Markt · ${STATUS_LABELS[market.status] ?? market.status}` })
    .setTitle(truncate(market.title, 256));
  if (market.url) e.setURL(market.url);
  if (market.description) e.setDescription(truncate(market.description, 350));
  const fields = [];
  if (market.status === 'resolved') {
    fields.push({ name: 'Ergebnis', value: market.outcome ? truncate(market.outcome, 256) : '—', inline: true });
    fields.push({ name: 'Entschieden', value: discordTime(market.resolvedAt ?? market.resolvesAt), inline: true });
    fields.push({ name: 'Volumen', value: formatAmount(market.volume, currency), inline: true });
  } else {
    fields.push(
      { name: 'Ja', value: formatPrice(market.yesPrice), inline: true },
      { name: 'Nein', value: formatPrice(market.noPrice), inline: true },
      { name: 'Volumen', value: formatAmount(market.volume, currency), inline: true },
      { name: 'Handelsschluss', value: discordTime(market.closesAt), inline: true },
      { name: 'Entscheidung', value: discordTime(market.resolvesAt), inline: true },
    );
  }
  if (market.status === 'paused') fields.push({ name: 'Hinweis', value: 'Der Handel ist vorübergehend ausgesetzt.', inline: false });
  return e.addFields(fields).setFooter({ text: `${theme.brand} · Zuletzt aktualisiert` });
}

function marketComponents(market) {
  if (!market.url) return [];
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zum Markt').setURL(market.url))];
}

/** Änderungen unter einem Prozentpunkt bzw. einer HC lösen keine Bearbeitung aus. */
function marketHash(m) {
  const r = (v, f) => (Number.isFinite(v) ? Math.round(v * f) : null);
  return crypto.createHash('sha1')
    .update(JSON.stringify([m.title, m.description, r(m.yesPrice, 100), r(m.noPrice, 100), r(m.volume, 1), m.closesAt, m.resolvesAt, m.status, m.outcome, m.url]))
    .digest('hex');
}

/**
 * Bestimmt die nötigen Aktionen ohne Discord-Zugriff (testbar).
 * - Aktive Märkte (offen/pausiert/beendet) erhalten eine Nachricht, solange das Limit nicht erreicht ist.
 * - Entschiedene Märkte: bestehende Nachricht wird aktualisiert; ohne Nachricht nur
 *   gepostet, wenn der Markt nach der Ersteinrichtung entschieden wurde.
 */
function planFeed({ active, resolved, messages, seenResolved, initialized, maxMarkets }) {
  const actions = [];
  const tracked = new Set(Object.keys(messages));
  let activeCount = active.filter((m) => tracked.has(m.id)).length;

  const ordered = [...active].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  for (const m of ordered) {
    const ref = messages[m.id];
    if (ref) {
      if (ref.hash !== marketHash(m)) actions.push({ type: 'edit', market: m });
    } else if (activeCount < maxMarkets) {
      actions.push({ type: 'post', market: m });
      activeCount++;
    }
  }
  for (const m of resolved) {
    const ref = messages[m.id];
    if (ref) {
      if (ref.hash !== marketHash(m)) actions.push({ type: 'edit', market: m });
    } else if (initialized && !seenResolved.has(m.id)) {
      actions.push({ type: 'post', market: m });
    }
  }
  return actions;
}

function createMarketFeed({ api, store, env, ctx, logger, statusService }) {
  let running = false;
  const errorLog = new Map();

  function reportError(guild, step, err) {
    const key = `${step}:${err.code ?? err.message}`;
    if (Date.now() - (errorLog.get(key) ?? 0) < 10 * 60_000) return;
    errorLog.set(key, Date.now());
    logger.warn(`Marktübersicht (${step}):`, err.message);
    ctx.audit(guild, 'system', { title: 'Störung der Marktübersicht', description: `**${step}:** ${err.message}`, color: theme.colors.warning });
  }

  async function syncGuild(guild) {
    const feed = store.guild(guild.id).marketFeed;
    const channel = await ctx.channel(guild, 'marketOverview');
    if (!channel?.isTextBased()) return;

    let active;
    let resolved;
    try {
      const lists = await Promise.all(ACTIVE_STATUSES.map((status) => api.listMarkets({ status, limit: 100 })));
      active = lists.flat();
      resolved = await api.listMarkets({ status: 'resolved', limit: 25 });
      statusService.recordSync(true);
    } catch (err) {
      statusService.recordSync(false, err);
      return reportError(guild, 'Märkte laden', err);
    }

    const seenResolved = new Set(feed.seen.resolved ?? []);
    const actions = planFeed({
      active, resolved, messages: feed.messages, seenResolved,
      initialized: Boolean(feed.initialized.overview), maxMarkets: env.marketFeedMaxMarkets,
    });

    for (const { type, market } of actions) {
      const payload = { embeds: [marketEmbed(market, env)], components: marketComponents(market), allowedMentions: { parse: [] } };
      try {
        const ref = feed.messages[market.id];
        const msg = type === 'edit' && ref ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
        if (msg) await msg.edit(payload);
        else {
          // Fehlt die Nachricht (z. B. manuell gelöscht), wird sie neu angelegt.
          const sent = await channel.send(payload);
          feed.messages[market.id] = { messageId: sent.id };
        }
        feed.messages[market.id].hash = marketHash(market);
      } catch (err) {
        reportError(guild, `Markt ${market.id}`, err);
      }
    }

    for (const m of resolved) seenResolved.add(m.id);
    feed.seen.resolved = [...seenResolved].slice(-SEEN_LIMIT);
    feed.initialized.overview = true;
    store.save();
  }

  async function tick(client) {
    if (running || !api.configured) return;
    running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (store.guild(guild.id).layoutVersion === 2) await syncGuild(guild);
      }
    } finally {
      running = false;
    }
  }

  return { tick, syncGuild };
}

module.exports = { createMarketFeed, marketEmbed, marketComponents, marketHash, planFeed, STATUS_LABELS };

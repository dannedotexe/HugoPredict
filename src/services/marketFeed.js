'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { truncate, formatAmount, formatPrice, discordTime } = require('../lib/embeds');
const { card, quote, upsert } = require('../lib/ui');
const theme = require('../config/theme');
const { emojis, withEmoji } = require('../lib/emojis');

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

/** Kursbalken für „Ja“, z. B. ▰▰▰▰▰▰▰▱▱▱▱▱ */
function priceBar(yes, segments = 12) {
  if (!Number.isFinite(yes)) return null;
  const filled = Math.max(0, Math.min(segments, Math.round(yes * segments)));
  return `\`${'▰'.repeat(filled)}${'▱'.repeat(segments - filled)}\``;
}

function marketActions(market) {
  if (!market.url) return [];
  return [new ActionRowBuilder().addComponents(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zum Markt').setURL(market.url), 'external'))];
}

/** Karte für einen Markt (#marktübersicht und /markets). */
function marketCard(market, { currency }, { ephemeral = false } = {}) {
  const label = STATUS_LABELS[market.status] ?? market.status;
  const blocks = [];
  if (market.description) blocks.push({ text: quote(truncate(market.description, 600)) });
  if (market.status === 'resolved') {
    blocks.push({ heading: 'Ergebnis', icon: 'resolved', body: `**${truncate(market.outcome ?? '—', 200)}**\nEntschieden ${discordTime(market.resolvedAt ?? market.resolvesAt)}` });
  } else {
    const bar = priceBar(market.yesPrice);
    blocks.push({
      heading: 'Kurse',
      icon: 'logo',
      body: `**Ja** ${formatPrice(market.yesPrice)}  ·  **Nein** ${formatPrice(market.noPrice)}${bar ? `\n${bar}` : ''}`,
    });
  }
  blocks.push({
    heading: 'Details',
    icon: 'info',
    body: [
      `Volumen **${formatAmount(market.volume, currency)}**`,
      market.status !== 'resolved' ? `Handelsschluss ${discordTime(market.closesAt)}` : null,
      market.status !== 'resolved' ? `Entscheidung ${discordTime(market.resolvesAt)}` : null,
    ].filter(Boolean).join('\n'),
  });
  if (market.status === 'paused') blocks.push({ heading: 'Hinweis', icon: 'paused', body: 'Der Handel ist vorübergehend ausgesetzt.' });
  return card({
    eyebrow: `${emojis.icon(market.status)}Markt · ${label}`,
    title: truncate(market.title, 200),
    accent: STATUS_COLORS[market.status] ?? theme.colors.neutral,
    logo: false,
    blocks,
    actions: marketActions(market),
    footer: `Aktualisiert ${discordTime(new Date(), 'f')}`,
    ephemeral,
  });
}

/** Änderungen unter einem Prozentpunkt bzw. einer HC lösen keine Bearbeitung aus. */
function marketHash(m) {
  const r = (v, f) => (Number.isFinite(v) ? Math.round(v * f) : null);
  return crypto.createHash('sha1')
    // Präfix = Darstellungsversion: Änderung erzwingt einmalig die Aktualisierung aller Karten.
    .update(JSON.stringify(['karte-v2', m.title, m.description, r(m.yesPrice, 100), r(m.noPrice, 100), r(m.volume, 1), m.closesAt, m.resolvesAt, m.status, m.outcome, m.url]))
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
      const payload = marketCard(market, env);
      try {
        const ref = feed.messages[market.id];
        // Bearbeiten, sonst (fehlende oder alte Embed-Nachricht) neu senden.
        const msg = await upsert(channel, type === 'edit' && ref ? { channelId: channel.id, messageId: ref.messageId } : null, payload);
        feed.messages[market.id] = { messageId: msg.id, hash: marketHash(market) };
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

module.exports = { createMarketFeed, marketCard, marketActions, marketHash, planFeed, priceBar, STATUS_LABELS };

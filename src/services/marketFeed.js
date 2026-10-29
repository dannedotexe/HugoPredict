'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embeds, truncate, formatAmount, formatPrice, discordTime } = require('../lib/embeds');
const theme = require('../config/theme');

const STATUS_LABELS = {
  open: 'Offen',
  closed: 'Handel beendet – Entscheidung ausstehend',
  resolved: 'Entschieden',
  rejected: 'Abgelehnt',
};
const PRICE_MOVE_THRESHOLD = 0.05; // 5 Prozentpunkte
const PRICE_MOVE_COOLDOWN_MS = 30 * 60_000;
const SEEN_LIMIT = 500;

function marketEmbed(market, { currency }) {
  const color = market.status === 'open' ? theme.colors.primary
    : market.status === 'resolved' ? theme.colors.success
      : market.status === 'rejected' ? theme.colors.danger : theme.colors.neutral;
  const e = embeds.base(color).setTitle(truncate(market.title, 256));
  if (market.url) e.setURL(market.url);
  if (market.description) e.setDescription(truncate(market.description, 350));
  const fields = [
    { name: 'YES', value: formatPrice(market.yesPrice), inline: true },
    { name: 'NO', value: formatPrice(market.noPrice), inline: true },
    { name: 'Volumen', value: formatAmount(market.volume, currency), inline: true },
    { name: 'Handelsschluss', value: discordTime(market.closesAt), inline: true },
    { name: 'Entscheidung', value: discordTime(market.resolvesAt), inline: true },
    { name: 'Status', value: STATUS_LABELS[market.status] ?? market.status, inline: true },
  ];
  if (market.status === 'resolved' && market.outcome) fields.push({ name: 'Ergebnis', value: truncate(market.outcome, 256), inline: false });
  if (market.status === 'rejected' && market.rejectionReason) fields.push({ name: 'Begründung', value: truncate(market.rejectionReason, 1024), inline: false });
  e.addFields(fields).setFooter({ text: `${theme.brand} · Zuletzt aktualisiert` });
  return e;
}

function marketComponents(market) {
  if (!market.url) return [];
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Auf der Website handeln').setURL(market.url))];
}

function marketHash(m) {
  return crypto.createHash('sha1')
    .update(JSON.stringify([m.title, m.description, m.yesPrice, m.noPrice, m.volume, m.closesAt, m.resolvesAt, m.status, m.outcome, m.url]))
    .digest('hex');
}

function summaryEmbed(title, markets, { currency, empty, line }) {
  const e = embeds.brand().setTitle(title).setFooter({ text: `${theme.brand} · Zuletzt aktualisiert` });
  if (!markets.length) return e.setDescription(empty);
  return e.setDescription(truncate(markets.map((m, i) => line(m, i, currency)).join('\n'), 4000));
}

const titleLink = (m) => (m.url ? `[${truncate(m.title, 80)}](${m.url})` : `**${truncate(m.title, 80)}**`);

/** Märkte, deren Handel innerhalb der nächsten `hours` Stunden endet. */
function closingSoon(markets, hours, now = Date.now()) {
  return markets
    .filter((m) => {
      const t = new Date(m.closesAt).getTime();
      return Number.isFinite(t) && t > now && t - now <= hours * 3_600_000;
    })
    .sort((a, b) => new Date(a.closesAt) - new Date(b.closesAt));
}

function topByVolume(markets, n = 10) {
  return markets.filter((m) => Number.isFinite(m.volume)).sort((a, b) => b.volume - a.volume).slice(0, n);
}

/** Erkennt deutliche Preisbewegungen seit der letzten Meldung. */
function detectPriceMoves(markets, priceState, now = Date.now()) {
  const moves = [];
  for (const m of markets) {
    if (!Number.isFinite(m.yesPrice)) continue;
    const prev = priceState[m.id];
    if (!prev) {
      priceState[m.id] = { price: m.yesPrice, at: 0 };
      continue;
    }
    const delta = m.yesPrice - prev.price;
    if (Math.abs(delta) >= PRICE_MOVE_THRESHOLD && now - prev.at >= PRICE_MOVE_COOLDOWN_MS) {
      moves.push({ market: m, from: prev.price, to: m.yesPrice, delta });
      priceState[m.id] = { price: m.yesPrice, at: now };
    }
  }
  return moves;
}

function createMarketFeed({ api, store, env, ctx, logger, statusService }) {
  let running = false;
  const errorLog = new Map(); // gedrosselte Fehlermeldungen

  function reportError(guild, step, err) {
    const key = `${step}:${err.code ?? err.message}`;
    const last = errorLog.get(key) ?? 0;
    if (Date.now() - last < 10 * 60_000) return;
    errorLog.set(key, Date.now());
    logger.warn(`Markt-Feed (${step}):`, err.message);
    ctx.audit(guild, 'botLogs', { title: 'Markt-Feed-Fehler', description: `**${step}**: ${err.message}`, color: theme.colors.warning });
  }

  async function upsertSummary(guild, key, payload) {
    const g = store.guild(guild.id);
    const channel = await ctx.channel(guild, key);
    if (!channel?.isTextBased()) return;
    const stored = g.marketFeed.summaries[key];
    if (stored?.channelId === channel.id) {
      const msg = await channel.messages.fetch(stored.messageId).catch(() => null);
      if (msg) return void (await msg.edit(payload));
    }
    const msg = await channel.send(payload);
    g.marketFeed.summaries[key] = { channelId: channel.id, messageId: msg.id };
  }

  /** Postet jeden Markt einer Liste nur einmal. Beim ersten Lauf wird nur der Bestand gemerkt. */
  async function announceOnce(guild, key, markets, build) {
    const feed = store.guild(guild.id).marketFeed;
    const seen = new Set(feed.seen[key] ?? []);
    const firstRun = !feed.initialized[key];
    const channel = await ctx.channel(guild, key);
    for (const m of markets) {
      if (seen.has(m.id)) continue;
      if (!firstRun && channel?.isTextBased()) await channel.send(build(m));
      seen.add(m.id);
    }
    feed.seen[key] = [...seen].slice(-SEEN_LIMIT);
    feed.initialized[key] = true;
  }

  async function syncLive(guild, markets) {
    const feed = store.guild(guild.id).marketFeed;
    const channel = await ctx.channel(guild, 'liveMarkets');
    if (!channel?.isTextBased()) return;
    const shown = markets.slice(0, env.marketFeedMaxMarkets);
    const shownIds = new Set(shown.map((m) => m.id));

    // Nicht mehr offene Märkte aus dem Live-Channel entfernen.
    for (const [id, ref] of Object.entries(feed.messages)) {
      if (shownIds.has(id)) continue;
      const msg = await channel.messages.fetch(ref.messageId).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
      delete feed.messages[id];
    }

    for (const m of shown) {
      const hash = marketHash(m);
      const ref = feed.messages[m.id];
      const payload = { embeds: [marketEmbed(m, env)], components: marketComponents(m) };
      if (ref) {
        if (ref.hash === hash) continue; // nichts geändert → kein Edit
        const msg = await channel.messages.fetch(ref.messageId).catch(() => null);
        if (msg) {
          await msg.edit(payload);
          feed.messages[m.id] = { messageId: msg.id, hash };
          continue;
        }
      }
      const msg = await channel.send(payload);
      feed.messages[m.id] = { messageId: msg.id, hash };
    }
  }

  async function syncGuild(guild) {
    const feed = store.guild(guild.id).marketFeed;
    let open;
    try {
      open = await api.listMarkets({ status: 'open', limit: 100 });
      statusService.recordSync(true);
    } catch (err) {
      statusService.recordSync(false, err);
      return reportError(guild, 'Offene Märkte laden', err);
    }

    const steps = [
      ['Live-Markets', () => syncLive(guild, open)],
      ['Top-Markets', () => upsertSummary(guild, 'topMarkets', {
        embeds: [summaryEmbed('Top-Märkte nach Volumen', topByVolume(open), {
          currency: env.currency,
          empty: 'Aktuell gibt es keine offenen Märkte mit Volumendaten.',
          line: (m, i, c) => `**${i + 1}.** ${titleLink(m)}\n${theme.symbols.dot} YES ${formatPrice(m.yesPrice)} · Volumen ${formatAmount(m.volume, c)}`,
        })],
      })],
      ['Bald entschieden', () => upsertSummary(guild, 'closingSoon', {
        embeds: [summaryEmbed(`Handelsschluss in den nächsten ${env.closingSoonHours} Stunden`, closingSoon(open, env.closingSoonHours).slice(0, 15), {
          currency: env.currency,
          empty: 'Derzeit endet kein Markt im angegebenen Zeitraum.',
          line: (m) => `${titleLink(m)} – ${discordTime(m.closesAt, 'R')}`,
        })],
      })],
      ['Neue Märkte', () => announceOnce(guild, 'newMarkets', open, (m) => ({
        content: null, embeds: [marketEmbed(m, env).setAuthor({ name: 'Neuer Markt' })], components: marketComponents(m),
      }))],
      ['Preisbewegungen', async () => {
        const moves = detectPriceMoves(open, feed.prices);
        const channel = moves.length ? await ctx.channel(guild, 'priceMovements') : null;
        for (const mv of moves.slice(0, 5)) {
          if (!channel?.isTextBased()) break;
          const up = mv.delta > 0;
          await channel.send({
            embeds: [embeds.base(up ? theme.colors.success : theme.colors.danger)
              .setTitle(truncate(mv.market.title, 256))
              .setURL(mv.market.url ?? null)
              .setDescription(`${up ? theme.symbols.up : theme.symbols.down} YES ${formatPrice(mv.from)} → **${formatPrice(mv.to)}** (${up ? '+' : ''}${(mv.delta * 100).toFixed(1)} Pp.)`)],
          });
        }
      }],
      ['Entschiedene Märkte', async () => announceOnce(guild, 'resolvedMarkets', await api.listMarkets({ status: 'resolved', limit: 25 }), (m) => ({
        embeds: [marketEmbed(m, env)], components: marketComponents(m),
      }))],
      ['Abgelehnte Märkte', async () => announceOnce(guild, 'rejectedMarkets', await api.listMarkets({ status: 'rejected', limit: 25 }), (m) => ({
        embeds: [marketEmbed(m, env)],
      }))],
    ];

    for (const [name, fn] of steps) {
      try {
        await fn();
      } catch (err) {
        reportError(guild, name, err);
      }
    }
    // Preis-Status für verschwundene Märkte aufräumen
    const openIds = new Set(open.map((m) => m.id));
    for (const id of Object.keys(feed.prices)) if (!openIds.has(id)) delete feed.prices[id];
    store.save();
  }

  async function tick(client) {
    if (running || !api.configured) return;
    running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (!store.guild(guild.id).setupCompletedAt) continue;
        await syncGuild(guild);
      }
    } finally {
      running = false;
    }
  }

  return { tick, syncGuild };
}

module.exports = { createMarketFeed, marketEmbed, marketComponents, marketHash, closingSoon, topByVolume, detectPriceMoves, STATUS_LABELS };

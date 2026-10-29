'use strict';

const { embeds, truncate, formatAmount, formatPrice, discordTime } = require('../lib/embeds');
const { userMessage } = require('../lib/hugoApi');
const theme = require('../config/theme');

// Website-Rangliste → Discord-Channels
const BOARDS = [
  { type: 'weekly', title: 'Wöchentliche Top-Trader', channels: ['weeklyTop'], unit: 'amount' },
  { type: 'all-time', title: 'All-Time-Leaderboard', channels: ['allTime', 'traderLeaderboard'], unit: 'amount' },
  { type: 'accuracy', title: 'Höchste Trefferquote', channels: ['accuracy'], unit: 'percent' },
  { type: 'biggest-wins', title: 'Größte Gewinne', channels: ['biggestWins'], unit: 'amount' },
];

function leaderboardEmbed(board, data, { currency }) {
  const e = embeds.brand().setTitle(board.title).setFooter({ text: `${theme.brand} · Daten der Website` });
  if (!data.entries.length) return e.setDescription('Für diesen Zeitraum liegen noch keine Daten vor.');
  const fmt = (v) => (board.unit === 'percent' ? formatPrice(v) : formatAmount(v, currency));
  const lines = data.entries.map((x) => {
    const who = x.discordId ? `<@${x.discordId}>` : `**${truncate(x.username, 32)}**`;
    return `\`${String(x.rank).padStart(2)}\` ${who} – ${fmt(x.value)}${x.detail ? ` · ${truncate(x.detail, 60)}` : ''}`;
  });
  e.setDescription(truncate(lines.join('\n'), 4000));
  const meta = [];
  if (data.period) meta.push(`Zeitraum: ${truncate(data.period, 100)}`);
  if (data.generatedAt) meta.push(`Stand: ${discordTime(data.generatedAt)}`);
  if (meta.length) e.addFields({ name: 'Info', value: meta.join('\n'), inline: false });
  return e;
}

function createLeaderboards({ api, store, env, ctx, logger }) {
  let running = false;

  async function updateGuild(guild) {
    const g = store.guild(guild.id);
    for (const board of BOARDS) {
      let data;
      try {
        data = await api.getLeaderboard(board.type, { limit: 10 });
      } catch (err) {
        logger.warn(`Rangliste ${board.type}:`, err.message, '-', userMessage(err));
        continue; // Keine Platzhalter- oder Fantasiewerte posten.
      }
      const payload = { embeds: [leaderboardEmbed(board, data, env)], allowedMentions: { parse: [] } };
      for (const key of board.channels) {
        try {
          const channel = await ctx.channel(guild, key);
          if (!channel?.isTextBased()) continue;
          const ref = g.leaderboards[key];
          const msg = ref?.channelId === channel.id ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
          if (msg) await msg.edit(payload);
          else {
            const sent = await channel.send(payload);
            g.leaderboards[key] = { channelId: channel.id, messageId: sent.id };
          }
        } catch (err) {
          logger.warn(`Rangliste ${board.type} in ${key}:`, err.message);
        }
      }
    }
    store.save();
  }

  async function tick(client) {
    if (running || !api.configured) return;
    running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (store.guild(guild.id).setupCompletedAt) await updateGuild(guild);
      }
    } finally {
      running = false;
    }
  }

  return { tick, updateGuild };
}

module.exports = { createLeaderboards, leaderboardEmbed, BOARDS };

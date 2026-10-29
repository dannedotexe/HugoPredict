'use strict';

const { embeds, truncate, formatAmount, formatPrice, discordTime } = require('../lib/embeds');
const theme = require('../config/theme');

/*
 * Ranglisten werden nicht mehr in öffentliche Channels gepostet, sondern nur
 * privat über /leaderboard angezeigt. Daten kommen ausschließlich von der Website.
 */
const BOARDS = [
  { type: 'weekly', title: 'Rangliste · Diese Woche', unit: 'amount' },
  { type: 'all-time', title: 'Rangliste · Gesamt', unit: 'amount' },
  { type: 'accuracy', title: 'Rangliste · Trefferquote', unit: 'percent' },
  { type: 'biggest-wins', title: 'Rangliste · Größte Gewinne', unit: 'amount' },
];

function leaderboardEmbed(board, data, { currency }) {
  const e = embeds.brand().setTitle(board.title).setFooter({ text: `${theme.brand} · Daten der Website` });
  if (!data.entries.length) return e.setDescription('Für diesen Zeitraum liegen noch keine Daten vor.');
  const fmt = (v) => (board.unit === 'percent' ? formatPrice(v) : formatAmount(v, currency));
  const lines = data.entries.map((x) => {
    const who = x.discordId ? `<@${x.discordId}>` : `**${truncate(x.username, 32)}**`;
    return `\`${String(x.rank).padStart(2)}\`  ${who} · ${fmt(x.value)}${x.detail ? ` · ${truncate(x.detail, 60)}` : ''}`;
  });
  e.setDescription(truncate(lines.join('\n'), 4000));
  const meta = [];
  if (data.period) meta.push(`Zeitraum: ${truncate(data.period, 100)}`);
  if (data.generatedAt) meta.push(`Stand: ${discordTime(data.generatedAt)}`);
  if (meta.length) e.addFields({ name: 'Details', value: meta.join('\n'), inline: false });
  return e;
}

module.exports = { leaderboardEmbed, BOARDS };

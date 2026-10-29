'use strict';

const { truncate, formatAmount, formatPrice, discordTime } = require('../lib/embeds');
const { card } = require('../lib/ui');

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

function leaderboardCard(board, data, { currency }, { ephemeral = true } = {}) {
  const fmt = (v) => (board.unit === 'percent' ? formatPrice(v) : formatAmount(v, currency));
  const medal = (rank) => (rank <= 3 ? `**#${rank}**` : `\`#${rank}\``);
  const lines = data.entries.map((x) => {
    const who = x.discordId ? `<@${x.discordId}>` : `**${truncate(x.username, 32)}**`;
    return `${medal(x.rank)}  ${who} · **${fmt(x.value)}**${x.detail ? ` · ${truncate(x.detail, 60)}` : ''}`;
  });
  return card({
    icon: board.unit === 'percent' ? 'fees' : 'logo',
    title: board.title,
    intro: [data.period ? `Zeitraum: ${truncate(data.period, 100)}` : null, data.generatedAt ? `Stand: ${discordTime(data.generatedAt)}` : null].filter(Boolean).join(' · ') || null,
    logo: false,
    blocks: [{ text: lines.length ? truncate(lines.join('\n'), 3500) : 'Für diesen Zeitraum liegen noch keine Daten vor.' }],
    footer: 'Daten der Website',
    ephemeral,
  });
}

module.exports = { leaderboardCard, BOARDS };

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { BOARDS, leaderboardCard } = require('../services/leaderboards');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Zeigt eine Rangliste (nur für dich sichtbar)')
    .addStringOption((o) => o.setName('typ').setDescription('Rangliste').addChoices(...BOARDS.map((b) => ({ name: b.title, value: b.type })))),
  async execute(interaction, deps) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const board = BOARDS.find((b) => b.type === (interaction.options.getString('typ') ?? 'all-time'));
    try {
      const data = await deps.api.getLeaderboard(board.type, { limit: 10 });
      return replyPrivate(interaction, leaderboardCard(board, data, deps.env));
    } catch (err) {
      return replyApiError(interaction, err, { ...deps, action: '/leaderboard' });
    }
  },
};

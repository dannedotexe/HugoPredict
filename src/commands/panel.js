'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { buildPage } = require('../panel/pages');
const { isPanelAdmin, stateOf } = require('../panel/access');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Admin-Panel von HugoPredict (nur für den Inhaber)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  rateLimit: 'default',
  async execute(interaction, deps) {
    if (!isPanelAdmin(deps, interaction.user.id)) {
      return replyPrivate(interaction, { embeds: [embeds.error('Keine Berechtigung', 'Das Admin-Panel ist nur für den Inhaber von HugoPredict.')] });
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    return replyPrivate(interaction, await buildPage('dashboard', { client: interaction.client, deps, state: stateOf(interaction.user.id) }));
  },
};

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');
const { mainView } = require('../panel/minecraftPanel');
const { isPanelAdmin } = require('../panel/access');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Minecraft-Befehle über den Bot ausführen (nur für den Inhaber)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  rateLimit: 'default',
  async execute(interaction, deps) {
    if (!isPanelAdmin(deps, interaction.user.id)) {
      return replyPrivate(interaction, { embeds: [embeds.error('Keine Berechtigung', 'Das Panel ist nur für den Inhaber von HugoPredict.')] });
    }
    return replyPrivate(interaction, mainView(deps.minecraft));
  },
};

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { startVerification } = require('../interactions/verification');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verknüpft deinen Minecraft-Account mit HugoSMP Market')
    .addStringOption((o) => o.setName('minecraft_name').setDescription('Dein Minecraft-Name').setRequired(true).setMinLength(3).setMaxLength(16)),
  rateLimit: 'verify',
  execute: (interaction, deps) => startVerification(interaction, interaction.options.getString('minecraft_name', true), deps),
};

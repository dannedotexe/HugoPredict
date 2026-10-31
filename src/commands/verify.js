'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { startVerification } = require('../interactions/verification');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verknüpft dein Discord-Konto mit deinem HugoPredict-Konto')
    .addStringOption((o) => o.setName('minecraft_name').setDescription('Nur nötig, wenn der Minecraft-Bot aus ist').setRequired(false).setMinLength(3).setMaxLength(16)),
  rateLimit: 'verify',
  execute: (interaction, deps) => startVerification(interaction, interaction.options.getString('minecraft_name') ?? '', deps),
};

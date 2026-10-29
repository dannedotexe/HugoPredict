'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { suggestionModal } = require('../interactions/suggestions');

module.exports = {
  data: new SlashCommandBuilder().setName('vorschlag').setDescription('Schlägt einen neuen Markt vor'),
  rateLimit: 'suggest',
  execute: (interaction) => interaction.showModal(suggestionModal()),
};

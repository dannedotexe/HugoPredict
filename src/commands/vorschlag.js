'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { suggestionModal } = require('../interactions/suggestions');

module.exports = {
  data: new SlashCommandBuilder().setName('vorschlag').setDescription('Schlägt eine neue Prognose vor'),
  rateLimit: 'suggest',
  execute: (interaction) => interaction.showModal(suggestionModal()),
};

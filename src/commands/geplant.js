'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate } = require('../lib/respond');
const { scheduledCard, scheduledList } = require('../interactions/announcements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('geplant')
    .setDescription('Zeigt geplante Ankündigungen und lässt sie abbrechen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  privilege: 'announce',
  execute: (interaction, deps) => replyPrivate(interaction, scheduledCard(scheduledList(interaction.guild.id, deps.store))),
};

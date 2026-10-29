'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { announcementModal } = require('../interactions/announcements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ankündigung')
    .setDescription('Veröffentlicht eine Ankündigung in #ankündigungen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('benachrichtigen').setDescription('Rolle „Ankündigungen“ pingen (Standard: ja)')),
  privilege: 'announce',
  execute: (interaction) => interaction.showModal(announcementModal({ ping: interaction.options.getBoolean('benachrichtigen') ?? true })),
};

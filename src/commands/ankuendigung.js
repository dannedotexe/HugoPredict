'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');
const { parseBerlinTime } = require('../lib/berlinTime');
const { announcementModal } = require('../interactions/announcements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ankündigung')
    .setDescription('Veröffentlicht oder plant eine Ankündigung in #ankündigungen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('benachrichtigen').setDescription('Rolle „Ankündigungen“ pingen (Standard: ja)'))
    .addStringOption((o) => o.setName('zeitpunkt').setDescription('Später veröffentlichen, z. B. „20:00“, „morgen 18:30“ oder „14.11. 20:00“ (deutsche Zeit)').setMaxLength(40)),
  privilege: 'announce',
  execute(interaction) {
    const ping = interaction.options.getBoolean('benachrichtigen') ?? true;
    const when = interaction.options.getString('zeitpunkt');
    let at = 0;
    if (when) {
      const parsed = parseBerlinTime(when);
      if (!parsed.ok) return replyPrivate(interaction, { embeds: [embeds.error('Zeitpunkt nicht erkannt', parsed.error)] });
      at = parsed.at;
    }
    return interaction.showModal(announcementModal({ ping, at }));
  },
};

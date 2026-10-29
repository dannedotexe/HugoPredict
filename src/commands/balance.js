'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embeds, formatAmount } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Zeigt dein Guthaben (nur für dich sichtbar)'),
  rateLimit: 'balance',
  async execute(interaction, deps) {
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      const b = await deps.api.getBalance(interaction.user.id);
      const e = embeds.brand().setTitle('Dein Guthaben').addFields({ name: 'Gesamt', value: formatAmount(b.balance, deps.env.currency), inline: true });
      if (b.available !== null) e.addFields({ name: 'Verfügbar', value: formatAmount(b.available, deps.env.currency), inline: true });
      if (b.locked !== null) e.addFields({ name: 'In Positionen gebunden', value: formatAmount(b.locked, deps.env.currency), inline: true });
      if (b.username) e.setDescription(`Konto: **${b.username}**`);
      return replyPrivate(interaction, { embeds: [e] });
    } catch (err) {
      return replyApiError(interaction, err, { ...deps, action: '/balance' });
    }
  },
};

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embeds, formatAmount, discordTime, truncate } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Zeigt deine letzten Transaktionen (nur für dich sichtbar)')
    .addIntegerOption((o) => o.setName('anzahl').setDescription('Anzahl der Einträge (1–25)').setMinValue(1).setMaxValue(25)),
  rateLimit: 'history',
  async execute(interaction, deps) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const limit = interaction.options.getInteger('anzahl') ?? 10;
    try {
      const list = await deps.api.getTransactions(interaction.user.id, { limit });
      const e = embeds.brand().setTitle('Deine Transaktionen');
      if (!list.length) return replyPrivate(interaction, { embeds: [e.setDescription('Es sind noch keine Transaktionen vorhanden.')] });
      const lines = list.slice(0, limit).map((t) => {
        const sign = t.amount > 0 ? '+' : '';
        return `${discordTime(t.createdAt, 'd')} · **${sign}${formatAmount(t.amount, deps.env.currency)}** · ${truncate(t.type, 30)}${t.description ? `\n${truncate(t.description, 90)}` : ''}`;
      });
      return replyPrivate(interaction, { embeds: [e.setDescription(truncate(lines.join('\n'), 4000))] });
    } catch (err) {
      return replyApiError(interaction, err, { ...deps, action: '/history' });
    }
  },
};

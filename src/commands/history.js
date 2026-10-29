'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { formatAmount, discordTime, truncate } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { card } = require('../lib/ui');

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
      const list = (await deps.api.getTransactions(interaction.user.id, { limit })).slice(0, limit);
      const lines = list.map((t) => {
        const sign = t.amount > 0 ? '+' : '';
        return `**${sign}${formatAmount(t.amount, deps.env.currency)}** · ${truncate(t.type, 30)} · ${discordTime(t.createdAt, 'd')}${t.description ? `\n-# ${truncate(t.description, 90)}` : ''}`;
      });
      return replyPrivate(interaction, card({
        icon: 'balance',
        title: 'Deine Transaktionen',
        logo: false,
        blocks: [lines.length ? { text: truncate(lines.join('\n'), 3500) } : { text: 'Es sind noch keine Transaktionen vorhanden.' }],
        footer: 'Nur für dich sichtbar · Daten der Website',
        ephemeral: true,
      }));
    } catch (err) {
      return replyApiError(interaction, err, { ...deps, action: '/history' });
    }
  },
};

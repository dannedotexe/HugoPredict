'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { formatAmount } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { card } = require('../lib/ui');

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Zeigt dein Guthaben (nur für dich sichtbar)'),
  rateLimit: 'balance',
  async execute(interaction, deps) {
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      const b = await deps.api.getBalance(interaction.user.id);
      const c = deps.env.currency;
      return replyPrivate(interaction, card({
        icon: 'balance',
        title: 'Dein Guthaben',
        intro: `# ${formatAmount(b.balance, c)}${b.username ? `\n-# Konto ${b.username}` : ''}`,
        logo: false,
        blocks: [(b.available !== null || b.locked !== null) && {
          heading: 'Aufteilung',
          body: [b.available !== null ? `Verfügbar **${formatAmount(b.available, c)}**` : null, b.locked !== null ? `In Positionen gebunden **${formatAmount(b.locked, c)}**` : null].filter(Boolean).join('\n'),
        }],
        footer: 'Nur für dich sichtbar · Daten der Website',
        ephemeral: true,
      }));
    } catch (err) {
      return replyApiError(interaction, err, { ...deps, action: '/balance' });
    }
  },
};

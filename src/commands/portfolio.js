'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embeds, formatAmount, formatPrice, truncate } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');

module.exports = {
  data: new SlashCommandBuilder().setName('portfolio').setDescription('Zeigt deine offenen Positionen (nur für dich sichtbar)'),
  rateLimit: 'portfolio',
  async execute(interaction, deps) {
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      const { positions, totalValue } = await deps.api.getPortfolio(interaction.user.id);
      const e = embeds.brand().setTitle('Dein Portfolio');
      if (!positions.length) {
        e.setDescription('Du hast derzeit keine offenen Positionen.');
      } else {
        for (const p of positions.slice(0, 15)) {
          e.addFields({
            name: truncate(`${p.side.toUpperCase()} · ${p.marketTitle}`, 256),
            value: [
              `Anteile: ${p.shares ?? '—'}`,
              `Ø Einstieg: ${formatPrice(p.avgPrice)} · Aktuell: ${formatPrice(p.currentPrice)}`,
              `Wert: ${formatAmount(p.value, deps.env.currency)}`,
              p.url ? `[Zum Markt](${p.url})` : null,
            ].filter(Boolean).join('\n'),
            inline: false,
          });
        }
        if (positions.length > 15) e.setDescription(`Es werden 15 von ${positions.length} Positionen angezeigt. Alle findest du auf der Website.`);
      }
      if (totalValue !== null) e.addFields({ name: 'Gesamtwert', value: formatAmount(totalValue, deps.env.currency), inline: false });
      return replyPrivate(interaction, { embeds: [e] });
    } catch (err) {
      return replyApiError(interaction, err, { ...deps, action: '/portfolio' });
    }
  },
};

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { formatAmount, formatPrice, truncate } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { card } = require('../lib/ui');

const SIDES = { yes: 'Ja', no: 'Nein' };

module.exports = {
  data: new SlashCommandBuilder().setName('portfolio').setDescription('Zeigt deine offenen Positionen (nur für dich sichtbar)'),
  rateLimit: 'portfolio',
  async execute(interaction, deps) {
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      const { positions, totalValue } = await deps.api.getPortfolio(interaction.user.id);
      const c = deps.env.currency;
      const shown = positions.slice(0, 10);
      const blocks = shown.map((p) => ({
        heading: truncate(`${SIDES[p.side.toLowerCase()] ?? p.side} · ${p.marketTitle}`, 120),
        body: [
          `Anteile **${p.shares ?? '—'}** · Wert **${formatAmount(p.value, c)}**`,
          `Ø Einstieg ${formatPrice(p.avgPrice)} · aktuell ${formatPrice(p.currentPrice)}`,
          p.url ? `[Zur Prognose](${p.url})` : null,
        ].filter(Boolean).join('\n'),
      }));
      if (!shown.length) blocks.push({ text: 'Du hast derzeit keine offenen Positionen.' });
      return replyPrivate(interaction, card({
        icon: 'platform',
        title: 'Dein Portfolio',
        intro: totalValue !== null ? `Gesamtwert **${formatAmount(totalValue, c)}**` : null,
        logo: false,
        blocks,
        footer: positions.length > shown.length ? `${shown.length} von ${positions.length} Positionen · alle auf der Website` : 'Nur für dich sichtbar',
        ephemeral: true,
      }));
    } catch (err) {
      return replyApiError(interaction, err, { ...deps, action: '/portfolio' });
    }
  },
};

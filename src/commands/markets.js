'use strict';

const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { embeds, formatPrice, formatAmount, truncate, discordTime } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { STATUS_LABELS } = require('../services/marketFeed');

const STATUS_CHOICES = [
  { name: 'Offen', value: 'open' },
  { name: 'Handel beendet', value: 'closed' },
  { name: 'Entschieden', value: 'resolved' },
];

function listPayload(markets, status, currency) {
  const shown = markets.slice(0, 10);
  const e = embeds.brand().setTitle(`Märkte · ${STATUS_LABELS[status]}`);
  if (!shown.length) return { embeds: [e.setDescription('Aktuell gibt es keine Märkte in dieser Ansicht.')], components: [] };
  e.setDescription(truncate(shown.map((m, i) =>
    `**${i + 1}. ${truncate(m.title, 90)}**\nYES ${formatPrice(m.yesPrice)} · NO ${formatPrice(m.noPrice)} · Volumen ${formatAmount(m.volume, currency)} · Schluss ${discordTime(m.closesAt, 'R')}`,
  ).join('\n\n'), 4000));
  if (markets.length > shown.length) e.addFields({ name: 'Hinweis', value: `${markets.length - shown.length} weitere Märkte findest du auf der Website.`, inline: false });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`hm:markets:view:${status}`)
    .setPlaceholder('Markt für Details auswählen')
    .addOptions(shown.map((m) => ({ label: truncate(m.title, 100), value: truncate(m.id, 100), description: `YES ${formatPrice(m.yesPrice)}` })));
  return { embeds: [e], components: [new ActionRowBuilder().addComponents(menu)] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('markets')
    .setDescription('Listet verfügbare Märkte auf')
    .addStringOption((o) => o.setName('status').setDescription('Welche Märkte?').addChoices(...STATUS_CHOICES)),
  async execute(interaction, deps) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const status = interaction.options.getString('status') ?? 'open';
    try {
      const markets = await deps.api.listMarkets({ status, limit: 25 });
      return replyPrivate(interaction, listPayload(markets, status, deps.env.currency));
    } catch (err) {
      return replyApiError(interaction, err, { ...deps, action: '/markets' });
    }
  },
  listPayload,
};

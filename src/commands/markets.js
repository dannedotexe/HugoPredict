'use strict';

const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { formatPrice, formatAmount, truncate, discordTime } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { STATUS_LABELS, priceBar } = require('../services/marketFeed');
const { card } = require('../lib/ui');

const STATUS_CHOICES = [
  { name: 'Offen', value: 'open' },
  { name: 'Pausiert', value: 'paused' },
  { name: 'Handel beendet', value: 'closed' },
  { name: 'Entschieden', value: 'resolved' },
];

function listPayload(markets, status, currency) {
  const shown = markets.slice(0, 8);
  const blocks = shown.map((m) => ({
    heading: truncate(m.title, 90),
    body: [
      `**Ja** ${formatPrice(m.yesPrice)}  ·  **Nein** ${formatPrice(m.noPrice)}${priceBar(m.yesPrice) ? `  ${priceBar(m.yesPrice, 8)}` : ''}`,
      `Volumen ${formatAmount(m.volume, currency)} · Schluss ${discordTime(m.closesAt, 'R')}`,
    ].join('\n'),
  }));
  if (!shown.length) blocks.push({ text: 'Aktuell gibt es keine Märkte in dieser Ansicht.' });
  const actions = shown.length ? [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`hm:markets:view:${status}`)
      .setPlaceholder('Markt für Details auswählen …')
      .addOptions(shown.map((m) => ({ label: truncate(m.title, 100), value: truncate(m.id, 100), description: `Ja ${formatPrice(m.yesPrice)}` }))),
  )] : [];
  return card({
    icon: status,
    title: `Märkte · ${STATUS_LABELS[status]}`,
    intro: markets.length > shown.length ? `${shown.length} von ${markets.length} Märkten. Alle findest du auf der Website.` : null,
    logo: false,
    blocks,
    actions,
    ephemeral: true,
  });
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

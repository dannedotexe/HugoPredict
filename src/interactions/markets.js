'use strict';

const { embeds } = require('../lib/embeds');
const { replyApiError, EPHEMERAL } = require('../lib/respond');
const { marketEmbed, marketComponents } = require('../services/marketFeed');
const { MARKET_STATUSES } = require('../lib/hugoApi');

/** Select-Menü aus /markets: zeigt Details eines Marktes (frisch von der Website). */
async function handle(interaction, deps, [action, status]) {
  if (action !== 'view' || !interaction.isStringSelectMenu() || !MARKET_STATUSES.includes(status)) return;
  if (!deps.checkRate(interaction, 'default')) return;
  await interaction.deferUpdate();
  try {
    const markets = await deps.api.listMarkets({ status, limit: 25 });
    const market = markets.find((m) => m.id === interaction.values[0]);
    if (!market) {
      return interaction.followUp({ embeds: [embeds.warning('Nicht gefunden', 'Dieser Markt ist in dieser Ansicht nicht mehr verfügbar.')], flags: EPHEMERAL });
    }
    // Auswahlmenü behalten, Link-Button zum Markt ergänzen.
    return interaction.editReply({ embeds: [marketEmbed(market, deps.env)], components: [interaction.message.components[0], ...marketComponents(market)] });
  } catch (err) {
    return replyApiError(interaction, err, { ...deps, action: 'Marktdetails' });
  }
}

module.exports = { prefix: 'markets', handle };

'use strict';

const { embeds } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { marketCard } = require('../services/marketFeed');
const { MARKET_STATUSES } = require('../lib/hugoApi');

/** Select-Menü aus /prognosen: zeigt die Karte einer Prognose (frisch von der Website). */
async function handle(interaction, deps, [action, status]) {
  if (action !== 'view' || !interaction.isStringSelectMenu() || !MARKET_STATUSES.includes(status)) return;
  if (!deps.checkRate(interaction, 'default')) return;
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const markets = await deps.api.listMarkets({ status, limit: 25 });
    const market = markets.find((m) => m.id === interaction.values[0]);
    if (!market) return replyPrivate(interaction, { embeds: [embeds.warning('Nicht gefunden', 'Diese Prognose ist in dieser Ansicht nicht mehr verfügbar.')] });
    return replyPrivate(interaction, marketCard(market, deps.env, { ephemeral: true }));
  } catch (err) {
    return replyApiError(interaction, err, { ...deps, action: 'Prognosedetails' });
  }
}

module.exports = { prefix: 'markets', handle };

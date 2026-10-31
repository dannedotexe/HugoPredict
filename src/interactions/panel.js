'use strict';

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');
const { PAGES, buildPage, logs, restartConfirm, USERS_PER_PAGE } = require('../panel/pages');
const { isPanelAdmin, stateOf } = require('../panel/access');

/* Steuerung des Admin-Panels (/panel). Jede Interaktion prüft erneut die Discord-ID. */

const searchModal = () => new ModalBuilder().setCustomId('hm:panel:searchmodal').setTitle('Nutzer suchen').addComponents(
  new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('q').setLabel('Minecraft-, Discord-Name oder Discord-ID').setStyle(TextInputStyle.Short).setMaxLength(40).setRequired(true),
  ),
);

/** Ersetzt die Panel-Nachricht durch eine neue Seite. */
async function show(interaction, build) {
  await interaction.deferUpdate();
  const payload = await build();
  // Beim Bearbeiten bleibt nur das Karten-Flag; Sichtbarkeit steht fest.
  return interaction.editReply({ ...payload, flags: MessageFlags.IsComponentsV2, files: [] });
}

async function handle(interaction, deps, [action, arg]) {
  if (!isPanelAdmin(deps, interaction.user.id)) {
    return replyPrivate(interaction, { embeds: [embeds.error('Keine Berechtigung', 'Das Admin-Panel ist nur für den Inhaber von HugoPredict.')] });
  }
  if (!deps.checkRate(interaction, 'default')) return;
  const state = stateOf(interaction.user.id);
  const ctx = { client: interaction.client, deps, state };
  const go = (key) => show(interaction, () => buildPage(key, ctx));

  if (action === 'nav' && interaction.isStringSelectMenu()) {
    const key = interaction.values[0];
    return PAGES.some((p) => p.key === key) ? go(key) : undefined;
  }
  if (action === 'go' && interaction.isButton()) return PAGES.some((p) => p.key === arg) ? go(arg) : undefined;
  if (action === 'users' && interaction.isButton()) {
    if (arg === 'prev') state.offset = Math.max(0, state.offset - USERS_PER_PAGE);
    if (arg === 'next') state.offset += USERS_PER_PAGE;
    if (arg === 'clear') Object.assign(state, { q: '', offset: 0 });
    return go('users');
  }
  if (action === 'search' && interaction.isButton()) return interaction.showModal(searchModal());
  if (action === 'searchmodal' && interaction.isModalSubmit()) {
    Object.assign(state, { q: interaction.fields.getTextInputValue('q').trim().slice(0, 40), offset: 0 });
    return go('users');
  }
  if (action === 'txtype' && interaction.isStringSelectMenu()) {
    const v = interaction.values[0];
    state.txType = v === 'all' ? '' : v;
    return go('transactions');
  }
  if (action === 'logs' && interaction.isButton() && (arg === 'out' || arg === 'err')) return show(interaction, () => logs(ctx, arg));
  if (action === 'restart' && interaction.isButton()) return show(interaction, async () => restartConfirm());
  if (action === 'restartok' && interaction.isButton()) {
    await interaction.update({ components: [], content: 'HugoPredict startet neu … In ein paar Sekunden kannst du `/panel` wieder öffnen.', flags: 0 }).catch(() => {});
    if (interaction.guild) {
      await deps.ctx.audit(interaction.guild, 'audit', { title: 'Bot-Neustart über /panel', fields: [{ name: 'Von', value: `<@${interaction.user.id}>` }] });
    }
    deps.logger.info(`Neustart über /panel von ${interaction.user.tag}.`);
    setTimeout(() => deps.services.restartBot?.(), 1500).unref?.();
  }
}

module.exports = { prefix: 'panel', handle };

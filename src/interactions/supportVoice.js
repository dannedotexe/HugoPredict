'use strict';

const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { setSupportOpen } = require('../services/supportVoice');
const { refreshPanels } = require('../setup/panels');

/** Panel in #support-steuerung: Support-Warteraum öffnen oder schließen (nur Team). */
async function handle(interaction, deps, [action]) {
  if (!interaction.isButton() || !interaction.inGuild() || !['open', 'close'].includes(action)) return;
  if (!deps.ctx.can(interaction.member, 'ticketStaff')) return deps.deny(interaction, 'Support-Warteraum steuern');
  if (!deps.checkRate(interaction, 'default')) return;
  const open = action === 'open';
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    if (!(await setSupportOpen(interaction.guild, deps.store, open))) {
      return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Der Support-Warteraum existiert noch nicht. Führe `/setup-panels` aus.')] });
    }
  } catch (err) {
    deps.logger.warn('Support-Warteraum:', err.message);
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht möglich', 'Die Rechte des Warteraums konnten nicht geändert werden. Die Bot-Rolle braucht „Verbinden“ und „Kanäle verwalten“.')] });
  }
  await refreshPanels(interaction.guild, ['supportControl', 'tickets'], deps).catch((err) => deps.logger.warn('Panels aktualisieren:', err.message));
  await deps.ctx.audit(interaction.guild, 'tickets', {
    title: `Support-Warteraum ${open ? 'geöffnet' : 'geschlossen'}`,
    fields: [{ name: 'Von', value: `<@${interaction.user.id}>` }],
  });
  return replyPrivate(interaction, {
    embeds: [open
      ? embeds.success('Warteraum geöffnet', 'Mitglieder können jetzt in den Support-Warteraum. Wer wartet, wird in #moderation gemeldet.')
      : embeds.info('Warteraum geschlossen', 'Niemand kann den Support-Warteraum mehr betreten. Wer schon drin ist, bleibt dort.')],
  });
}

module.exports = { prefix: 'supportvoice', handle };

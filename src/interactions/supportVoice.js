'use strict';

const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { setSupportOpen, emptyWaitingRoom } = require('../services/supportVoice');
const { refreshPanels } = require('../setup/panels');

/** Panel in #support-steuerung: Support-Warteraum öffnen, schließen oder leeren (nur Team). */
async function handle(interaction, deps, [action]) {
  if (!interaction.isButton() || !interaction.inGuild() || !['open', 'close', 'empty'].includes(action)) return;
  if (!deps.ctx.can(interaction.member, 'ticketStaff')) return deps.deny(interaction, 'Support-Warteraum steuern');
  if (!deps.checkRate(interaction, 'default')) return;
  if (action === 'empty') return empty(interaction, deps);
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
      : embeds.info('Warteraum geschlossen', 'Niemand kann den Support-Warteraum mehr betreten. Wer schon drin ist, entfernst du mit „Warteraum leeren“.')],
  });
}

async function empty(interaction, deps) {
  await interaction.deferReply({ flags: EPHEMERAL });
  let removed;
  try {
    removed = await emptyWaitingRoom(interaction.guild, deps.store, (m) => deps.ctx.can(m, 'ticketStaff'));
  } catch (err) {
    deps.logger.warn('Warteraum leeren:', err.message);
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht möglich', 'Der Bot konnte nicht alle trennen. Die Bot-Rolle braucht „Mitglieder verschieben“.')] });
  }
  if (removed === null) {
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Der Support-Warteraum existiert noch nicht. Führe `/setup-panels` aus.')] });
  }
  if (removed) {
    await deps.ctx.audit(interaction.guild, 'tickets', {
      title: 'Support-Warteraum geleert',
      fields: [{ name: 'Von', value: `<@${interaction.user.id}>` }, { name: 'Entfernt', value: String(removed) }],
    });
  }
  return replyPrivate(interaction, {
    embeds: [removed
      ? embeds.success('Warteraum geleert', `${removed === 1 ? 'Eine Person wurde' : `${removed} Personen wurden`} aus dem Warteraum entfernt.`)
      : embeds.info('Warteraum ist leer', 'Im Warteraum wartet gerade niemand.')],
  });
}

module.exports = { prefix: 'supportvoice', handle };

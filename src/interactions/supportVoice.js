'use strict';

const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { setSupportOpen, emptyWaitingRoom } = require('../services/supportVoice');
const { refreshPanels } = require('../setup/panels');

/** Panel in #support-steuerung: Nächsten holen, Gespräch beenden, Warteraum öffnen/schließen/leeren (nur Team). */
async function handle(interaction, deps, [action]) {
  if (!interaction.isButton() || !interaction.inGuild() || !['open', 'close', 'empty', 'next', 'end'].includes(action)) return;
  if (!deps.ctx.can(interaction.member, 'ticketStaff')) return deps.deny(interaction, 'Support-Warteraum steuern');
  if (!deps.checkRate(interaction, 'default')) return;
  if (action === 'empty') return empty(interaction, deps);
  if (action === 'next') return takeNext(interaction, deps);
  if (action === 'end') return endConversation(interaction, deps);
  const open = action === 'open';
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    if (!(await setSupportOpen(interaction.guild, deps.store, open))) {
      return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Der Support-Warteraum existiert noch nicht. Führe `/aktualisieren` aus.')] });
    }
  } catch (err) {
    deps.logger.warn('Support-Warteraum:', err.message);
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht möglich', 'Die Rechte des Warteraums konnten nicht geändert werden. Die Bot-Rolle braucht „Verbinden“ und „Kanäle verwalten“.')] });
  }
  await refreshPanels(interaction.guild, ['supportControl', 'tickets'], deps).catch((err) => deps.logger.warn('Panels aktualisieren:', err.message));
  await deps.services?.supportVoice?.refresh(interaction.guild).catch((err) => deps.logger.warn('Warteschlange:', err.message));
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
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Der Support-Warteraum existiert noch nicht. Führe `/aktualisieren` aus.')] });
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

const NEXT_ERRORS = {
  not_setup: ['Nicht eingerichtet', 'Die Support-Räume existieren noch nicht. Führe `/aktualisieren` aus.'],
  no_room: ['Kein Raum frei', 'Alle Support-Räume sind belegt. Setz dich selbst in einen Support-Raum oder beende erst ein Gespräch.'],
  room_busy: ['Raum belegt', 'In deinem Support-Raum ist noch jemand. Beende zuerst das Gespräch.'],
  empty: ['Niemand wartet', 'Die Warteschlange ist leer.'],
  not_in_room: ['Nicht im Support-Raum', 'Setz dich zuerst in den Support-Raum, dessen Gespräch du beenden willst.'],
};
const errorReply = (key) => ({ embeds: [embeds.warning(NEXT_ERRORS[key][0], NEXT_ERRORS[key][1])] });

async function takeNext(interaction, deps) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const svc = deps.services?.supportVoice;
  let res;
  try {
    res = await svc.takeNext(interaction.guild, interaction.member);
  } catch (err) {
    deps.logger.warn('Nächsten holen:', err.message);
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht möglich', 'Die Person konnte nicht verschoben werden. Die Bot-Rolle braucht „Mitglieder verschieben“.')] });
  }
  if (res.error) return replyPrivate(interaction, errorReply(res.error));
  await deps.ctx.audit(interaction.guild, 'tickets', {
    title: 'Support: Person abgeholt',
    fields: [{ name: 'Person', value: `<@${res.member.id}>` }, { name: 'Von', value: `<@${interaction.user.id}>` }, { name: 'Raum', value: `<#${res.room.id}>` }],
  });
  const own = interaction.member.voice?.channelId === res.room.id;
  return replyPrivate(interaction, { embeds: [embeds.success('Abgeholt', `<@${res.member.id}> ist jetzt in <#${res.room.id}>.${own ? '' : ' Komm dazu, du sitzt gerade in keinem Support-Raum.'}`)] });
}

async function endConversation(interaction, deps) {
  await interaction.deferReply({ flags: EPHEMERAL });
  let res;
  try {
    res = await deps.services?.supportVoice.endConversation(interaction.guild, interaction.member);
  } catch (err) {
    deps.logger.warn('Gespräch beenden:', err.message);
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht möglich', 'Die Verbindung konnte nicht getrennt werden. Die Bot-Rolle braucht „Mitglieder verschieben“.')] });
  }
  if (res.error) return replyPrivate(interaction, errorReply(res.error));
  return replyPrivate(interaction, {
    embeds: [res.removed
      ? embeds.success('Gespräch beendet', `${res.removed === 1 ? 'Eine Person wurde' : `${res.removed} Personen wurden`} aus <#${res.room.id}> getrennt. Mit „Nächsten holen“ geht es weiter.`)
      : embeds.info('Raum ist leer', `In <#${res.room.id}> ist außer dem Team niemand.`)],
  });
}

module.exports = { prefix: 'supportvoice', handle };

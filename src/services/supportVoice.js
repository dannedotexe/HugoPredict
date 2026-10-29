'use strict';

const { LOG_ROUTES } = require('../config/serverLayout');
const { card } = require('../lib/ui');

/*
 * Support-Warteraum: Betritt jemand den Warteraum, erfährt das Team es in
 * #moderation (mit Ping der Supporter-Rolle) und kann die Person in einen
 * Support-Raum ziehen. Pro Person höchstens eine Meldung in fünf Minuten.
 *
 * Über das Panel in #support-steuerung öffnet und schließt das Team den
 * Warteraum. Geschlossen bleibt er sichtbar, man kann ihn aber nicht betreten.
 */

const REPEAT_MS = 5 * 60_000;

function createSupportVoiceService({ store, ctx, logger, now = Date.now }) {
  const lastNotice = new Map();

  async function onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild;
    const member = newState.member;
    if (!guild || !member || member.user?.bot) return;
    const g = store.guild(guild.id);
    const waitingId = g.channels.waitingRoom;
    if (!waitingId || newState.channelId !== waitingId || oldState.channelId === waitingId) return;
    if (!g.supportVoice.open) return;

    const key = `${guild.id}:${member.id}`;
    if (now() - (lastNotice.get(key) ?? 0) < REPEAT_MS) return;
    lastNotice.set(key, now());

    const channel = await ctx.channel(guild, LOG_ROUTES.tickets);
    if (!channel?.isTextBased()) return;
    const supportRole = ctx.roleId(guild.id, 'support');
    const rooms = ['supportRoom1', 'supportRoom2'].map((k) => g.channels[k]).filter(Boolean).map((id) => `<#${id}>`);
    const payload = card({
      icon: 'support',
      title: 'Jemand wartet auf Support',
      intro: `${supportRole ? `<@&${supportRole}> · ` : ''}<@${member.id}> wartet in <#${waitingId}>.`,
      logo: false,
      blocks: [{ body: rooms.length ? `Zieh die Person in ${rooms.join(' oder ')}.` : 'Zieh die Person in einen freien Support-Raum.' }],
      footer: null,
    });
    await channel.send({ ...payload, allowedMentions: { roles: supportRole ? [supportRole] : [] } })
      .catch((err) => logger.warn('Support-Warteraum:', err.message));
  }

  return { onVoiceStateUpdate };
}

/**
 * Setzt den Warteraum auf offen oder geschlossen (Recht „Verbinden“ für @everyone).
 * Gibt false zurück, wenn der Warteraum noch nicht eingerichtet ist.
 */
async function setSupportOpen(guild, store, open) {
  const g = store.guild(guild.id);
  const channel = g.channels.waitingRoom && (guild.channels.cache.get(g.channels.waitingRoom) ?? (await guild.channels.fetch(g.channels.waitingRoom).catch(() => null)));
  if (!channel) return false;
  await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: open }, { reason: `Support-Warteraum ${open ? 'geöffnet' : 'geschlossen'}` });
  g.supportVoice.open = open;
  store.save();
  return true;
}

module.exports = { createSupportVoiceService, setSupportOpen };

'use strict';

const { PermissionFlagsBits: P } = require('discord.js');
const { LOG_ROUTES, WAITING_ROOM_LIMIT, PRIVILEGES } = require('../config/serverLayout');
const { discordTime } = require('../lib/embeds');
const { card, upsert } = require('../lib/ui');

/*
 * Support-Warteraum: Betritt jemand den Warteraum, erfährt das Team es in
 * #moderation (mit Ping der Supporter-Rolle) und kann die Person in einen
 * Support-Raum ziehen. Pro Person höchstens eine Meldung in fünf Minuten.
 *
 * Im Chat des Warteraums steht die Warteschlange (wer zuerst kam, ist zuerst
 * dran). Sie wird bei jedem Betreten und Verlassen aktualisiert. Höchstens
 * WAITING_ROOM_LIMIT Personen passen hinein; das Team zählt mit „Mitglieder
 * verschieben“ nicht zum Limit.
 *
 * Über das Panel in #support-steuerung öffnet und schließt das Team den
 * Warteraum. Geschlossen bleibt er sichtbar, man kann ihn aber nicht betreten.
 */

const REPEAT_MS = 5 * 60_000;
const RENDER_DELAY_MS = 1500;

function createSupportVoiceService({ store, ctx, logger, now = Date.now, renderDelayMs = RENDER_DELAY_MS }) {
  const lastNotice = new Map();
  // guildId → Map(memberId → Zeitpunkt des Betretens), in Reihenfolge des Betretens
  const queues = new Map();
  const renderTimers = new Map();

  const isStaff = (member) => ctx.can(member, 'ticketStaff');
  const queueOf = (guildId) => queues.get(guildId) ?? queues.set(guildId, new Map()).get(guildId);

  function waitingChannel(guild) {
    const id = store.guild(guild.id).channels.waitingRoom;
    return id ? guild.channels.cache.get(id) ?? null : null;
  }

  /** Gleicht die Warteschlange mit den Personen im Warteraum ab (z. B. nach einem Neustart). */
  function syncQueue(guild) {
    const channel = waitingChannel(guild);
    const queue = queueOf(guild.id);
    const present = channel ? [...channel.members.values()].filter((m) => !m.user?.bot && !isStaff(m)) : [];
    for (const id of queue.keys()) if (!present.some((m) => m.id === id)) queue.delete(id);
    for (const m of present) if (!queue.has(m.id)) queue.set(m.id, now());
    return queue;
  }

  const SUPPORT_VOICE_KEYS = ['waitingRoom', 'supportRoom1', 'supportRoom2'];
  const supportVoiceIds = (guild) => SUPPORT_VOICE_KEYS.map((k) => store.guild(guild.id).channels[k]).filter(Boolean);

  /** Teammitglieder im Warteraum und in den Support-Räumen (ohne Doppelte). */
  function supportTeam(guild) {
    const seen = new Map();
    for (const id of supportVoiceIds(guild)) {
      for (const m of guild.channels.cache.get(id)?.members?.values() ?? []) if (!m.user?.bot && isStaff(m)) seen.set(m.id, m);
    }
    return [...seen.values()];
  }

  function buildQueueCard(guild) {
    const g = store.guild(guild.id);
    const queue = [...syncQueue(guild).entries()];
    const team = supportTeam(guild);
    const lines = queue.map(([id, since], i) => `**${i + 1}.** <@${id}> · wartet seit ${discordTime(new Date(since), 'R')}`);
    return card({
      icon: 'support',
      title: 'Warteschlange',
      intro: g.supportVoice.open
        ? 'Bitte warte, bis dich jemand vom Team in einen Support-Raum holt. Wer zuerst da war, ist zuerst dran.'
        : `**Der Support ist gerade geschlossen.** Erstelle gern eine Anfrage in ${g.channels.support ? `<#${g.channels.support}>` : '#support'}.`,
      logo: false,
      blocks: [
        {
          heading: `${queue.length} von ${WAITING_ROOM_LIMIT} Plätzen belegt`,
          body: lines.length ? lines.join('\n') : 'Gerade wartet niemand.',
        },
        { heading: 'Team im Support', body: team.length ? team.map((m) => `<@${m.id}>`).join(', ') : 'Gerade niemand – wir sind gleich für dich da.' },
      ],
      footer: null,
    });
  }

  /** Aktualisiert die Warteschlangen-Karte im Chat des Warteraums (gebündelt). */
  function scheduleRender(guild) {
    clearTimeout(renderTimers.get(guild.id));
    const timer = setTimeout(() => {
      renderTimers.delete(guild.id);
      render(guild).catch((err) => logger.warn('Warteschlange:', err.message));
    }, renderDelayMs);
    timer.unref?.();
    renderTimers.set(guild.id, timer);
  }

  async function render(guild) {
    const channel = waitingChannel(guild);
    if (!channel?.isTextBased?.()) return;
    const g = store.guild(guild.id);
    const ref = g.panels.queue?.channelId === channel.id ? g.panels.queue : null;
    const payload = buildQueueCard(guild);
    const msg = await upsert(channel, ref, { ...payload, allowedMentions: { parse: [] } });
    if (msg.id !== ref?.messageId) {
      g.panels.queue = { channelId: channel.id, messageId: msg.id };
      store.save();
    }
  }

  async function notifyTeam(guild, member) {
    const g = store.guild(guild.id);
    const key = `${guild.id}:${member.id}`;
    if (now() - (lastNotice.get(key) ?? 0) < REPEAT_MS) return;
    lastNotice.set(key, now());

    const channel = await ctx.channel(guild, LOG_ROUTES.tickets);
    if (!channel?.isTextBased()) return;
    const supportRole = ctx.roleId(guild.id, 'support');
    const rooms = ['supportRoom1', 'supportRoom2'].map((k) => g.channels[k]).filter(Boolean).map((id) => `<#${id}>`);
    const position = [...queueOf(guild.id).keys()].indexOf(member.id) + 1;
    const payload = card({
      icon: 'support',
      title: 'Jemand wartet auf Support',
      intro: `${supportRole ? `<@&${supportRole}> · ` : ''}<@${member.id}> wartet in <#${g.channels.waitingRoom}>${position > 0 ? ` (Platz ${position})` : ''}.`,
      logo: false,
      blocks: [{ body: rooms.length ? `Zieh die Person in ${rooms.join(' oder ')}.` : 'Zieh die Person in einen freien Support-Raum.' }],
      footer: null,
    });
    await channel.send({ ...payload, allowedMentions: { roles: supportRole ? [supportRole] : [] } })
      .catch((err) => logger.warn('Support-Warteraum:', err.message));
  }

  async function onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild;
    const member = newState.member;
    if (!guild || !member || member.user?.bot) return;
    const waitingId = store.guild(guild.id).channels.waitingRoom;
    if (!waitingId || oldState.channelId === newState.channelId) return;
    // Das Team steht nicht in der Schlange, wird aber unter „Team im Support“ angezeigt.
    if (isStaff(member)) {
      const ids = supportVoiceIds(guild);
      if (ids.includes(oldState.channelId) || ids.includes(newState.channelId)) scheduleRender(guild);
      return;
    }
    const joined = newState.channelId === waitingId;
    const left = oldState.channelId === waitingId;
    if (!joined && !left) return;

    const queue = queueOf(guild.id);
    if (left) queue.delete(member.id);
    if (joined && !queue.has(member.id)) queue.set(member.id, now());
    scheduleRender(guild);
    if (joined && store.guild(guild.id).supportVoice.open) await notifyTeam(guild, member);
  }

  /** Nach dem Start: Warteschlangen aller Server aufbauen und anzeigen. */
  function init(client) {
    for (const guild of client.guilds.cache.values()) {
      if (!waitingChannel(guild)) continue;
      // Limit und Schreibsperre auch ohne /aktualisieren sicherstellen.
      syncWaitingRoom(guild, store).catch((err) => logger.warn('Warteraum einrichten:', err.message));
      scheduleRender(guild);
    }
  }

  const refresh = (guild) => render(guild);

  const supportRoomIds = (guild) => ['supportRoom1', 'supportRoom2'].map((k) => store.guild(guild.id).channels[k]).filter(Boolean);
  const guests = (channel) => [...(channel?.members?.values() ?? [])].filter((m) => !m.user?.bot && !isStaff(m));

  /**
   * Zieht Platz 1 der Warteschlange in den Support-Raum, in dem das Teammitglied
   * sitzt – sonst in den ersten freien. Ergebnis: { member, room } oder { error }.
   */
  async function takeNext(guild, staff) {
    const rooms = supportRoomIds(guild).map((id) => guild.channels.cache.get(id)).filter(Boolean);
    if (!rooms.length) return { error: 'not_setup' };
    const own = rooms.find((r) => r.id === staff.voice?.channelId);
    const room = own ?? rooms.find((r) => guests(r).length === 0);
    if (!room) return { error: 'no_room' };
    if (guests(room).length) return { error: 'room_busy', room };

    const waiting = waitingChannel(guild);
    const nextId = [...syncQueue(guild).keys()][0];
    const member = nextId && waiting?.members.get(nextId);
    if (!member) return { error: 'empty' };

    await member.voice.setChannel(room, `Support: abgeholt von ${staff.user?.username ?? staff.id}`);
    queueOf(guild.id).delete(member.id);
    scheduleRender(guild);
    member.send(`Du bist dran: **${staff.displayName ?? staff.user?.username ?? 'Das Team'}** hilft dir jetzt in ${room.name}.`).catch(() => {});
    return { member, room };
  }

  /** Trennt alle Nicht-Teammitglieder aus dem Support-Raum des Teammitglieds. */
  async function endConversation(guild, staff) {
    const room = supportRoomIds(guild).includes(staff.voice?.channelId) ? guild.channels.cache.get(staff.voice.channelId) : null;
    if (!room) return { error: 'not_in_room' };
    const list = guests(room);
    for (const m of list) await m.voice.disconnect('Support-Gespräch beendet');
    return { removed: list.length, room };
  }

  return { onVoiceStateUpdate, init, refresh, buildQueueCard, syncQueue, takeNext, endConversation };
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

/**
 * Bringt einen bestehenden Warteraum auf den aktuellen Stand: Platzlimit und
 * Chat nur für das Team (damit die Warteschlange sichtbar bleibt).
 */
async function syncWaitingRoom(guild, store) {
  const g = store.guild(guild.id);
  const channel = g.channels.waitingRoom && guild.channels.cache.get(g.channels.waitingRoom);
  if (!channel) return;
  const reason = 'Support-Warteraum: Chat nur für das Team';
  if (channel.userLimit !== WAITING_ROOM_LIMIT) await channel.setUserLimit(WAITING_ROOM_LIMIT, 'Support-Warteraum: Platzlimit');
  // Nur ändern, was fehlt (kein Eintrag im Audit-Log bei jedem Start).
  const everyone = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
  if (!everyone?.deny.has([P.SendMessages, P.AddReactions])) {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, AddReactions: false }, { reason });
  }
  for (const key of PRIVILEGES.ticketStaff) {
    const roleId = g.roles[key];
    if (!roleId || !guild.roles.cache.has(roleId)) continue;
    if (!channel.permissionOverwrites.cache.get(roleId)?.allow.has(P.SendMessages)) {
      await channel.permissionOverwrites.edit(roleId, { SendMessages: true, AddReactions: true }, { reason });
    }
  }
}

/**
 * Trennt alle Wartenden (außer Bots und dem Team) vom Warteraum.
 * Gibt die Zahl der entfernten Personen zurück, oder null ohne Warteraum.
 */
async function emptyWaitingRoom(guild, store, isStaff) {
  const g = store.guild(guild.id);
  const channel = g.channels.waitingRoom && guild.channels.cache.get(g.channels.waitingRoom);
  if (!channel) return null;
  let removed = 0;
  for (const member of channel.members.values()) {
    if (member.user?.bot || isStaff(member)) continue;
    await member.voice.disconnect('Support-Warteraum geleert');
    removed += 1;
  }
  return removed;
}

module.exports = { createSupportVoiceService, setSupportOpen, syncWaitingRoom, emptyWaitingRoom };

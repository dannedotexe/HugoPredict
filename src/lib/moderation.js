'use strict';

const { PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const { embeds, truncate, discordTime } = require('./embeds');
const theme = require('../config/theme');

const ACTIONS = {
  warn: { label: 'Verwarnung', past: 'verwarnt', botPermission: null, color: theme.colors.warning },
  timeout: { label: 'Timeout', past: 'in den Timeout gesetzt', botPermission: P.ModerateMembers, color: theme.colors.warning },
  untimeout: { label: 'Timeout aufgehoben', past: 'aus dem Timeout entlassen', botPermission: P.ModerateMembers, color: theme.colors.neutral },
  kick: { label: 'Kick', past: 'vom Server entfernt', botPermission: P.KickMembers, color: theme.colors.danger },
  ban: { label: 'Bann', past: 'gebannt', botPermission: P.BanMembers, color: theme.colors.danger },
  unban: { label: 'Bann aufgehoben', past: 'entbannt', botPermission: P.BanMembers, color: theme.colors.neutral },
};

const TIMEOUTS = [
  { name: '10 Minuten', value: 10 * 60_000 },
  { name: '1 Stunde', value: 60 * 60_000 },
  { name: '6 Stunden', value: 6 * 60 * 60_000 },
  { name: '1 Tag', value: 24 * 60 * 60_000 },
  { name: '1 Woche', value: 7 * 24 * 60 * 60_000 },
];

const BAN_DELETE = [
  { name: 'Keine Nachrichten löschen', value: 0 },
  { name: 'Letzte Stunde', value: 3600 },
  { name: 'Letzte 24 Stunden', value: 86_400 },
  { name: 'Letzte 7 Tage', value: 604_800 },
];

const humanDuration = (ms) => TIMEOUTS.find((t) => t.value === ms)?.name ?? `${Math.round(ms / 60_000)} Minuten`;

/**
 * Prüft, ob `actor` die Aktion an `target` (GuildMember oder null) ausführen darf.
 * Gibt eine verständliche Fehlermeldung zurück oder null.
 */
function checkTarget(action, { actor, target, me, guild }) {
  const def = ACTIONS[action];
  if (def.botPermission && !me.permissions.has(def.botPermission)) {
    return `Dem Bot fehlt das Recht „${new PermissionsBitField(def.botPermission).toArray()[0]}“. Bitte bei der Bot-Rolle in den Servereinstellungen aktivieren.`;
  }
  if (!target) return ['ban', 'unban'].includes(action) ? null : 'Diese Person ist nicht auf dem Server.';
  if (target.id === actor.id) return 'Du kannst diese Aktion nicht auf dich selbst anwenden.';
  if (target.id === me.id) return 'Diese Aktion kann nicht auf den Bot angewendet werden.';
  if (target.id === guild.ownerId) return 'Der Server-Eigentümer kann nicht moderiert werden.';
  if (actor.id !== guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    return 'Diese Person hat eine gleich hohe oder höhere Rolle als du.';
  }
  if (target.roles.highest.position >= me.roles.highest.position) {
    return 'Diese Person steht in der Rollen-Reihenfolge über dem Bot.';
  }
  if (['timeout', 'untimeout'].includes(action) && target.permissions.has(P.Administrator)) {
    return 'Personen mit Administrator-Recht können keinen Timeout erhalten.';
  }
  return null;
}

/** Legt einen nummerierten Moderationsfall an und speichert ihn. */
function recordCase(store, guildId, data) {
  const m = store.guild(guildId).moderation;
  const entry = { ...data, number: ++m.counter, at: new Date().toISOString() };
  m.cases.push(entry);
  if (m.cases.length > 5000) m.cases.splice(0, m.cases.length - 5000);
  store.save();
  return entry;
}

const casesFor = (store, guildId, userId) => store.guild(guildId).moderation.cases.filter((c) => c.targetId === userId);

function caseEmbed(c) {
  const def = ACTIONS[c.action];
  const e = embeds.base(def.color).setTitle(`Fall #${c.number} · ${def.label}`).addFields(
    { name: 'Betroffen', value: `<@${c.targetId}> (${c.targetId})`, inline: true },
    { name: 'Durch', value: `<@${c.moderatorId}>`, inline: true },
  );
  if (c.durationMs) e.addFields({ name: 'Dauer', value: humanDuration(c.durationMs), inline: true });
  e.addFields({ name: 'Grund', value: truncate(c.reason, 1024), inline: false });
  if (c.dm === false) e.addFields({ name: 'Benachrichtigung', value: 'Direktnachricht nicht zustellbar', inline: false });
  return e;
}

function noticeEmbed(c, guildName) {
  const def = ACTIONS[c.action];
  const e = embeds.base(def.color).setTitle(`Hinweis vom Team von ${truncate(guildName, 100)}`)
    .setDescription(`Du wurdest **${def.past}**.`)
    .addFields({ name: 'Grund', value: truncate(c.reason, 1024), inline: false });
  if (c.durationMs) e.addFields({ name: 'Dauer', value: humanDuration(c.durationMs), inline: true });
  return e.addFields({ name: 'Fragen?', value: 'Wende dich an den Support des Servers.', inline: false });
}

function historyEmbed(user, cases) {
  const e = embeds.info(`Moderationsverlauf · ${truncate(user.username, 80)}`);
  if (!cases.length) return e.setDescription('Für diese Person liegen keine Einträge vor.');
  const lines = cases.slice(-15).reverse().map((c) =>
    `**#${c.number} ${ACTIONS[c.action].label}** · ${discordTime(c.at, 'd')} · <@${c.moderatorId}>\n${truncate(c.reason, 150)}`);
  return e.setDescription(truncate(lines.join('\n\n'), 4000))
    .addFields({ name: 'Gesamt', value: `${cases.length} Eintrag/Einträge, davon ${cases.filter((c) => c.action === 'warn').length} Verwarnung(en)`, inline: false });
}

module.exports = { ACTIONS, TIMEOUTS, BAN_DELETE, checkTarget, recordCase, casesFor, caseEmbed, noticeEmbed, historyEmbed, humanDuration };

'use strict';

const { allMembers } = require('../lib/members');

const { MessageFlags } = require('discord.js');
const theme = require('../config/theme');
const { embeds, discordTime } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { emojis } = require('../lib/emojis');
const { card } = require('../lib/ui');
const { desiredNickname } = require('../services/staffNames');

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/;
// Ping-Rollen, die jede Person standardmäßig bekommt
const DEFAULT_PINGS = ['notifyMarkets', 'notifyNews'];

// --- Verknüpfung per /msg-Code (wie die Anmeldung auf der Website) --------
// Discord zeigt „/msg HugoPredict KE2KM“, der Spieler schickt das im Spiel ab. Der Bot erkennt
// den Absender an der Server-Zeile „[Nachricht] Name -> Du: …“ und verknüpft genau dieses Konto.

// Offene Antworten pro Discord-ID, damit sie nach der Verknüpfung aktualisiert werden (Token gilt 15 min).
const pendingReplies = new Map();

async function startCodeLink(interaction, deps) {
  if (deps.ctx.hasRoleKey(interaction.member, 'verified')) {
    return replyPrivate(interaction, { embeds: [embeds.info('Bereits verknüpft', 'Dein Konto ist bereits verknüpft.')] });
  }
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: EPHEMERAL });
  const avatar = interaction.user.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null;
  const { code, expiresAt } = deps.minecraft.startDiscordLink(interaction.user.id, interaction.user.username, avatar);
  const bot = deps.minecraft.info?.().username ?? 'HugoPredict';
  pendingReplies.set(interaction.user.id, { interaction, at: Date.now() });
  const online = deps.minecraft.state?.online !== false;
  return replyPrivate(interaction, card({
    icon: 'link',
    title: 'Konto verknüpfen',
    intro: 'Geh auf **HugoSMP** online und schick diesen Befehl im Chat ab:',
    logo: false,
    blocks: [
      { heading: 'Dein Befehl', text: `\`\`\`
/msg ${bot} ${code}
\`\`\`
Gültig bis ${discordTime(expiresAt, 't')}. Danach wird dein Konto automatisch verknüpft – diese Nachricht aktualisiert sich.` },
      ...(online ? [] : [{ heading: 'Hinweis', icon: 'warning', body: 'Der Bot ist gerade nicht auf HugoSMP. Die Verknüpfung klappt, sobald er wieder da ist.' }]),
      { heading: 'Sicherheit', icon: 'lock', body: 'Schick nur einen Befehl ab, den du hier selbst siehst. Wer dir einen fertigen Befehl gibt, verknüpft sonst sein Discord mit deinem Minecraft-Konto.' },
    ],
    ephemeral: true,
  }));
}

/**
 * Nach dem /msg im Spiel: Rollen und Namen auf allen Servern vergeben, auf denen die Person ist,
 * und die offene Antwort aktualisieren. Wird vom Minecraft-Bot aufgerufen.
 */
async function completeFromGame({ discordId, player, synced }, deps, client) {
  let nickNote = '';
  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;
    const res = await applyVerified(guild, member, player.username, deps);
    if (res.nickNote) nickNote = res.nickNote;
  }
  const pending = pendingReplies.get(discordId);
  pendingReplies.delete(discordId);
  if (pending && Date.now() - pending.at < 14 * 60_000) {
    const note = synced === false ? '\n-# Die Website wird automatisch informiert, sobald sie verbunden ist.' : '';
    const done = card({
      icon: 'verified',
      title: 'Konto verknüpft',
      intro: `Dein Konto **${player.username}** ist verknüpft. Kontoabfragen wie \`/balance\` stehen dir jetzt zur Verfügung.${nickNote}${note}`,
      accent: theme.colors.success,
      logo: false,
    });
    await pending.interaction.editReply({ ...done, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }
}

/** Karte im Team-Channel #verifizierungen (ohne Channel: Eintrag im Prüfprotokoll). */
async function announceVerification(guild, member, minecraftName, deps) {
  const userId = member.id ?? member.user?.id;
  const channel = await deps.ctx.channel?.(guild, 'verifyLog').catch(() => null);
  if (!channel?.isTextBased?.()) {
    await deps.ctx.audit(guild, 'audit', {
      title: 'Konto verknüpft',
      fields: [{ name: 'Discord', value: `<@${userId}> (${userId})` }, { name: 'Minecraft', value: minecraftName ?? '—' }],
    });
    return;
  }
  const created = member.user?.createdAt instanceof Date ? member.user.createdAt : null;
  const young = created && Date.now() - created.getTime() < 7 * 86400e3;
  const payload = card({
    eyebrow: `${emojis.icon('verified')}Neu verifiziert`,
    title: minecraftName ?? 'Unbekannt',
    intro: `<@${userId}> hat sein Konto verknüpft.`,
    accent: young ? theme.colors.warning : theme.colors.success,
    thumbnailUrl: minecraftName ? `https://mc-heads.net/avatar/${encodeURIComponent(minecraftName)}/128` : undefined,
    blocks: [{
      text: [
        `**Discord:** ${member.user?.username ?? '—'} · \`${userId}\``,
        `**Minecraft:** ${minecraftName ?? '—'}`,
        created ? `**Discord-Konto erstellt:** ${discordTime(created, 'R')}${young ? ' ⚠️ sehr neu' : ''}` : null,
        `**Verifiziert:** ${discordTime(new Date(), 'f')}`,
      ].filter(Boolean).join('\n'),
    }],
    footer: null,
  });
  await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch((err) => deps.logger.warn('Verifizierungs-Karte:', err.message));
}

/** Vergibt Verifiziert (und ggf. Mitglied) und setzt den Minecraft-Namen. Ergebnis: { ok, nickNote }. */
async function applyVerified(guild, member, minecraftName, deps) {
  const userId = member.id ?? member.user?.id;
  // Verifiziert (+ Mitglied, falls es beim Beitritt nicht geklappt hat). Pings gibt es schon beim Beitritt.
  const roleIds = ['member', 'verified'].map((k) => deps.ctx.roleId(guild.id, k)).filter(Boolean);
  const toAdd = roleIds.filter((id) => !member.roles.cache.has(id));
  try {
    if (toAdd.length) await member.roles.add(toAdd, 'Konto verknüpft');
  } catch (err) {
    deps.logger.warn('Rolle Verifiziert konnte nicht vergeben werden:', err.message);
    await deps.ctx.audit(guild, 'system', { title: 'Rolle nicht vergeben', description: `Verifiziert für <@${userId}>: ${err.message}` });
    return { ok: false };
  }
  // Server-Name = Minecraft-Name (bei Teamrollen mit Zusatz, z. B. „Supporter | Steve“).
  // Klappt nicht bei Personen über der Bot-Rolle (z. B. Server-Eigentümer)
  // oder ohne das Recht „Nicknames verwalten“.
  let nickNote = '';
  const nick = minecraftName && desiredNickname(member, deps.ctx, minecraftName);
  if (nick && member.nickname !== nick) {
    try {
      await member.setNickname(nick, 'Minecraft-Name aus der Kontoverknüpfung');
      nickNote = `\nDein Name auf diesem Server ist jetzt **${nick}**.`;
    } catch (err) {
      deps.logger.warn('Nickname nicht gesetzt:', err.message);
    }
  }
  await announceVerification(guild, member, minecraftName, deps);
  return { ok: true, nickNote };
}

async function handle(interaction, deps, [action]) {
  if (!interaction.inGuild()) return;
  if (action === 'start' && interaction.isButton()) {
    if (!deps.checkRate(interaction, 'verify')) return;
    if (!deps.minecraft) return replyPrivate(interaction, { embeds: [embeds.error('Gerade nicht möglich', 'Die Verknüpfung ist gerade nicht verfügbar. Bitte versuche es später erneut.')] });
    return startCodeLink(interaction, deps);
  }
  // Buttons aus alten Nachrichten (früherer Ablauf mit Namenseingabe)
  return replyPrivate(interaction, { embeds: [embeds.info('Neuer Ablauf', 'Starte die Verknüpfung bitte in #verifizieren mit „Verknüpfen“.')] });
}

/**
 * Einmalig: allen bisherigen Mitgliedern die Ping-Rollen geben (danach nie wieder,
 * damit niemand sie nach dem Abwählen zurückbekommt). Braucht den Members Intent.
 */
async function backfillDefaultPings(guild, deps) {
  const g = deps.store.guild(guild.id);
  if (g.defaultPingsApplied) return null;
  const memberRole = deps.ctx.roleId(guild.id, 'member');
  const pingIds = DEFAULT_PINGS.map((k) => deps.ctx.roleId(guild.id, k)).filter(Boolean);
  if (!memberRole || !pingIds.length) return null;
  const members = await allMembers(guild);
  let changed = 0;
  for (const m of members.values()) {
    if (m.user.bot || !m.roles.cache.has(memberRole)) continue;
    const missing = pingIds.filter((id) => !m.roles.cache.has(id));
    if (!missing.length) continue;
    try {
      await m.roles.add(missing, 'Standard: alle Pings (abwählbar in #pings)');
      changed += 1;
    } catch (err) {
      deps.logger.warn('Ping-Rollen:', err.message);
    }
  }
  g.defaultPingsApplied = true;
  deps.store.save();
  return changed;
}

module.exports = { prefix: 'verify', backfillDefaultPings, handle, startCodeLink, completeFromGame, applyVerified, MC_NAME };

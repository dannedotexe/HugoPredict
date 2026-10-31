'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const theme = require('../config/theme');
const { embeds, discordTime, formatRetry } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { ApiError } = require('../lib/hugoApi');
const { withEmoji } = require('../lib/emojis');
const { card } = require('../lib/ui');
const { CODE_LENGTH } = require('../minecraft/linkCodes');
const { desiredNickname } = require('../services/staffNames');

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/;

function nameModal() {
  return new ModalBuilder().setCustomId('hm:verify:modal').setTitle('Konto verknüpfen').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('name').setLabel('Minecraft-Name').setStyle(TextInputStyle.Short)
        .setMinLength(3).setMaxLength(16).setRequired(true),
    ),
  );
}

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
  const { code, expiresAt } = deps.minecraft.startDiscordLink(interaction.user.id, interaction.user.username);
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

async function startVerification(interaction, rawName, deps) {
  if (deps.minecraft) return startCodeLink(interaction, deps);
  const name = String(rawName ?? '').trim();
  if (!MC_NAME.test(name)) {
    return replyPrivate(interaction, { embeds: [embeds.error('Ungültiger Name', 'Minecraft-Namen bestehen aus 3–16 Zeichen (Buchstaben, Ziffern, Unterstrich).')] });
  }
  if (deps.ctx.hasRoleKey(interaction.member, 'verified')) {
    return replyPrivate(interaction, { embeds: [embeds.info('Bereits verknüpft', 'Dein Konto ist bereits verknüpft.')] });
  }
  if (deps.minecraft) return startCodeLink(interaction, deps);
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const res = await deps.api.startVerification({
      discordId: interaction.user.id,
      discordUsername: interaction.user.username,
      minecraftName: name,
    });
    const buttons = [withEmoji(new ButtonBuilder().setCustomId('hm:verify:check').setStyle(ButtonStyle.Success).setLabel('Status prüfen'), 'verified')];
    if (res.verifyUrl) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Auf der Website bestätigen').setURL(res.verifyUrl), 'external'));
    const payload = card({
      icon: 'link',
      title: 'Konto verknüpfen',
      intro: res.instructions ?? 'Bestätige den folgenden Code wie auf der Website beschrieben und wähle anschließend „Status prüfen“.',
      logo: false,
      blocks: [
        { heading: 'Dein Code', body: `# \`${res.code.slice(0, 64)}\`\nMinecraft-Name: **${name}**${res.expiresAt ? `\nGültig bis ${discordTime(res.expiresAt, 'R')}` : ''}`, quote: false },
        { heading: 'Sicherheit', icon: 'lock', body: 'Gib diesen Code nicht an andere Personen weiter.' },
      ],
      actions: [new ActionRowBuilder().addComponents(buttons)],
      ephemeral: true,
    });
    return replyPrivate(interaction, payload);
  } catch (err) {
    return replyApiError(interaction, err, { ...deps, action: 'Verifizierung starten' });
  }
}

async function checkVerification(interaction, deps) {
  await interaction.deferReply({ flags: EPHEMERAL });
  let status;
  try {
    status = await deps.api.getVerificationStatus(interaction.user.id);
  } catch (err) {
    return replyApiError(interaction, err, { ...deps, action: 'Verifizierung prüfen' });
  }
  if (!status.verified) {
    return replyPrivate(interaction, {
      embeds: [embeds.warning('Noch nicht bestätigt', status.pending
        ? 'Die Bestätigung steht noch aus. Folge den Anweisungen und prüfe den Status danach erneut.'
        : 'Es läuft keine Kontoverknüpfung. Starte sie mit `/verify` oder über „Konto verknüpfen“ bei den Regeln.')],
    });
  }

  // Rolle erst nach bestätigter Verifizierung durch die Website vergeben.
  return grantVerified(interaction, status.minecraftName, deps);
}

/** Vergibt Mitglied + Verifiziert und setzt den Minecraft-Namen. Ergebnis: { ok, nickNote }. */
async function applyVerified(guild, member, minecraftName, deps) {
  const userId = member.id ?? member.user?.id;
  // Nur Mitglied und Verifiziert – Benachrichtigungen wählt jede Person selbst in #pings.
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
  await deps.ctx.audit(guild, 'audit', {
    title: 'Konto verknüpft',
    fields: [
      { name: 'Discord', value: `<@${userId}> (${userId})` },
      { name: 'Minecraft', value: minecraftName ?? '—' },
    ],
  });
  return { ok: true, nickNote };
}

/** Wie applyVerified, antwortet aber auf die Interaktion. Antwort muss bereits zurückgestellt sein. */
async function grantVerified(interaction, minecraftName, deps, { note = '' } = {}) {
  const { ok, nickNote } = await applyVerified(interaction.guild, interaction.member, minecraftName, deps);
  if (!ok) return replyPrivate(interaction, { embeds: [embeds.error('Rolle nicht vergeben', 'Deine Verknüpfung ist gültig, die Rolle konnte jedoch nicht vergeben werden. Das Team wurde informiert.')] });
  return replyPrivate(interaction, { embeds: [embeds.success('Konto verknüpft', `Dein Konto${minecraftName ? ` **${minecraftName}**` : ''} ist verknüpft. Kontoabfragen wie \`/balance\` stehen dir jetzt zur Verfügung.${nickNote}${note}`)] });
}

// --- Verknüpfung über den Minecraft-Bot ---------------------------------

const LINK_ERRORS = {
  offline_bot: ['Gerade nicht möglich', 'Der HugoPredict-Bot ist gerade nicht auf HugoSMP. Bitte versuche es in ein paar Minuten erneut.'],
  not_online: ['Nicht online', 'Du musst gerade auf **HugoSMP** online sein. Achte darauf, deinen Namen genau wie im Spiel zu schreiben.'],
  taken: ['Bereits verknüpft', 'Dieses Minecraft-Konto ist schon mit einem anderen Discord-Konto verknüpft. Wende dich bitte an den Support.'],
  missing: ['Kein Code aktiv', 'Starte die Verknüpfung erneut über „Konto verknüpfen“.'],
  expired: ['Code abgelaufen', 'Der Code ist nicht mehr gültig. Starte die Verknüpfung erneut.'],
  locked: ['Zu viele Fehlversuche', 'Der Code wurde gesperrt. Starte die Verknüpfung erneut.'],
};
const linkError = (key, extra = '') => ({ embeds: [embeds.error(LINK_ERRORS[key][0], LINK_ERRORS[key][1] + extra)] });

function codeModal() {
  return new ModalBuilder().setCustomId('hm:verify:codemodal').setTitle('Code eingeben').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('code').setLabel('Code aus dem Spiel').setStyle(TextInputStyle.Short)
        .setMinLength(CODE_LENGTH).setMaxLength(CODE_LENGTH).setRequired(true),
    ),
  );
}

async function startMinecraftLink(interaction, name, deps) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const res = await deps.minecraft.sendLinkCode(interaction.user.id, name);
  if (res.error === 'cooldown') {
    return replyPrivate(interaction, { embeds: [embeds.warning('Code bereits unterwegs', `Ein neuer Code ist in ${formatRetry(res.retryAfterMs)} möglich. Gib den letzten Code über „Code eingeben“ ein.`)], components: [codeButtonRow()] });
  }
  if (res.error) return replyPrivate(interaction, linkError(res.error));
  return replyPrivate(interaction, card({
    icon: 'link',
    title: 'Code im Spiel',
    intro: `Der Bot hat dir auf **HugoSMP** eine private Nachricht mit einem Code geschickt, **${res.player.username}**. Gib ihn hier ein.`,
    logo: false,
    blocks: [
      { heading: 'So geht es', body: 'Schau in deinen Minecraft-Chat,\nwähle „Code eingeben“,\ngib den 6-stelligen Code ein.' },
      { heading: 'Sicherheit', icon: 'lock', body: 'Der Code ist 10 Minuten gültig. Gib ihn niemals an andere weiter.' },
    ],
    actions: [codeButtonRow()],
    ephemeral: true,
  }));
}

const codeButtonRow = () => new ActionRowBuilder().addComponents(
  withEmoji(new ButtonBuilder().setCustomId('hm:verify:code').setStyle(ButtonStyle.Success).setLabel('Code eingeben'), 'verified'),
);

async function confirmMinecraftCode(interaction, code, deps) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const res = deps.minecraft.confirmLinkCode(interaction.user.id, code);
  if (res.error === 'wrong') return replyPrivate(interaction, { embeds: [embeds.error('Falscher Code', `Bitte prüfe den Code. Noch ${res.attemptsLeft} Versuch(e).`)], components: [codeButtonRow()] });
  if (res.error) return replyPrivate(interaction, linkError(res.error));
  let synced;
  try {
    ({ synced } = await deps.minecraft.saveLink({ discordId: interaction.user.id, discordUsername: interaction.user.username, player: res.player }));
  } catch (err) {
    deps.minecraft.forgetLink(interaction.user.id);
    return replyApiError(interaction, err, { ...deps, action: 'Konto verknüpfen' });
  }
  return grantVerified(interaction, res.player.username, deps, {
    note: synced ? '' : '\n-# Die Website wird automatisch informiert, sobald sie verbunden ist.',
  });
}

async function handle(interaction, deps, [action]) {
  if (!interaction.inGuild()) return;
  if (action === 'start' && interaction.isButton()) {
    if (!deps.checkRate(interaction, 'verify')) return;
    if (!deps.minecraft && !deps.api.configured) return replyApiError(interaction, new ApiError('not_configured', 'API nicht konfiguriert'), deps);
    if (deps.minecraft) return startCodeLink(interaction, deps);
    return interaction.showModal(nameModal());
  }
  if (action === 'code' && interaction.isButton() && deps.minecraft) {
    if (!deps.checkRate(interaction, 'verifyCheck')) return;
    return interaction.showModal(codeModal());
  }
  if (action === 'codemodal' && interaction.isModalSubmit() && deps.minecraft) {
    return confirmMinecraftCode(interaction, interaction.fields.getTextInputValue('code'), deps);
  }
  if (action === 'modal' && interaction.isModalSubmit()) {
    return startVerification(interaction, interaction.fields.getTextInputValue('name'), deps);
  }
  if (action === 'check' && interaction.isButton()) {
    if (!deps.checkRate(interaction, 'verifyCheck')) return;
    return checkVerification(interaction, deps);
  }
}

module.exports = { prefix: 'verify', handle, startVerification, checkVerification, confirmMinecraftCode, completeFromGame, applyVerified, MC_NAME };

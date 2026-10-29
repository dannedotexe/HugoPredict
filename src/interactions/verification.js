'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, discordTime } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { ApiError } = require('../lib/hugoApi');
const { withEmoji } = require('../lib/emojis');
const { card } = require('../lib/ui');

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/;

function nameModal() {
  return new ModalBuilder().setCustomId('hm:verify:modal').setTitle('Konto verknüpfen').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('name').setLabel('Minecraft-Name').setStyle(TextInputStyle.Short)
        .setMinLength(3).setMaxLength(16).setRequired(true),
    ),
  );
}

async function startVerification(interaction, rawName, deps) {
  const name = String(rawName ?? '').trim();
  if (!MC_NAME.test(name)) {
    return replyPrivate(interaction, { embeds: [embeds.error('Ungültiger Name', 'Minecraft-Namen bestehen aus 3–16 Zeichen (Buchstaben, Ziffern, Unterstrich).')] });
  }
  if (deps.ctx.hasRoleKey(interaction.member, 'verified')) {
    return replyPrivate(interaction, { embeds: [embeds.info('Bereits verknüpft', 'Dein Konto ist bereits verknüpft.')] });
  }
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
  const member = interaction.member;
  // Nur Mitglied und Verifiziert – Benachrichtigungen wählt jede Person selbst in #pings.
  const roleIds = ['member', 'verified'].map((k) => deps.ctx.roleId(interaction.guild.id, k)).filter(Boolean);
  const toAdd = roleIds.filter((id) => !member.roles.cache.has(id));
  try {
    if (toAdd.length) await member.roles.add(toAdd, 'Konto über die Website verknüpft');
  } catch (err) {
    deps.logger.warn('Rolle Verifiziert konnte nicht vergeben werden:', err.message);
    await deps.ctx.audit(interaction.guild, 'system', { title: 'Rolle nicht vergeben', description: `Verifiziert für <@${interaction.user.id}>: ${err.message}` });
    return replyPrivate(interaction, { embeds: [embeds.error('Rolle nicht vergeben', 'Deine Verknüpfung ist gültig, die Rolle konnte jedoch nicht vergeben werden. Das Team wurde informiert.')] });
  }
  // Server-Name = Minecraft-Name. Klappt nicht bei Personen über der Bot-Rolle
  // (z. B. Server-Eigentümer) oder ohne das Recht „Nicknames verwalten“.
  let nickNote = '';
  if (status.minecraftName && member.nickname !== status.minecraftName) {
    try {
      await member.setNickname(status.minecraftName, 'Minecraft-Name aus der Kontoverknüpfung');
      nickNote = `\nDein Name auf diesem Server ist jetzt **${status.minecraftName}**.`;
    } catch (err) {
      deps.logger.warn('Nickname nicht gesetzt:', err.message);
    }
  }
  await deps.ctx.audit(interaction.guild, 'audit', {
    title: 'Konto verknüpft',
    fields: [
      { name: 'Discord', value: `<@${interaction.user.id}> (${interaction.user.id})` },
      { name: 'Minecraft', value: status.minecraftName ?? '—' },
    ],
  });
  return replyPrivate(interaction, { embeds: [embeds.success('Konto verknüpft', `Dein Konto${status.minecraftName ? ` **${status.minecraftName}**` : ''} ist verknüpft. Kontoabfragen wie \`/balance\` stehen dir jetzt zur Verfügung.${nickNote}`)] });
}

async function handle(interaction, deps, [action]) {
  if (!interaction.inGuild()) return;
  if (action === 'start' && interaction.isButton()) {
    if (!deps.checkRate(interaction, 'verify')) return;
    if (!deps.api.configured) return replyApiError(interaction, new ApiError('not_configured', 'API nicht konfiguriert'), deps);
    return interaction.showModal(nameModal());
  }
  if (action === 'modal' && interaction.isModalSubmit()) {
    return startVerification(interaction, interaction.fields.getTextInputValue('name'), deps);
  }
  if (action === 'check' && interaction.isButton()) {
    if (!deps.checkRate(interaction, 'verifyCheck')) return;
    return checkVerification(interaction, deps);
  }
}

module.exports = { prefix: 'verify', handle, startVerification, checkVerification, MC_NAME };

'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, discordTime } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { SELF_ASSIGNABLE_VIA_BOT } = require('../config/serverLayout');
const { ApiError } = require('../lib/hugoApi');

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/;

function nameModal() {
  return new ModalBuilder().setCustomId('hm:verify:modal').setTitle('Minecraft-Account verknüpfen').addComponents(
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
    return replyPrivate(interaction, { embeds: [embeds.info('Bereits verifiziert', 'Dein Account ist bereits verknüpft.')] });
  }
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const res = await deps.api.startVerification({
      discordId: interaction.user.id,
      discordUsername: interaction.user.username,
      minecraftName: name,
    });
    const e = embeds.brand().setTitle('Verifizierung gestartet').setDescription(
      res.instructions ?? 'Bestätige den folgenden Code wie auf der Website beschrieben und klicke danach auf „Status prüfen“.',
    ).addFields(
      { name: 'Minecraft-Name', value: name, inline: true },
      { name: 'Code', value: `\`${res.code.slice(0, 64)}\``, inline: true },
    );
    if (res.expiresAt) e.addFields({ name: 'Gültig bis', value: discordTime(res.expiresAt, 'R'), inline: true });
    e.addFields({ name: 'Sicherheit', value: 'Gib diesen Code niemals an andere Personen weiter.', inline: false });
    const buttons = [new ButtonBuilder().setCustomId('hm:verify:check').setStyle(ButtonStyle.Success).setLabel('Status prüfen')];
    if (res.verifyUrl) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Auf der Website bestätigen').setURL(res.verifyUrl));
    return replyPrivate(interaction, { embeds: [e], components: [new ActionRowBuilder().addComponents(buttons)] });
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
      embeds: [embeds.warning('Noch nicht verifiziert', status.pending
        ? 'Die Bestätigung steht noch aus. Folge den Anweisungen und prüfe den Status danach erneut.'
        : 'Es läuft keine Verifizierung. Starte sie mit `/verify` oder über den Button im Verifizierungs-Channel.')],
    });
  }

  // Rolle erst nach bestätigter Verifizierung durch die Website vergeben.
  const member = interaction.member;
  const roleIds = SELF_ASSIGNABLE_VIA_BOT.map((k) => deps.ctx.roleId(interaction.guild.id, k)).filter(Boolean);
  const toAdd = roleIds.filter((id) => !member.roles.cache.has(id));
  try {
    if (toAdd.length) await member.roles.add(toAdd, 'Minecraft-Account über die Website verifiziert');
  } catch (err) {
    deps.logger.warn('Verified-Rolle konnte nicht vergeben werden:', err.message);
    return replyPrivate(interaction, { embeds: [embeds.error('Rolle konnte nicht vergeben werden', 'Deine Verifizierung ist gültig, aber der Bot konnte die Rolle nicht vergeben. Das Team wurde informiert.')] });
  }
  await deps.ctx.audit(interaction.guild, 'securityLogs', {
    title: 'Account verifiziert',
    fields: [
      { name: 'Discord', value: `<@${interaction.user.id}> (${interaction.user.id})` },
      { name: 'Minecraft', value: status.minecraftName ?? '—' },
    ],
  });
  return replyPrivate(interaction, { embeds: [embeds.success('Verifizierung erfolgreich', `Dein Account${status.minecraftName ? ` **${status.minecraftName}**` : ''} ist verknüpft. Du hast jetzt Zugriff auf die Trading-Bereiche.`)] });
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

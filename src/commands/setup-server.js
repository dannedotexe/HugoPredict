'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { embeds, truncate } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { planSetup, runSetup } = require('../setup/setupServer');

const list = (items, max = 15) =>
  items.length ? truncate(items.slice(0, max).join('\n') + (items.length > max ? `\n… und ${items.length - max} weitere` : ''), 1024) : '—';

function resultEmbed(result) {
  const color = result.errors.length ? 'warning' : 'success';
  const e = embeds[color](result.errors.length ? 'Setup mit Fehlern abgeschlossen' : 'Setup abgeschlossen',
    `Erstellt: **${result.created.length}** · Aktualisiert: **${result.updated.length}** · Unverändert: **${result.existing.length}**`);
  e.addFields(
    { name: 'Neu erstellt', value: list(result.created), inline: false },
    { name: 'Aktualisiert', value: list(result.updated), inline: false },
  );
  if (result.warnings.length) e.addFields({ name: 'Hinweise', value: list(result.warnings, 8), inline: false });
  if (result.errors.length) e.addFields({ name: 'Fehler', value: list(result.errors, 8), inline: false });
  e.addFields({ name: 'Nächster Schritt', value: 'Führe `/setup-panels` aus, um Willkommens-, Regel-, Ticket- und Verifizierungs-Panels zu veröffentlichen.', inline: false });
  return e;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Richtet Rollen, Kategorien, Channels und Berechtigungen ein')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((o) => o.setName('berechtigungen_synchronisieren')
      .setDescription('Auch bestehende Channels/Rollen auf das Standard-Layout zurücksetzen (Standard: nein)')),
  privilege: 'setup',
  rateLimit: 'setup',
  async execute(interaction, deps) {
    const sync = interaction.options.getBoolean('berechtigungen_synchronisieren') ?? false;
    const plan = planSetup(interaction.guild, deps.store);

    if (plan.missingPermissions.length) {
      return replyPrivate(interaction, {
        embeds: [embeds.error('Fehlende Bot-Berechtigungen', `Dem Bot fehlen folgende Rechte:\n\`${plan.missingPermissions.join('`, `')}\`\n\nErgänze sie in den Servereinstellungen bei der Bot-Rolle und versuche es erneut.`)],
      });
    }

    const preview = embeds.warning('Setup bestätigen', [
      `**Rollen:** ${plan.rolesNew.length} neu, ${plan.rolesExisting.length} vorhanden`,
      `**Kategorien:** ${plan.categoriesNew.length} neu, ${plan.categoriesExisting.length} vorhanden`,
      `**Channels:** ${plan.channelsNew.length} neu, ${plan.channelsExisting.length} vorhanden`,
      '',
      sync ? '**Achtung:** Bestehende Rollen und Channels werden auf das Standard-Layout zurückgesetzt. Manuell geänderte Berechtigungen gehen dabei verloren.'
        : 'Vorhandene Rollen und Channels werden erkannt und nicht verändert oder dupliziert.',
      'Nichts wird gelöscht.',
    ].join('\n'));
    if (plan.channelsNew.length) preview.addFields({ name: 'Neue Channels (Auszug)', value: list(plan.channelsNew, 10), inline: false });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm').setLabel('Setup starten').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
    );
    const response = await interaction.reply({ embeds: [preview], components: [row], flags: EPHEMERAL, withResponse: true });

    let click;
    try {
      click = await response.resource.message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 60_000,
      });
    } catch {
      return interaction.editReply({ embeds: [embeds.info('Setup abgebrochen', 'Keine Bestätigung innerhalb von 60 Sekunden.')], components: [] });
    }
    if (click.customId === 'cancel') {
      return click.update({ embeds: [embeds.info('Setup abgebrochen', 'Es wurden keine Änderungen vorgenommen.')], components: [] });
    }

    await click.update({ embeds: [embeds.info('Setup läuft …', 'Das kann ein bis zwei Minuten dauern.')], components: [] });
    const { locked, value: result } = await deps.locks.run(`setup:${interaction.guild.id}`, () =>
      runSetup(interaction.guild, deps.store, { syncPermissions: sync, logger: deps.logger }));
    if (locked) return interaction.editReply({ embeds: [embeds.warning('Setup läuft bereits', 'Bitte warte, bis das laufende Setup abgeschlossen ist.')] });

    await deps.ctx.audit(interaction.guild, 'modLogs', {
      title: 'Server-Setup ausgeführt',
      fields: [
        { name: 'Ausgeführt von', value: `<@${interaction.user.id}>` },
        { name: 'Synchronisierung', value: sync ? 'Ja' : 'Nein' },
        { name: 'Ergebnis', value: `${result.created.length} erstellt, ${result.updated.length} aktualisiert, ${result.errors.length} Fehler` },
      ],
    });
    return interaction.editReply({ embeds: [resultEmbed(result)] });
  },
  resultEmbed,
};

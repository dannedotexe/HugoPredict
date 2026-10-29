'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { embeds, truncate } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { planSetup, runSetup } = require('../setup/setupServer');

const list = (items, max = 12) =>
  items.length ? truncate(items.slice(0, max).join('\n') + (items.length > max ? `\n… und ${items.length - max} weitere` : ''), 1024) : '—';

function previewEmbed(plan, { sync, archive }) {
  const renames = [...plan.categoriesRenamed, ...plan.channelsMigrated, ...plan.rolesRenamed];
  const e = embeds.warning('Einrichtung bestätigen', [
    `**Neu:** ${plan.rolesNew} Rollen · ${plan.categoriesNew} Kategorien · ${plan.channelsNew.length} Channels`,
    `**Migration:** ${renames.length} Umbenennungen bzw. Verschiebungen`,
    `**Unverändert:** ${plan.unchanged}`,
    '',
    'Migrierte Channels behalten ihren Nachrichtenverlauf und erhalten die neuen Berechtigungen.',
    sync ? 'Bestehende Elemente werden zusätzlich auf das Standard-Layout zurückgesetzt.' : null,
    archive
      ? `**Archiv:** ${plan.obsoleteChannels} veraltete Channels werden in die versteckte Kategorie „ARCHIV“ verschoben. Gelöscht wird nichts.`
      : 'Es wird nichts gelöscht. Veraltete Elemente werden nur aufgelistet.',
  ].filter((l) => l !== null).join('\n'));
  if (renames.length) e.addFields({ name: 'Migration', value: list(renames), inline: false });
  if (plan.channelsNew.length) e.addFields({ name: 'Neue Channels', value: list(plan.channelsNew), inline: false });
  if (plan.obsolete.length) e.addFields({ name: `Veraltet (${plan.obsolete.length})`, value: list(plan.obsolete), inline: false });
  return e;
}

function resultEmbed(result) {
  const failed = result.errors.length > 0;
  const e = embeds[failed ? 'warning' : 'success'](failed ? 'Einrichtung mit Fehlern abgeschlossen' : 'Einrichtung abgeschlossen',
    `Erstellt: **${result.created.length}** · Aktualisiert: **${result.updated.length}** · Unverändert: **${result.existing.length}**${result.archived.length ? ` · Archiviert: **${result.archived.length}**` : ''}`);
  if (result.created.length) e.addFields({ name: 'Erstellt', value: list(result.created), inline: false });
  if (result.updated.length) e.addFields({ name: 'Aktualisiert', value: list(result.updated), inline: false });
  if (result.archived.length) e.addFields({ name: 'Archiviert', value: list(result.archived), inline: false });
  if (result.obsolete.length) {
    e.addFields({ name: 'Veraltet (nicht verändert)', value: list(result.obsolete), inline: false });
  }
  if (result.warnings.length) e.addFields({ name: 'Hinweise', value: list(result.warnings, 8), inline: false });
  if (result.errors.length) e.addFields({ name: 'Fehler', value: list(result.errors, 8), inline: false });
  e.addFields({ name: 'Nächster Schritt', value: '`/setup-panels` veröffentlicht Dokumentation, Kundenservice-Panel und Systemstatus.', inline: false });
  return e;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Richtet Rollen, Kategorien, Channels und Berechtigungen ein bzw. migriert die Struktur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((o) => o.setName('veraltete_archivieren')
      .setDescription('Veraltete Channels in die versteckte Kategorie „ARCHIV“ verschieben (Standard: nein)'))
    .addBooleanOption((o) => o.setName('berechtigungen_synchronisieren')
      .setDescription('Auch unveränderte Channels und Rollen auf das Standard-Layout zurücksetzen (Standard: nein)')),
  privilege: 'setup',
  rateLimit: 'setup',
  async execute(interaction, deps) {
    const sync = interaction.options.getBoolean('berechtigungen_synchronisieren') ?? false;
    const archive = interaction.options.getBoolean('veraltete_archivieren') ?? false;
    await interaction.guild.channels.fetch();
    await interaction.guild.roles.fetch();
    const plan = planSetup(interaction.guild, deps.store);

    if (plan.missingPermissions.length) {
      return replyPrivate(interaction, {
        embeds: [embeds.error('Fehlende Bot-Berechtigungen', `Dem Bot fehlen folgende Rechte:\n\`${plan.missingPermissions.join('`, `')}\`\n\nBitte ergänze sie bei der Bot-Rolle in den Servereinstellungen und versuche es erneut.`)],
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm').setLabel('Einrichtung starten').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
    );
    const response = await interaction.reply({ embeds: [previewEmbed(plan, { sync, archive })], components: [row], flags: EPHEMERAL, withResponse: true });

    let click;
    try {
      click = await response.resource.message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 120_000,
      });
    } catch {
      return interaction.editReply({ embeds: [embeds.info('Einrichtung abgebrochen', 'Keine Bestätigung innerhalb von zwei Minuten.')], components: [] });
    }
    if (click.customId === 'cancel') {
      return click.update({ embeds: [embeds.info('Einrichtung abgebrochen', 'Es wurden keine Änderungen vorgenommen.')], components: [] });
    }

    await click.update({ embeds: [embeds.info('Einrichtung läuft …', 'Das kann ein bis zwei Minuten dauern.')], components: [] });
    const { locked, value: result } = await deps.locks.run(`setup:${interaction.guild.id}`, () =>
      runSetup(interaction.guild, deps.store, { syncPermissions: sync, archiveObsolete: archive, logger: deps.logger }));
    if (locked) return interaction.editReply({ embeds: [embeds.warning('Einrichtung läuft bereits', 'Bitte warte, bis die laufende Einrichtung abgeschlossen ist.')] });

    await deps.ctx.audit(interaction.guild, 'audit', {
      title: 'Servereinrichtung ausgeführt',
      fields: [
        { name: 'Ausgeführt von', value: `<@${interaction.user.id}>` },
        { name: 'Optionen', value: `Archivieren: ${archive ? 'ja' : 'nein'} · Synchronisieren: ${sync ? 'ja' : 'nein'}` },
        { name: 'Ergebnis', value: `${result.created.length} erstellt, ${result.updated.length} aktualisiert, ${result.archived.length} archiviert, ${result.errors.length} Fehler` },
      ],
    });
    return interaction.editReply({ embeds: [resultEmbed(result)] });
  },
  previewEmbed,
  resultEmbed,
};

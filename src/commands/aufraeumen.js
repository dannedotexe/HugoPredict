'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { embeds, truncate } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { planCleanup, runCleanup } = require('../setup/cleanup');

const list = (items, max = 15) =>
  items.length ? truncate(items.slice(0, max).join('\n') + (items.length > max ? `\n… und ${items.length - max} weitere` : ''), 1024) : '—';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aufräumen')
    .setDescription('Löscht das Archiv und leere Kategorien der früheren Struktur endgültig')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((o) => o.setName('veraltete_rollen').setDescription('Auch veraltete Rollen löschen, z. B. Diamond Trader und Trader (Standard: nein)')),
  privilege: 'setup',
  rateLimit: 'setup',
  async execute(interaction, deps) {
    const includeRoles = interaction.options.getBoolean('veraltete_rollen') ?? false;
    await interaction.guild.channels.fetch();
    await interaction.guild.roles.fetch();
    const plan = planCleanup(interaction.guild, deps.store, { includeRoles });
    const total = plan.channels.length + plan.categories.length + plan.roles.length;

    if (!total) {
      const e = embeds.info('Nichts aufzuräumen', 'Es gibt kein Archiv, keine leeren alten Kategorien und keine ausgewählten veralteten Rollen.');
      if (plan.leftoverChannels.length) e.addFields({ name: 'Veraltete Channels außerhalb des Archivs', value: `${list(plan.leftoverChannels)}\n\nVerschiebe sie zuerst mit \`/setup-server veraltete_archivieren:true\` ins Archiv.`, inline: false });
      return replyPrivate(interaction, { embeds: [e] });
    }

    const preview = embeds.error('Endgültig löschen?', `Folgende **${total}** Elemente werden **unwiderruflich** gelöscht, einschließlich aller Nachrichten darin. Elemente der aktuellen Serverstruktur sind nicht betroffen.`);
    if (plan.channels.length) preview.addFields({ name: `Channels im Archiv (${plan.channels.length})`, value: list(plan.channels.map((c) => `#${c.name}`)), inline: false });
    if (plan.categories.length) preview.addFields({ name: `Kategorien (${plan.categories.length})`, value: list(plan.categories.map((c) => c.name)), inline: false });
    if (plan.roles.length) preview.addFields({ name: `Rollen (${plan.roles.length})`, value: list(plan.roles.map((r) => r.name)), inline: false });
    if (plan.keptCategories.length) preview.addFields({ name: 'Bleibt erhalten (nicht leer)', value: list(plan.keptCategories), inline: false });
    if (plan.skippedTickets.length) preview.addFields({ name: 'Bleibt erhalten (offene Anfragen)', value: list(plan.skippedTickets), inline: false });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm').setLabel(`${total} Elemente endgültig löschen`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
    );
    const response = await interaction.reply({ embeds: [preview], components: [row], flags: EPHEMERAL, withResponse: true });

    let click;
    try {
      click = await response.resource.message.awaitMessageComponent({ componentType: ComponentType.Button, filter: (i) => i.user.id === interaction.user.id, time: 120_000 });
    } catch {
      return interaction.editReply({ embeds: [embeds.info('Abgebrochen', 'Keine Bestätigung innerhalb von zwei Minuten. Es wurde nichts gelöscht.')], components: [] });
    }
    if (click.customId === 'cancel') return click.update({ embeds: [embeds.info('Abgebrochen', 'Es wurde nichts gelöscht.')], components: [] });

    await click.update({ embeds: [embeds.info('Wird aufgeräumt …', 'Das kann einen Moment dauern.')], components: [] });
    const { locked, value: result } = await deps.locks.run(`setup:${interaction.guild.id}`, () => runCleanup(interaction.guild, deps.store, plan, { logger: deps.logger }));
    if (locked) return interaction.editReply({ embeds: [embeds.warning('Bitte warten', 'Eine Einrichtung läuft gerade. Versuche es gleich erneut.')] });

    await deps.ctx.audit(interaction.guild, 'audit', {
      title: 'Aufräumen ausgeführt',
      fields: [
        { name: 'Ausgeführt von', value: `<@${interaction.user.id}>` },
        { name: 'Gelöscht', value: list(result.deleted, 25), inline: false },
        { name: 'Fehler', value: result.errors.length ? list(result.errors) : '—', inline: false },
      ],
    });
    const e = embeds[result.errors.length ? 'warning' : 'success']('Aufräumen abgeschlossen', `Gelöscht: **${result.deleted.length}**`);
    if (result.errors.length) e.addFields({ name: 'Fehler', value: list(result.errors, 8), inline: false });
    return interaction.editReply({ embeds: [e] });
  },
};

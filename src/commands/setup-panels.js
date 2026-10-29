'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { publishPanels } = require('../setup/panels');
const { syncRoleNames } = require('../setup/setupServer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-panels')
    .setDescription('Veröffentlicht oder aktualisiert alle Bot-Panels')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  privilege: 'setup',
  rateLimit: 'setup',
  async execute(interaction, deps) {
    if (deps.store.guild(interaction.guild.id).layoutVersion !== 2) {
      return replyPrivate(interaction, { embeds: [embeds.warning('Einrichtung fehlt', 'Die aktuelle Serverstruktur ist auf diesem Server nicht eingerichtet.')] });
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    // Rollen mit früherem Namen zuerst umbenennen, damit die Dokumentation die aktuellen Namen zeigt.
    const roles = await syncRoleNames(interaction.guild, deps.store);
    const result = await publishPanels(interaction.guild, { store: deps.store, env: deps.env, statusService: deps.services.status, statsService: deps.services.stats });
    await deps.ctx.audit(interaction.guild, 'audit', {
      title: 'Panels veröffentlicht',
      fields: [
        { name: 'Ausgeführt von', value: `<@${interaction.user.id}>` },
        { name: 'Neu', value: result.created.join(', ') || '—' },
        { name: 'Aktualisiert', value: result.updated.join(', ') || '—' },
        { name: 'Rollen umbenannt', value: roles.renamed.join(', ') || '—' },
      ],
    });
    const e = embeds[result.errors.length ? 'warning' : 'success']('Panels veröffentlicht', 'Bestehende Panels wurden bearbeitet, nicht neu gepostet.').addFields(
      { name: 'Neu', value: result.created.join('\n') || '—', inline: true },
      { name: 'Aktualisiert', value: result.updated.join('\n') || '—', inline: true },
    );
    if (roles.renamed.length) e.addFields({ name: 'Rollen umbenannt', value: roles.renamed.join('\n').slice(0, 1024), inline: false });
    if (roles.warnings.length) e.addFields({ name: 'Hinweise', value: roles.warnings.join('\n').slice(0, 1024), inline: false });
    if (result.errors.length) e.addFields({ name: 'Fehler', value: result.errors.join('\n').slice(0, 1024), inline: false });
    // Marktübersicht und Status direkt einmal aktualisieren.
    deps.services.runFeedsNow?.();
    return replyPrivate(interaction, { embeds: [e] });
  },
};

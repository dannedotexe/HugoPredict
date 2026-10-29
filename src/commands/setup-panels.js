'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { NOTIFY_BOT_PERMISSION } = require('../config/serverLayout');
const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { publishPanels } = require('../setup/panels');
const { syncRoleNames, syncChannelNames, ensureMissingChannels, ensureMissingRoles } = require('../setup/setupServer');

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
    // Rollen und Channels mit früherem Namen zuerst umbenennen, damit die Panels die aktuellen Namen zeigen.
    const roles = await syncRoleNames(interaction.guild, deps.store);
    const renamedChannels = await syncChannelNames(interaction.guild, deps.store);
    const newRoles = await ensureMissingRoles(interaction.guild, deps.store);
    // Neue Channels des Layouts anlegen (nur fehlende, Bestehendes bleibt unverändert).
    await interaction.guild.channels.fetch();
    const channels = await ensureMissingChannels(interaction.guild, deps.store);
    const result = await publishPanels(interaction.guild, { store: deps.store, env: deps.env, statusService: deps.services.status, statsService: deps.services.stats });
    await deps.ctx.audit(interaction.guild, 'audit', {
      title: 'Panels veröffentlicht',
      fields: [
        { name: 'Ausgeführt von', value: `<@${interaction.user.id}>` },
        { name: 'Neu', value: result.created.join(', ') || '—' },
        { name: 'Aktualisiert', value: result.updated.join(', ') || '—' },
        { name: 'Rollen umbenannt', value: roles.renamed.join(', ') || '—' },
        { name: 'Channels angelegt', value: channels.created.join(', ') || '—' },
      ],
    });
    const e = embeds[result.errors.length ? 'warning' : 'success']('Panels veröffentlicht', 'Bestehende Panels wurden bearbeitet, nicht neu gepostet.').addFields(
      { name: 'Neu', value: result.created.join('\n') || '—', inline: true },
      { name: 'Aktualisiert', value: result.updated.join('\n') || '—', inline: true },
    );
    if (newRoles.created.length) e.addFields({ name: 'Rollen angelegt', value: newRoles.created.join('\n'), inline: false });
    if (newRoles.errors.length) e.addFields({ name: 'Rollen-Fehler', value: newRoles.errors.join('\n').slice(0, 1024), inline: false });
    if (!interaction.guild.members.me.permissions.has(NOTIFY_BOT_PERMISSION)) {
      e.addFields({ name: 'Hinweis zu Benachrichtigungen', value: 'Damit die Rollen „Neue Prognosen“ und „Ankündigungen“ gepingt werden, aktiviere bei der Bot-Rolle das Recht „@everyone, @here und alle Rollen erwähnen“.', inline: false });
    }
    if (renamedChannels.renamed.length) e.addFields({ name: 'Channels umbenannt', value: renamedChannels.renamed.join('\n').slice(0, 1024), inline: false });
    if (renamedChannels.warnings.length) e.addFields({ name: 'Hinweise (Channels)', value: renamedChannels.warnings.join('\n').slice(0, 1024), inline: false });
    if (channels.created.length) e.addFields({ name: 'Channels angelegt', value: channels.created.join('\n').slice(0, 1024), inline: false });
    if (channels.errors.length) e.addFields({ name: 'Channel-Fehler', value: channels.errors.join('\n').slice(0, 1024), inline: false });
    if (roles.renamed.length) e.addFields({ name: 'Rollen umbenannt', value: roles.renamed.join('\n').slice(0, 1024), inline: false });
    if (roles.warnings.length) e.addFields({ name: 'Hinweise', value: roles.warnings.join('\n').slice(0, 1024), inline: false });
    if (result.errors.length) e.addFields({ name: 'Fehler', value: result.errors.join('\n').slice(0, 1024), inline: false });
    // Prognosen und Status direkt einmal aktualisieren.
    deps.services.runFeedsNow?.();
    return replyPrivate(interaction, { embeds: [e] });
  },
};

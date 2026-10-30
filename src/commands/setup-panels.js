'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { NOTIFY_BOT_PERMISSION } = require('../config/serverLayout');
const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { publishPanels } = require('../setup/panels');
const { setSupportOpen, syncWaitingRoom } = require('../services/supportVoice');
const { syncRoleNames, syncChannelNames, ensureMissingChannels, ensureMissingRoles, lockNicknames, retireChangedChannels, syncRoleIcons } = require('../setup/setupServer');

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
    const icons = await syncRoleIcons(interaction.guild, deps.store);
    // Mitglieder dürfen ihren Server-Namen nicht selbst ändern.
    const nicknames = await lockNicknames(interaction.guild, deps.store);
    // Teamrollen im Namen („Supporter | Steve“) für alle abgleichen
    const staffRenamed = deps.membersIntent && deps.services.staffNames
      ? await deps.services.staffNames.sweep(interaction.guild).catch((err) => { deps.logger.warn('Teamnamen:', err.message); return 0; })
      : null;
    // Neue Channels des Layouts anlegen (nur fehlende, Bestehendes bleibt unverändert).
    await interaction.guild.channels.fetch();
    // Channels mit neuem Typ ersetzen (z. B. #vorschläge wird ein Forum).
    const replaced = await retireChangedChannels(interaction.guild, deps.store);
    const channels = await ensureMissingChannels(interaction.guild, deps.store);
    // Ein neu angelegter Warteraum übernimmt den gespeicherten Zustand (offen/geschlossen).
    if (!deps.store.guild(interaction.guild.id).supportVoice.open) await setSupportOpen(interaction.guild, deps.store, false).catch(() => {});
    // Platzlimit und Warteschlange im Warteraum
    await syncWaitingRoom(interaction.guild, deps.store).catch((err) => deps.logger.warn('Warteraum einrichten:', err.message));
    await deps.services.supportVoice?.refresh(interaction.guild).catch((err) => deps.logger.warn('Warteschlange:', err.message));
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
    if (icons.set.length) e.addFields({ name: 'Rollen-Icons gesetzt', value: icons.set.join(', ').slice(0, 1024), inline: false });
    if (icons.warnings.length) e.addFields({ name: 'Hinweise (Rollen-Icons)', value: icons.warnings.join('\n').slice(0, 1024), inline: false });
    if (icons.unavailable) e.addFields({ name: 'Rollen-Icons', value: 'Rollen-Icons gibt es erst ab Server-Boost Stufe 2.', inline: false });
    if (staffRenamed) e.addFields({ name: 'Teamnamen', value: `${staffRenamed} Name(n) an die Teamrolle angepasst (z. B. „Supporter | Name“).`, inline: false });
    if (staffRenamed === null) e.addFields({ name: 'Teamnamen', value: 'Für „Supporter | Name“ braucht der Bot den „Server Members Intent“ im Developer Portal.', inline: false });
    if (nicknames.changed.length) e.addFields({ name: 'Umbenennen gesperrt', value: `„Nickname ändern“ entfernt bei: ${nicknames.changed.join(', ')}`.slice(0, 1024), inline: false });
    if (nicknames.warnings.length) e.addFields({ name: 'Hinweise (Nicknames)', value: nicknames.warnings.join('\n').slice(0, 1024), inline: false });
    if (newRoles.errors.length) e.addFields({ name: 'Rollen-Fehler', value: newRoles.errors.join('\n').slice(0, 1024), inline: false });
    if (!interaction.guild.members.me.permissions.has(NOTIFY_BOT_PERMISSION)) {
      e.addFields({ name: 'Hinweis zu Benachrichtigungen', value: 'Damit die Rollen „Neue Prognosen“ und „Ankündigungen“ gepingt werden, aktiviere bei der Bot-Rolle das Recht „@everyone, @here und alle Rollen erwähnen“.', inline: false });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      e.addFields({ name: 'Hinweis zu Namen', value: 'Damit der Bot nach der Kontoverknüpfung den Minecraft-Namen als Server-Namen setzt, aktiviere bei der Bot-Rolle das Recht „Nicknames verwalten“.', inline: false });
    }
    const voicePerms = [PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream];
    if (!interaction.guild.members.me.permissions.has(voicePerms)) {
      e.addFields({ name: 'Hinweis zu Support-Sprachkanälen', value: 'Damit der Bot Warteraum und Support-Räume anlegen kann, braucht die Bot-Rolle: „Mitglieder verschieben“, „Verbinden“, „Sprechen“ und „Video“.', inline: false });
    }
    if (renamedChannels.renamed.length) e.addFields({ name: 'Channels umbenannt', value: renamedChannels.renamed.join('\n').slice(0, 1024), inline: false });
    if (renamedChannels.warnings.length) e.addFields({ name: 'Hinweise (Channels)', value: renamedChannels.warnings.join('\n').slice(0, 1024), inline: false });
    if (replaced.removed.length || replaced.kept.length) {
      e.addFields({ name: 'Channels ersetzt', value: [...replaced.removed.map((n) => `${n} (leer, entfernt)`), ...replaced.kept.map((n) => `${n} → umbenannt in …-alt`)].join('\n').slice(0, 1024), inline: false });
    }
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

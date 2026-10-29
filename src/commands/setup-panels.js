'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { publishPanels } = require('../setup/panels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-panels')
    .setDescription('Veröffentlicht oder aktualisiert alle Bot-Panels')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  privilege: 'setup',
  rateLimit: 'setup',
  async execute(interaction, deps) {
    if (!deps.store.guild(interaction.guild.id).setupCompletedAt) {
      return replyPrivate(interaction, { embeds: [embeds.warning('Setup fehlt', 'Bitte führe zuerst `/setup-server` aus.')] });
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await publishPanels(interaction.guild, { store: deps.store, env: deps.env, statusService: deps.services.status });
    await deps.ctx.audit(interaction.guild, 'modLogs', {
      title: 'Panels veröffentlicht',
      fields: [
        { name: 'Ausgeführt von', value: `<@${interaction.user.id}>` },
        { name: 'Neu', value: result.created.join(', ') || '—' },
        { name: 'Aktualisiert', value: result.updated.join(', ') || '—' },
      ],
    });
    const e = embeds[result.errors.length ? 'warning' : 'success']('Panels veröffentlicht').addFields(
      { name: 'Neu', value: result.created.join('\n') || '—', inline: true },
      { name: 'Aktualisiert', value: result.updated.join('\n') || '—', inline: true },
    );
    if (result.errors.length) e.addFields({ name: 'Fehler', value: result.errors.join('\n').slice(0, 1024), inline: false });
    // Feeds direkt einmal anstoßen, damit die Channels sofort gefüllt werden.
    deps.services.runFeedsNow?.();
    return replyPrivate(interaction, { embeds: [e] });
  },
};

'use strict';

const { execFileSync } = require('node:child_process');
const { SlashCommandBuilder } = require('discord.js');
const { embeds, discordTime } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');

let version = 'unbekannt';
try {
  version = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  // kein Git verfügbar
}
const startedAt = new Date();

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Prüft, ob der Bot erreichbar ist'),
  async execute(interaction) {
    return replyPrivate(interaction, {
      embeds: [embeds.success('Pong').addFields(
        { name: 'Latenz', value: `${Math.max(0, Math.round(interaction.client.ws.ping))} ms`, inline: true },
        { name: 'Version', value: `\`${version}\``, inline: true },
        { name: 'Gestartet', value: discordTime(startedAt, 'R'), inline: true },
      )],
    });
  },
};

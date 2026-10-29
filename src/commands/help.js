'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Zeigt alle verfügbaren Befehle'),
  async execute(interaction, { ctx }) {
    const e = embeds.brand().setTitle('Befehle').addFields(
      { name: 'Konto', value: '`/verify` Minecraft-Account verknüpfen\n`/balance` Guthaben anzeigen\n`/portfolio` Offene Positionen\n`/history` Transaktionshistorie\n`/daily` Täglichen Bonus abholen', inline: false },
      { name: 'Märkte', value: '`/markets` Märkte durchsuchen\n`/leaderboard` Trader-Rangliste\n`/vorschlag` Neuen Markt vorschlagen', inline: false },
      { name: 'Support', value: 'Tickets erstellst du über das Panel im Support-Bereich.\n`/ping` Bot-Status und Version', inline: false },
      { name: 'Privatsphäre', value: 'Antworten zu Guthaben, Portfolio und Historie siehst nur du.', inline: false },
    );
    if (interaction.member && ctx.can(interaction.member, 'setup')) {
      e.addFields({ name: 'Administration', value: '`/setup-server` Serverstruktur einrichten\n`/setup-panels` Panels veröffentlichen', inline: false });
    }
    return replyPrivate(interaction, { embeds: [e] });
  },
};

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Zeigt alle verfügbaren Befehle'),
  async execute(interaction, { ctx }) {
    const e = embeds.brand().setTitle('Befehlsübersicht').setDescription('Alle Antworten zu deinem Konto sind privat und nur für dich sichtbar.').addFields(
      { name: 'Konto', value: '`/verify` Konto verknüpfen\n`/balance` Guthaben\n`/portfolio` Offene Positionen\n`/history` Transaktionen\n`/daily` Täglicher Bonus', inline: true },
      { name: 'Märkte', value: '`/markets` Märkte anzeigen\n`/leaderboard` Ranglisten\n`/vorschlag` Markt vorschlagen', inline: true },
      { name: 'Hilfe', value: 'Anfragen an den Kundenservice stellst du in #support.\n`/ping` Systemstatus', inline: false },
    );
    if (interaction.member && ctx.can(interaction.member, 'moderate')) {
      e.addFields({ name: 'Moderation', value: '`/mod verwarnen` · `/mod timeout` · `/mod timeout-aufheben` · `/mod kicken`\n`/mod bannen` · `/mod entbannen` (nur Inhaber/Administrator)\n`/mod verlauf` Verlauf einer Person', inline: false });
    }
    if (interaction.member && ctx.can(interaction.member, 'setup')) {
      e.addFields({ name: 'Verwaltung', value: '`/setup-panels` Panels veröffentlichen\n`/ankündigung` Ankündigung veröffentlichen\n`/aufräumen` Archiv und alte Kategorien löschen', inline: false });
    }
    return replyPrivate(interaction, { embeds: [e] });
  },
};

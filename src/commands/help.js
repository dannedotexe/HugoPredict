'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { replyPrivate } = require('../lib/respond');
const { card } = require('../lib/ui');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Zeigt alle verfügbaren Befehle'),
  async execute(interaction, { ctx }) {
    const can = (p) => interaction.member && ctx.can(interaction.member, p);
    const blocks = [
      { heading: 'Konto', icon: 'balance', body: '`/verify` Konto verknüpfen\n`/balance` Guthaben\n`/portfolio` Offene Positionen\n`/history` Transaktionen\n`/daily` Täglicher Bonus' },
      { heading: 'Märkte', icon: 'open', body: '`/markets` Märkte anzeigen\n`/leaderboard` Ranglisten\n`/vorschlag` Markt vorschlagen' },
      { heading: 'Hilfe', icon: 'support', body: 'Anfragen an den Support stellst du in #support.\n`/ping` Systemstatus' },
    ];
    if (can('moderate')) {
      blocks.push({ heading: 'Moderation', icon: 'moderator', body: '`/mod verwarnen` · `/mod timeout` · `/mod timeout-aufheben`\n`/mod kicken` · `/mod verlauf`\n`/mod bannen` · `/mod entbannen` (Inhaber/Administrator)' });
    }
    if (can('setup')) {
      blocks.push({ heading: 'Verwaltung', icon: 'admin', body: '`/setup-panels` Panels veröffentlichen\n`/ankündigung` Ankündigung veröffentlichen oder planen\n`/geplant` Geplante Ankündigungen\n`/aufräumen` Archiv und alte Kategorien löschen' });
    }
    return replyPrivate(interaction, card({
      icon: 'logo',
      title: 'Befehlsübersicht',
      intro: 'Antworten zu deinem Konto sind privat und nur für dich sichtbar.',
      blocks,
      ephemeral: true,
    }));
  },
};

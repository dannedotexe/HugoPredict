'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const theme = require('../config/theme');

const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

/** Begrüßung per Direktnachricht – kein Beitrag im öffentlichen Chat. */
function welcomePayload({ guildId, guildName, ids = {}, websiteUrl }) {
  const ref = (key, fallback) => (ids[key] ? `<#${ids[key]}>` : fallback);
  const e = embeds.brand()
    .setDescription([
      `${emojis.icon('logo')}**Willkommen bei ${theme.brand}**`,
      '',
      `Schön, dass du auf **${guildName}** dabei bist. In drei Schritten bist du startklar:`,
      '',
      `${emojis.icon('rules')}**1. Dokumentation lesen**\nIn ${ref('docs', '#dokumentation')} findest du Plattform, Marktregeln und Verhaltensregeln. Mit „Regeln akzeptieren“ erhältst du Zugang zur Community.`,
      '',
      `${emojis.icon('link')}**2. Konto verknüpfen**\nVerknüpfe dein Konto mit \`/verify\` oder über „Konto verknüpfen“, um Guthaben und Portfolio privat abzurufen.`,
      '',
      `${emojis.icon('support')}**3. Bei Fragen**\nDer Support hilft dir in ${ref('support', '#support')}.`,
    ].join('\n'));
  const buttons = [];
  if (ids.docs) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Dokumentation').setURL(channelUrl(guildId, ids.docs)), 'rules'));
  if (websiteUrl) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Website').setURL(websiteUrl), 'external'));
  return { embeds: [e], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [] };
}

function createWelcomeService({ store, env, logger }) {
  async function onMemberAdd(member) {
    if (member.user.bot) return;
    const g = store.guild(member.guild.id);
    if (g.layoutVersion !== 2) return;
    try {
      await member.send(welcomePayload({ guildId: member.guild.id, guildName: member.guild.name, ids: g.channels, websiteUrl: env.websiteUrl }));
    } catch {
      logger.debug(`Begrüßung an ${member.id} nicht zustellbar (Direktnachrichten deaktiviert).`);
    }
  }
  return { onMemberAdd };
}

module.exports = { createWelcomeService, welcomePayload };

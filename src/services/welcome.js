'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { withEmoji } = require('../lib/emojis');
const { card } = require('../lib/ui');
const theme = require('../config/theme');

const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

/** Begrüßung per Direktnachricht – kein Beitrag im öffentlichen Chat. */
function welcomePayload({ guildId, guildName, ids = {}, websiteUrl }) {
  const ref = (key, fallback) => (ids[key] ? `<#${ids[key]}>` : fallback);
  const buttons = [];
  if (ids.docs) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Dokumentation').setURL(channelUrl(guildId, ids.docs)), 'rules'));
  if (websiteUrl) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Website').setURL(websiteUrl), 'external'));
  return card({
    size: 'lg',
    icon: 'logo',
    title: `Willkommen bei ${theme.brand}`,
    intro: `Schön, dass du auf **${guildName}** dabei bist. In drei Schritten bist du startklar.`,
    blocks: [
      { heading: '1. Dokumentation lesen', icon: 'rules', body: `In ${ref('docs', '#dokumentation')} findest du Plattform, Marktregeln und Verhaltensregeln.\nMit „Regeln akzeptieren“ erhältst du Zugang zur Community.` },
      { heading: '2. Konto verknüpfen', icon: 'link', body: 'Mit `/verify` oder „Konto verknüpfen“ rufst du Guthaben und Portfolio privat ab.' },
      { heading: '3. Bei Fragen', icon: 'support', body: `Der Support hilft dir in ${ref('support', '#support')}.` },
    ],
    actions: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
  });
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

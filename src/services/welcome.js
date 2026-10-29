'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { withEmoji } = require('../lib/emojis');
const { card } = require('../lib/ui');
const theme = require('../config/theme');

const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;
const nf = new Intl.NumberFormat('de-DE');

/**
 * Begrüßungskarte für #willkommen: Profilbild oben rechts, Erwähnung,
 * Mitgliedsnummer und die ersten drei Schritte.
 */
function welcomePayload({ guildId, guildName, ids = {}, websiteUrl, userId, avatarUrl, memberCount }) {
  const ref = (key, fallback) => (ids[key] ? `<#${ids[key]}>` : fallback);
  const buttons = [];
  if (ids.docs) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Dokumentation').setURL(channelUrl(guildId, ids.docs)), 'rules'));
  if (websiteUrl) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Website').setURL(websiteUrl), 'external'));
  const payload = card({
    size: 'lg',
    icon: 'logo',
    title: 'Willkommen',
    intro: `${userId ? `<@${userId}>, schön` : 'Schön'}, dass du bei **${guildName}** dabei bist.${memberCount ? `\n-# Mitglied Nr. ${nf.format(memberCount)}` : ''}`,
    // Profilbild groß unter der Überschrift
    logo: false,
    media: avatarUrl ? [{ url: avatarUrl, description: 'Profilbild' }] : [],
    blocks: [
      { heading: '1. Dokumentation lesen', icon: 'rules', body: `In ${ref('docs', '#dokumentation')} findest du Plattform, Marktregeln und Verhaltensregeln.\nMit „Regeln akzeptieren“ erhältst du Zugang zur Community.` },
      { heading: '2. Konto verknüpfen', icon: 'link', body: 'Mit `/verify` oder „Konto verknüpfen“ rufst du Guthaben und Portfolio privat ab.' },
      { heading: '3. Bei Fragen', icon: 'support', body: `Der Support hilft dir in ${ref('support', '#support')}.` },
    ],
    actions: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
    footer: theme.brand === guildName ? null : undefined,
  });
  // Nur die neue Person wird benachrichtigt – keine Rollen, kein @everyone.
  payload.allowedMentions = { users: userId ? [userId] : [] };
  return payload;
}

function createWelcomeService({ store, env, logger, ctx }) {
  async function onMemberAdd(member) {
    if (member.user.bot) return;
    const g = store.guild(member.guild.id);
    if (g.layoutVersion !== 2) return;
    const payload = welcomePayload({
      guildId: member.guild.id,
      guildName: member.guild.name,
      ids: g.channels,
      websiteUrl: env.websiteUrl,
      userId: member.id,
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 512 }),
      memberCount: member.guild.memberCount,
    });
    const channel = await ctx.channel(member.guild, 'greeting');
    if (channel?.isTextBased()) {
      await channel.send(payload).catch((err) => logger.warn('Begrüßung in #willkommen fehlgeschlagen:', err.message));
      return;
    }
    // Ohne #willkommen: Begrüßung per Direktnachricht
    await member.send({ ...payload, allowedMentions: { parse: [] } }).catch(() => logger.debug(`Begrüßung an ${member.id} nicht zustellbar.`));
  }
  return { onMemberAdd };
}

module.exports = { createWelcomeService, welcomePayload };

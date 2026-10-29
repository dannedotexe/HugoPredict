'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, truncate, discordTime } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const { card } = require('../lib/ui');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');

function announcementModal() {
  return new ModalBuilder().setCustomId('hm:announce:submit').setTitle('Ankündigung veröffentlichen').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('title').setLabel('Titel').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('body').setLabel('Text').setStyle(TextInputStyle.Paragraph).setMaxLength(3500).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('link').setLabel('Link (optional)').setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false)
        .setPlaceholder('https://…'),
    ),
  );
}

function announcementCard({ title, body, link, authorName }) {
  const actions = link
    ? [new ActionRowBuilder().addComponents(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mehr erfahren').setURL(link), 'external'))]
    : [];
  return card({
    size: 'lg',
    eyebrow: `${emojis.icon('announce')}Ankündigung`,
    title: truncate(title, 200),
    blocks: [{ text: truncate(body, 3500) }],
    actions,
    footer: `${authorName ? `${truncate(authorName, 60)} · ` : ''}${discordTime(new Date(), 'D')}`,
  });
}

const isHttpsUrl = (v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

async function handle(interaction, deps, [action]) {
  if (action !== 'submit' || !interaction.isModalSubmit() || !interaction.inGuild()) return;
  // Berechtigung erneut prüfen – Modals können nicht vertrauenswürdig weitergereicht werden.
  if (!deps.ctx.can(interaction.member, 'announce')) return deps.deny(interaction, 'Ankündigung veröffentlichen');

  const title = interaction.fields.getTextInputValue('title').trim();
  const body = interaction.fields.getTextInputValue('body').trim();
  const link = interaction.fields.getTextInputValue('link').trim();
  if (link && !isHttpsUrl(link)) {
    return replyPrivate(interaction, { embeds: [embeds.error('Ungültiger Link', 'Bitte gib einen vollständigen Link beginnend mit https:// an.')] });
  }
  await interaction.deferReply({ flags: EPHEMERAL });
  const channel = await deps.ctx.channel(interaction.guild, 'announcements');
  if (!channel?.isTextBased()) {
    return replyPrivate(interaction, { embeds: [embeds.error('Channel fehlt', 'Der Channel #ankündigungen ist nicht eingerichtet.')] });
  }
  const msg = await channel.send(announcementCard({ title, body, link: link || null, authorName: interaction.member.displayName }));
  await deps.ctx.audit(interaction.guild, 'audit', {
    title: 'Ankündigung veröffentlicht',
    fields: [{ name: 'Von', value: `<@${interaction.user.id}>` }, { name: 'Nachricht', value: msg.url }],
  });
  return replyPrivate(interaction, { embeds: [embeds.success('Ankündigung veröffentlicht', msg.url)] });
}

module.exports = { prefix: 'announce', handle, announcementModal, announcementCard };

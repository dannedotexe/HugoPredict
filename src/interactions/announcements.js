'use strict';

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, truncate } = require('../lib/embeds');
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

function announcementEmbed({ title, body, link, authorName }) {
  const e = embeds.brand().setAuthor({ name: 'Ankündigung' }).setTitle(truncate(title, 256)).setDescription(truncate(body, 4096));
  if (link) e.setURL(link);
  if (authorName) e.setFooter({ text: `${e.data.footer.text} · ${truncate(authorName, 60)}` });
  return e;
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
  const msg = await channel.send({
    embeds: [announcementEmbed({ title, body, link: link || null, authorName: interaction.member.displayName })],
    allowedMentions: { parse: [] },
  });
  await deps.ctx.audit(interaction.guild, 'audit', {
    title: 'Ankündigung veröffentlicht',
    fields: [{ name: 'Von', value: `<@${interaction.user.id}>` }, { name: 'Nachricht', value: msg.url }],
  });
  return replyPrivate(interaction, { embeds: [embeds.success('Ankündigung veröffentlicht', msg.url)] });
}

module.exports = { prefix: 'announce', handle, announcementModal, announcementEmbed };

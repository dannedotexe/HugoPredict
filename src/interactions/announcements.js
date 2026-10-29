'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, truncate, discordTime } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const { card } = require('../lib/ui');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');

/* Ankündigungen in #ankündigungen, optional mit Ping der Rolle „Ankündigungen“. */

function announcementModal({ ping = false } = {}) {
  return new ModalBuilder().setCustomId(`hm:announce:submit:${ping ? 1 : 0}`)
    .setTitle('Ankündigung veröffentlichen').addComponents(
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

function announcementCard({ title, body, link, authorName, pingRoleId = null }) {
  const actions = link
    ? [new ActionRowBuilder().addComponents(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mehr erfahren').setURL(link), 'external'))]
    : [];
  const payload = card({
    size: 'lg',
    eyebrow: `${emojis.icon('announce')}Ankündigung`,
    title: truncate(title, 200),
    intro: pingRoleId ? `-# Für <@&${pingRoleId}>` : null,
    blocks: [{ text: truncate(body, 3500) }],
    actions,
    footer: `${authorName ? `${truncate(authorName, 60)} · ` : ''}${discordTime(new Date(), 'D')}`,
  });
  if (pingRoleId) payload.allowedMentions = { roles: [pingRoleId] };
  return payload;
}

const isHttpsUrl = (v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Veröffentlicht eine Ankündigung. */
async function publishAnnouncement(guild, a, deps) {
  const channel = await deps.ctx.channel(guild, 'announcements');
  if (!channel?.isTextBased()) throw new Error('Der Channel #ankündigungen ist nicht eingerichtet.');
  const pingRoleId = a.ping ? deps.ctx.roleId(guild.id, 'notifyNews') : null;
  const msg = await channel.send(announcementCard({ ...a, pingRoleId }));
  await deps.ctx.audit(guild, 'audit', {
    title: 'Ankündigung veröffentlicht',
    fields: [{ name: 'Von', value: `<@${a.authorId}>` }, { name: 'Ping', value: pingRoleId ? 'Ja' : 'Nein' }, { name: 'Nachricht', value: msg.url }],
  });
  return msg;
}

async function handle(interaction, deps, [action, pingFlag]) {
  if (!interaction.inGuild()) return;
  // Berechtigung bei jeder Interaktion erneut prüfen.
  if (!deps.ctx.can(interaction.member, 'announce')) return deps.deny(interaction, 'Ankündigung');

  if (action !== 'submit' || !interaction.isModalSubmit()) return;
  const title = interaction.fields.getTextInputValue('title').trim();
  const body = interaction.fields.getTextInputValue('body').trim();
  const link = interaction.fields.getTextInputValue('link').trim();
  if (link && !isHttpsUrl(link)) {
    return replyPrivate(interaction, { embeds: [embeds.error('Ungültiger Link', 'Bitte gib einen vollständigen Link beginnend mit https:// an.')] });
  }
  const data = { title, body, link: link || null, authorName: interaction.member.displayName, authorId: interaction.user.id, ping: pingFlag === '1' };
  await interaction.deferReply({ flags: EPHEMERAL });

  try {
    const msg = await publishAnnouncement(interaction.guild, data, deps);
    return replyPrivate(interaction, { embeds: [embeds.success('Ankündigung veröffentlicht', msg.url)] });
  } catch (err) {
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht veröffentlicht', err.message)] });
  }
}

module.exports = { prefix: 'announce', handle, announcementModal, announcementCard, publishAnnouncement };

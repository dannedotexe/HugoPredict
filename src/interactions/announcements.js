'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, truncate, discordTime } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const { card } = require('../lib/ui');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');

/*
 * Ankündigungen: sofort oder geplant (Europe/Berlin), optional mit Ping der
 * Rolle „Ankündigungen“. Geplante Ankündigungen liegen im Store und werden
 * vom Scheduler veröffentlicht – sie überstehen Neustarts.
 */

function announcementModal({ ping = false, at = 0 } = {}) {
  return new ModalBuilder().setCustomId(`hm:announce:submit:${ping ? 1 : 0}:${at}`)
    .setTitle(at ? 'Ankündigung planen' : 'Ankündigung veröffentlichen').addComponents(
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

/** Veröffentlicht eine Ankündigung (sofort oder durch den Scheduler). */
async function publishAnnouncement(guild, a, deps) {
  const channel = await deps.ctx.channel(guild, 'announcements');
  if (!channel?.isTextBased()) throw new Error('Der Channel #ankündigungen ist nicht eingerichtet.');
  const pingRoleId = a.ping ? deps.ctx.roleId(guild.id, 'notifyNews') : null;
  const msg = await channel.send(announcementCard({ ...a, pingRoleId }));
  await deps.ctx.audit(guild, 'audit', {
    title: a.scheduled ? 'Geplante Ankündigung veröffentlicht' : 'Ankündigung veröffentlicht',
    fields: [{ name: 'Von', value: `<@${a.authorId}>` }, { name: 'Ping', value: pingRoleId ? 'Ja' : 'Nein' }, { name: 'Nachricht', value: msg.url }],
  });
  return msg;
}

function scheduledList(guildId, store) {
  return [...(store.guild(guildId).scheduled ?? [])].sort((x, y) => x.at - y.at);
}

/** Karte „Geplante Ankündigungen“ mit Auswahl zum Abbrechen. */
function scheduledCard(items) {
  const blocks = items.length
    ? items.slice(0, 15).map((a) => ({
      heading: truncate(a.title, 100),
      body: `${discordTime(a.at, 'F')} · ${discordTime(a.at, 'R')}\nVon <@${a.authorId}>${a.ping ? ' · mit Ping' : ''}`,
    }))
    : [{ text: 'Es sind keine Ankündigungen geplant. Plane eine mit `/ankündigung zeitpunkt:…`.' }];
  const actions = items.length ? [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('hm:announce:cancel').setPlaceholder('Geplante Ankündigung abbrechen …')
      .addOptions(items.slice(0, 25).map((a) => ({ label: truncate(a.title, 100), value: a.id, description: new Date(a.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }) }))),
  )] : [];
  return card({ icon: 'announce', title: 'Geplante Ankündigungen', logo: false, blocks, actions, ephemeral: true });
}

async function handle(interaction, deps, [action, pingFlag, atRaw]) {
  if (!interaction.inGuild()) return;
  // Berechtigung bei jeder Interaktion erneut prüfen.
  if (!deps.ctx.can(interaction.member, 'announce')) return deps.deny(interaction, 'Ankündigung');

  if (action === 'cancel' && interaction.isStringSelectMenu()) {
    const g = deps.store.guild(interaction.guild.id);
    const id = interaction.values[0];
    const item = (g.scheduled ?? []).find((a) => a.id === id);
    if (!item) return replyPrivate(interaction, { embeds: [embeds.info('Nicht mehr geplant', 'Diese Ankündigung wurde bereits veröffentlicht oder abgebrochen.')] });
    g.scheduled = g.scheduled.filter((a) => a.id !== id);
    deps.store.save();
    await deps.ctx.audit(interaction.guild, 'audit', { title: 'Geplante Ankündigung abgebrochen', fields: [{ name: 'Von', value: `<@${interaction.user.id}>` }, { name: 'Titel', value: item.title }] });
    return replyPrivate(interaction, { embeds: [embeds.success('Abgebrochen', `„${truncate(item.title, 200)}“ wird nicht veröffentlicht.`)] });
  }

  if (action !== 'submit' || !interaction.isModalSubmit()) return;
  const title = interaction.fields.getTextInputValue('title').trim();
  const body = interaction.fields.getTextInputValue('body').trim();
  const link = interaction.fields.getTextInputValue('link').trim();
  if (link && !isHttpsUrl(link)) {
    return replyPrivate(interaction, { embeds: [embeds.error('Ungültiger Link', 'Bitte gib einen vollständigen Link beginnend mit https:// an.')] });
  }
  const data = { title, body, link: link || null, authorName: interaction.member.displayName, authorId: interaction.user.id, ping: pingFlag === '1' };
  const at = Number(atRaw) || 0;
  await interaction.deferReply({ flags: EPHEMERAL });

  if (at) {
    const g = deps.store.guild(interaction.guild.id);
    g.scheduled ??= [];
    g.scheduled.push({ id: crypto.randomUUID().slice(0, 8), at, ...data, createdAt: Date.now() });
    deps.store.save();
    await deps.ctx.audit(interaction.guild, 'audit', { title: 'Ankündigung geplant', fields: [{ name: 'Von', value: `<@${interaction.user.id}>` }, { name: 'Zeitpunkt', value: discordTime(at, 'F') }, { name: 'Titel', value: title }] });
    return replyPrivate(interaction, { embeds: [embeds.success('Ankündigung geplant', `„${truncate(title, 200)}“ erscheint ${discordTime(at, 'F')} (${discordTime(at, 'R')}) in #ankündigungen.\nMit \`/geplant\` siehst du alle geplanten Ankündigungen und kannst sie abbrechen.`)] });
  }

  try {
    const msg = await publishAnnouncement(interaction.guild, data, deps);
    return replyPrivate(interaction, { embeds: [embeds.success('Ankündigung veröffentlicht', msg.url)] });
  } catch (err) {
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht veröffentlicht', err.message)] });
  }
}

module.exports = { prefix: 'announce', handle, announcementModal, announcementCard, publishAnnouncement, scheduledCard, scheduledList };

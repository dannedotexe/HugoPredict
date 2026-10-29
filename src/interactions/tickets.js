'use strict';

const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, ModalBuilder,
  OverwriteType, PermissionFlagsBits: P, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { TICKET_TYPES, BOT_TEXT } = require('../config/serverLayout');
const { embeds, truncate, discordTime } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const theme = require('../config/theme');

const USER_PERMS = [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.AttachFiles, P.EmbedLinks, P.AddReactions];
const STAFF_PERMS = [...USER_PERMS, P.ManageMessages];
const TRANSCRIPT_LIMIT = 2000;

const typeOf = (key) => TICKET_TYPES.find((t) => t.key === key);
const openTicketsOf = (g, userId) => Object.values(g.tickets).filter((t) => t.ownerId === userId && t.status === 'open');

function slug(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'user';
}

/** Darf dieses Mitglied das Ticket als Team bearbeiten? */
function isResponsible(member, ticket, ctx) {
  if (ctx.can(member, 'setup')) return true;
  const type = typeOf(ticket.type);
  return Boolean(type?.roles.some((k) => ctx.hasRoleKey(member, k)));
}

function ticketButtons({ disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hm:ticket:claim').setLabel('Übernehmen').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('hm:ticket:close').setLabel('Anfrage schließen').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

function ticketModal(type) {
  return new ModalBuilder().setCustomId(`hm:ticket:create:${type.key}`).setTitle(truncate(type.label, 45)).addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('subject').setLabel('Betreff').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('details').setLabel('Beschreibung').setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Was ist passiert? Bei Transaktionen bitte Zeitpunkt und Markt angeben – niemals Passwörter.')
        .setMinLength(10).setMaxLength(1500).setRequired(true),
    ),
  );
}

async function openTicket(interaction, deps, type) {
  const g = deps.store.guild(interaction.guild.id);
  if (!g.categories.service) {
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Der Kundenservice ist noch nicht eingerichtet.')] });
  }
  if (openTicketsOf(g, interaction.user.id).length >= deps.env.maxOpenTicketsPerUser) {
    return replyPrivate(interaction, { embeds: [embeds.warning('Offene Anfragen vorhanden', `Du hast bereits ${deps.env.maxOpenTicketsPerUser} offene Anfrage(n). Bitte nutze diese oder schließe sie zuerst.`)] });
  }
  if (!deps.checkRate(interaction, 'ticket')) return;
  return interaction.showModal(ticketModal(type));
}

async function createTicket(interaction, deps, type) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const { guild, user } = interaction;
  const { locked, value } = await deps.locks.run(`ticket-create:${user.id}`, async () => {
    const g = deps.store.guild(guild.id);
    if (openTicketsOf(g, user.id).length >= deps.env.maxOpenTicketsPerUser) return { error: 'Du hast bereits zu viele offene Anfragen.' };

    const subject = interaction.fields.getTextInputValue('subject').trim();
    const details = interaction.fields.getTextInputValue('details').trim();
    const me = guild.members.me;
    const roleIds = type.roles.map((k) => deps.ctx.roleId(guild.id, k)).filter(Boolean);
    const number = ++g.ticketCounter;
    deps.store.save();

    const channel = await guild.channels.create({
      name: `anfrage-${String(number).padStart(4, '0')}-${slug(user.username)}`,
      type: ChannelType.GuildText,
      // Tickets liegen im Bereich KUNDENSERVICE, sind aber nur für Ersteller und Team sichtbar.
      parent: g.categories.service,
      topic: truncate(`${type.label} · ${subject} · Ersteller: ${user.id}`, 1024),
      permissionOverwrites: [
        { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
        { id: me.id, type: OverwriteType.Member, allow: [...BOT_TEXT, P.ManageChannels] },
        { id: user.id, type: OverwriteType.Member, allow: USER_PERMS },
        ...roleIds.map((id) => ({ id, type: OverwriteType.Role, allow: STAFF_PERMS })),
      ],
      reason: `Ticket #${number} von ${user.username}`,
    });

    const ticket = { number, channelId: channel.id, ownerId: user.id, type: type.key, subject, status: 'open', createdAt: new Date().toISOString(), claimedBy: null };
    g.tickets[channel.id] = ticket;
    deps.store.save();

    await channel.send({
      content: [`<@${user.id}>`, ...roleIds.map((id) => `<@&${id}>`)].join(' '),
      embeds: [
        embeds.brand().setTitle(`Anfrage #${number} · ${type.label}`).setDescription(truncate(details, 4000)).addFields(
          { name: 'Betreff', value: truncate(subject, 1024), inline: false },
          { name: 'Erstellt von', value: `<@${user.id}>`, inline: true },
          { name: 'Zuständig', value: roleIds.map((id) => `<@&${id}>`).join(' ') || 'Team', inline: true },
          { name: 'Hinweis', value: 'Das Team fragt niemals nach Passwörtern. Korrekturen von Guthaben erfolgen ausschließlich über die Website.', inline: false },
        ),
      ],
      components: [ticketButtons()],
      allowedMentions: { users: [user.id], roles: roleIds },
    });

    await deps.ctx.audit(guild, 'tickets', {
      title: `Anfrage #${number} eröffnet`,
      fields: [
        { name: 'Typ', value: type.label },
        { name: 'Ersteller', value: `<@${user.id}> (${user.id})` },
        { name: 'Channel', value: `<#${channel.id}>` },
        { name: 'Betreff', value: subject, inline: false },
      ],
    });
    return { channel };
  }).catch((err) => ({ locked: false, value: { error: err.message } }));

  if (locked) return replyPrivate(interaction, { embeds: [embeds.warning('Bitte warten', 'Deine Anfrage wird bereits erstellt.')] });
  if (value.error) {
    deps.logger.warn('Ticket-Erstellung:', value.error);
    return replyPrivate(interaction, { embeds: [embeds.error('Anfrage konnte nicht erstellt werden', truncate(value.error, 500))] });
  }
  return replyPrivate(interaction, { embeds: [embeds.success('Anfrage erstellt', `Deine Anfrage: <#${value.channel.id}>`)] });
}

async function buildTranscript(channel) {
  const all = [];
  let before;
  while (all.length < TRANSCRIPT_LIMIT) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  all.reverse();
  const lines = all.map((m) => {
    const parts = [m.content];
    for (const e of m.embeds) parts.push(`[Embed] ${e.title ?? ''} ${e.description ?? ''}`.trim());
    for (const a of m.attachments.values()) parts.push(`[Anhang] ${a.url}`);
    return `[${m.createdAt.toISOString()}] ${m.author.tag} (${m.author.id}): ${parts.filter(Boolean).join(' | ')}`;
  });
  return { text: lines.join('\n'), count: all.length };
}

async function closeTicket(interaction, deps, ticket) {
  const { guild, channel, user } = interaction;
  const g = deps.store.guild(guild.id);
  const { locked } = await deps.locks.run(`ticket-close:${channel.id}`, async () => {
    if (ticket.status !== 'open') return;
    ticket.status = 'closing';
    deps.store.save();

    await channel.send({ embeds: [embeds.info('Anfrage wird geschlossen', `Geschlossen von <@${user.id}>. Der Verlauf wird protokolliert, der Channel in wenigen Sekunden entfernt.`)], allowedMentions: { parse: [] } });
    let transcript = { text: '', count: 0 };
    try {
      transcript = await buildTranscript(channel);
    } catch (err) {
      deps.logger.warn('Transkript:', err.message);
    }
    const header = `Anfrage #${ticket.number} · Typ: ${ticket.type} · Betreff: ${ticket.subject}\nErsteller: ${ticket.ownerId} · Eröffnet: ${ticket.createdAt} · Geschlossen: ${new Date().toISOString()} von ${user.id}\n\n`;
    const file = new AttachmentBuilder(Buffer.from(header + transcript.text, 'utf8'), { name: `anfrage-${String(ticket.number).padStart(4, '0')}.txt` });

    await deps.ctx.audit(guild, 'tickets', {
      title: `Anfrage #${ticket.number} geschlossen`,
      color: theme.colors.neutral,
      fields: [
        { name: 'Typ', value: typeOf(ticket.type)?.label ?? ticket.type },
        { name: 'Ersteller', value: `<@${ticket.ownerId}>` },
        { name: 'Geschlossen von', value: `<@${user.id}>` },
        { name: 'Übernommen von', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—' },
        { name: 'Eröffnet', value: discordTime(ticket.createdAt) },
        { name: 'Nachrichten', value: String(transcript.count) },
        { name: 'Betreff', value: ticket.subject, inline: false },
      ],
      files: [file],
    });

    ticket.status = 'closed';
    ticket.closedAt = new Date().toISOString();
    ticket.closedBy = user.id;
    // Abgeschlossene Tickets aus dem aktiven Store entfernen (Protokoll liegt im Log-Channel).
    delete g.tickets[channel.id];
    deps.store.save();

    setTimeout(() => {
      channel.delete(`Anfrage #${ticket.number} geschlossen`).catch(async (err) => {
        deps.logger.warn('Ticket-Channel konnte nicht gelöscht werden:', err.message);
        await channel.permissionOverwrites.edit(ticket.ownerId, { ViewChannel: false }).catch(() => {});
      });
    }, 5000).unref?.();
  });
  if (locked) return replyPrivate(interaction, { embeds: [embeds.info('Bereits in Bearbeitung', 'Die Anfrage wird bereits geschlossen.')] });
}

async function handle(interaction, deps, [action, arg]) {
  if (!interaction.inGuild()) return;

  // Auswahlmenü im Ticket-Panel (und Buttons älterer Panels)
  if (action === 'select' && interaction.isStringSelectMenu()) {
    const type = typeOf(interaction.values[0]);
    return type ? openTicket(interaction, deps, type) : undefined;
  }
  if (action === 'open' && interaction.isButton()) {
    const type = typeOf(arg);
    return type ? openTicket(interaction, deps, type) : undefined;
  }
  if (action === 'create' && interaction.isModalSubmit()) {
    const type = typeOf(arg);
    return type ? createTicket(interaction, deps, type) : undefined;
  }

  // Alle weiteren Aktionen nur innerhalb eines registrierten Ticket-Channels.
  const g = deps.store.guild(interaction.guild.id);
  const ticket = g.tickets[interaction.channelId];
  if (!ticket || ticket.status !== 'open') {
    return replyPrivate(interaction, { embeds: [embeds.error('Keine offene Anfrage', 'Dieser Channel gehört zu keiner offenen Anfrage.')] });
  }
  const responsible = isResponsible(interaction.member, ticket, deps.ctx);
  const owner = interaction.user.id === ticket.ownerId;

  if (action === 'claim') {
    if (!responsible) return deps.deny(interaction, 'Anfrage übernehmen');
    if (ticket.claimedBy) {
      return replyPrivate(interaction, { embeds: [embeds.info('Bereits übernommen', `Diese Anfrage wird von <@${ticket.claimedBy}> bearbeitet.`)] });
    }
    ticket.claimedBy = interaction.user.id;
    deps.store.save();
    await deps.ctx.audit(interaction.guild, 'tickets', { title: `Anfrage #${ticket.number} übernommen`, fields: [{ name: 'Von', value: `<@${interaction.user.id}>` }] });
    return interaction.reply({ embeds: [embeds.info('Anfrage übernommen', `<@${interaction.user.id}> bearbeitet dein Anliegen.`)], allowedMentions: { parse: [] } });
  }

  if (action === 'close') {
    if (!responsible && !owner) return deps.deny(interaction, 'Anfrage schließen');
    if (!deps.env.ticketCloseConfirmation) {
      await interaction.deferReply({ flags: EPHEMERAL });
      await closeTicket(interaction, deps, ticket);
      return interaction.editReply({ embeds: [embeds.success('Anfrage geschlossen')] }).catch(() => {});
    }
    return replyPrivate(interaction, {
      embeds: [embeds.warning('Anfrage schließen?', 'Der Verlauf wird protokolliert und der Channel anschließend entfernt.')],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hm:ticket:confirmclose').setLabel('Endgültig schließen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('hm:ticket:cancelclose').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      )],
    });
  }

  if (action === 'confirmclose') {
    if (!responsible && !owner) return deps.deny(interaction, 'Anfrage schließen');
    await interaction.update({ embeds: [embeds.info('Anfrage wird geschlossen …')], components: [] });
    return closeTicket(interaction, deps, ticket);
  }
  if (action === 'cancelclose') {
    return interaction.update({ embeds: [embeds.info('Abgebrochen', 'Die Anfrage bleibt geöffnet.')], components: [] });
  }
}

module.exports = { prefix: 'ticket', handle, isResponsible, slug, ticketModal };

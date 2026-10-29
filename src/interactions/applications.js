'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, truncate, discordTime } = require('../lib/embeds');
const { card, quote, upsert } = require('../lib/ui');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const { APPLICATION_POSITIONS } = require('../config/serverLayout');
const theme = require('../config/theme');
const { emojis, withEmoji } = require('../lib/emojis');

/*
 * Team-Bewerbungen: Stelle im Panel in #bewerben wählen → Formular →
 * Bewerbung landet in #bewerbungen (nur Inhaber und Administrator) →
 * Annehmen (Rolle wird vergeben) oder Ablehnen mit Begründung →
 * Direktnachricht an die Person. Pro Person eine offene Bewerbung, nach
 * einer Ablehnung 14 Tage Pause.
 */

const REAPPLY_MS = 14 * 24 * 60 * 60_000;

const STATUS = {
  open: { label: 'Offen', color: theme.colors.neutral, icon: 'closed' },
  accepted: { label: 'Angenommen', color: theme.colors.success, icon: 'resolved' },
  rejected: { label: 'Abgelehnt', color: theme.colors.danger, icon: 'error' },
};

const position = (key) => APPLICATION_POSITIONS.find((p) => p.key === key);

function applicationModal(pos) {
  const input = (id, label, style, { max, min = 1, required = true, placeholder } = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setMinLength(min).setRequired(required);
    if (placeholder) t.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(t);
  };
  return new ModalBuilder().setCustomId(`hm:apply:submit:${pos.key}`).setTitle(truncate(`Bewerbung: ${pos.label}`, 45)).addComponents(
    input('age', 'Wie alt bist du?', TextInputStyle.Short, { max: 3, placeholder: 'z. B. 16' }),
    input('minecraft', 'Dein Minecraft-Name', TextInputStyle.Short, { max: 16, min: 3 }),
    input('why', 'Warum möchtest du ins Team?', TextInputStyle.Paragraph, { max: 1000, min: 30 }),
    input('experience', 'Erfahrung (Discord, Support, Minecraft)', TextInputStyle.Paragraph, { max: 1000, required: false }),
    input('time', 'Wie viel Zeit hast du pro Woche?', TextInputStyle.Short, { max: 100, placeholder: 'z. B. 5 Stunden, meist abends' }),
  );
}

function applicationCard(a) {
  const st = STATUS[a.status];
  const pos = position(a.position);
  const blocks = [
    { heading: 'Eckdaten', body: `Alter: **${truncate(a.age, 3)}**\nMinecraft: **${truncate(a.minecraft, 16)}**\nZeit pro Woche: ${truncate(a.time, 100)}` },
    { heading: 'Warum ins Team?', body: quote(truncate(a.why, 1000)), quote: false },
    { heading: 'Erfahrung', body: a.experience ? quote(truncate(a.experience, 1000)) : '—', quote: false },
    { heading: 'Person', body: `<@${a.userId}> (${a.username})\nAuf dem Server seit ${a.joinedAt ? discordTime(a.joinedAt, 'R') : '—'}` },
  ];
  if (a.decision) blocks.push({ heading: 'Entscheidung', icon: st.icon, body: [`${st.label} von <@${a.decision.by}>`, a.decision.reason, a.decision.note].filter(Boolean).join('\n') });
  const closed = a.status !== 'open';
  return card({
    eyebrow: `${emojis.icon(st.icon)}Bewerbung #${a.number} · ${st.label}`,
    title: `${pos?.label ?? a.position} · ${truncate(a.username, 60)}`,
    accent: st.color,
    logo: false,
    blocks,
    actions: [new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`hm:apply:accept:${a.id}`).setLabel('Annehmen').setStyle(ButtonStyle.Success).setDisabled(closed), 'check'),
      withEmoji(new ButtonBuilder().setCustomId(`hm:apply:reject:${a.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Secondary).setDisabled(closed), 'error'),
    )],
    footer: `Eingegangen ${discordTime(a.createdAt, 'f')}`,
  });
}

/** Prüft, ob sich die Person für die Stelle bewerben darf. Gibt eine Fehlermeldung oder null zurück. */
function blockReason(member, pos, g, deps, now = Date.now()) {
  if (!deps.ctx.hasRoleKey(member, 'member')) return ['Erst die Regeln akzeptieren', 'Akzeptiere zuerst die Regeln in #regeln, dann kannst du dich bewerben.'];
  if (deps.ctx.hasRoleKey(member, pos.role)) return ['Schon im Team', `Du hast die Rolle für **${pos.label}** bereits.`];
  const mine = Object.values(g.applications).filter((a) => a.userId === member.id);
  if (mine.some((a) => a.status === 'open')) return ['Bewerbung läuft', 'Du hast schon eine offene Bewerbung. Wir melden uns per Direktnachricht.'];
  const lastReject = mine.filter((a) => a.status === 'rejected').map((a) => Date.parse(a.decision.at)).sort().at(-1);
  if (lastReject && now - lastReject < REAPPLY_MS) return ['Bitte noch warten', `Nach einer Ablehnung kannst du dich ${discordTime(new Date(lastReject + REAPPLY_MS), 'R')} erneut bewerben.`];
  return null;
}

async function submit(interaction, deps, pos) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const g = deps.store.guild(interaction.guild.id);
  const blocked = blockReason(interaction.member, pos, g, deps);
  if (blocked) return replyPrivate(interaction, { embeds: [embeds.warning(...blocked)] });
  const review = await deps.ctx.channel(interaction.guild, 'applications');
  if (!review?.isTextBased()) return replyPrivate(interaction, { embeds: [embeds.error('Derzeit nicht möglich', 'Bewerbungen sind noch nicht eingerichtet.')] });

  const f = (id) => interaction.fields.getTextInputValue(id).trim();
  const number = ++g.applicationCounter;
  const a = {
    id: `${Date.now().toString(36)}${number}`,
    number,
    position: pos.key,
    userId: interaction.user.id,
    username: interaction.user.username,
    joinedAt: interaction.member.joinedAt?.toISOString?.() ?? null,
    age: f('age'),
    minecraft: f('minecraft'),
    why: f('why'),
    experience: f('experience'),
    time: f('time'),
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  const msg = await review.send({ ...applicationCard(a), allowedMentions: { parse: [] } });
  a.reviewMessage = { channelId: review.id, messageId: msg.id };
  g.applications[a.id] = a;
  deps.store.save();
  return replyPrivate(interaction, {
    embeds: [embeds.success('Bewerbung eingereicht', `Danke für deine Bewerbung als **${pos.label}**! Das Team schaut sie sich an und meldet sich per Direktnachricht. Lass deine DMs für diesen Server offen.`)],
  });
}

function reasonModal(a, kind) {
  return new ModalBuilder().setCustomId(`hm:apply:${kind}modal:${a.id}`).setTitle(kind === 'accept' ? 'Bewerbung annehmen' : 'Bewerbung ablehnen').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel(kind === 'accept' ? 'Nachricht an die Person (optional)' : 'Begründung')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(kind !== 'accept'),
    ),
  );
}

async function decide(interaction, deps, a, kind) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const pos = position(a.position);
  const { locked, value } = await deps.locks.run(`application:${a.id}`, async () => {
    if (a.status !== 'open') return { already: true };
    let note = null;
    if (kind === 'accept') {
      const roleId = deps.ctx.roleId(interaction.guild.id, pos?.role);
      const member = await interaction.guild.members.fetch(a.userId).catch(() => null);
      if (!member) note = 'Die Person ist nicht mehr auf dem Server, die Rolle wurde nicht vergeben.';
      else if (!roleId) note = 'Die Rolle existiert nicht, bitte von Hand vergeben.';
      else {
        try {
          await member.roles.add(roleId, `Bewerbung #${a.number} angenommen von ${interaction.user.username}`);
          note = `Rolle <@&${roleId}> vergeben.`;
        } catch (err) {
          note = `Rolle konnte nicht vergeben werden (${err.message}). Bitte von Hand vergeben.`;
        }
      }
    }
    a.status = kind === 'accept' ? 'accepted' : 'rejected';
    a.decision = { by: interaction.user.id, at: new Date().toISOString(), reason: reason || null, note };
    deps.store.save();
    const ch = interaction.guild.channels.cache.get(a.reviewMessage?.channelId);
    if (ch?.isTextBased()) {
      const msg = await upsert(ch, a.reviewMessage, { ...applicationCard(a), allowedMentions: { parse: [] } }).catch(() => null);
      if (msg) a.reviewMessage = { channelId: ch.id, messageId: msg.id };
    }
    deps.store.save();
    await notifyApplicant(interaction.client, a, pos);
    await deps.ctx.audit(interaction.guild, 'audit', {
      title: `Bewerbung #${a.number} ${kind === 'accept' ? 'angenommen' : 'abgelehnt'}`,
      fields: [{ name: 'Person', value: `<@${a.userId}>` }, { name: 'Stelle', value: pos?.label ?? a.position }, { name: 'Von', value: `<@${interaction.user.id}>` }],
    });
    return { ok: true, note };
  });
  if (locked) return replyPrivate(interaction, { embeds: [embeds.info('Bitte warten', 'Diese Bewerbung wird gerade bearbeitet.')] });
  if (value.already) return replyPrivate(interaction, { embeds: [embeds.info('Bereits entschieden', 'Über diese Bewerbung wurde schon entschieden.')] });
  return replyPrivate(interaction, {
    embeds: [embeds.success(kind === 'accept' ? 'Bewerbung angenommen' : 'Bewerbung abgelehnt', [value.note, 'Die Person wurde per Direktnachricht informiert.'].filter(Boolean).join('\n'))],
  });
}

async function notifyApplicant(client, a, pos) {
  const user = await client.users.fetch(a.userId).catch(() => null);
  if (!user) return;
  const accepted = a.status === 'accepted';
  const payload = card({
    eyebrow: `${emojis.icon(STATUS[a.status].icon)}Bewerbung #${a.number}`,
    title: accepted ? 'Willkommen im Team!' : 'Deine Bewerbung',
    accent: STATUS[a.status].color,
    intro: accepted
      ? `Deine Bewerbung als **${pos?.label ?? a.position}** wurde angenommen.`
      : `Deine Bewerbung als **${pos?.label ?? a.position}** wurde leider abgelehnt. In 14 Tagen kannst du dich erneut bewerben.`,
    blocks: [a.decision.reason && { heading: accepted ? 'Nachricht vom Team' : 'Begründung', body: truncate(a.decision.reason, 1000) }],
  });
  await user.send(payload).catch(() => {}); // DMs können deaktiviert sein
}

async function handle(interaction, deps, [action, id]) {
  if (!interaction.inGuild()) return;
  if (action === 'select' && interaction.isStringSelectMenu()) {
    const pos = position(interaction.values[0]);
    if (!pos) return;
    if (!deps.checkRate(interaction, 'apply')) return;
    const blocked = blockReason(interaction.member, pos, deps.store.guild(interaction.guild.id), deps);
    if (blocked) return replyPrivate(interaction, { embeds: [embeds.warning(...blocked)] });
    return interaction.showModal(applicationModal(pos));
  }
  if (action === 'submit' && interaction.isModalSubmit()) {
    const pos = position(id);
    if (pos) return submit(interaction, deps, pos);
    return;
  }

  const a = deps.store.guild(interaction.guild.id).applications[id];
  if (!a) return replyPrivate(interaction, { embeds: [embeds.error('Nicht gefunden', 'Diese Bewerbung existiert nicht mehr.')] });
  if (!deps.ctx.can(interaction.member, 'applications')) return deps.deny(interaction, 'Bewerbung entscheiden');
  if ((action === 'accept' || action === 'reject') && interaction.isButton()) {
    if (a.status !== 'open') return replyPrivate(interaction, { embeds: [embeds.info('Bereits entschieden', STATUS[a.status].label)] });
    return interaction.showModal(reasonModal(a, action));
  }
  if (action === 'acceptmodal' && interaction.isModalSubmit()) return decide(interaction, deps, a, 'accept');
  if (action === 'rejectmodal' && interaction.isModalSubmit()) return decide(interaction, deps, a, 'reject');
}

module.exports = { prefix: 'apply', handle, applicationModal, applicationCard, blockReason, decide, submit };

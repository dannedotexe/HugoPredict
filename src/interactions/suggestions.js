'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, truncate } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { userMessage } = require('../lib/hugoApi');
const theme = require('../config/theme');

/*
 * Ablauf: Vorschlag (Modal) → öffentliche Abstimmung in #community-votes →
 * Prüfung durch Market Moderatoren in #markt-entscheidungen → Annahme/Ablehnung.
 * Eine Annahme legt den Markt nur an, wenn die Website-API konfiguriert UND
 * MARKET_CREATION_ENABLED=true ist. Stimmen erstellen niemals automatisch Märkte.
 */

const STATUS = {
  open: { label: 'Abstimmung läuft', color: theme.colors.neutral },
  accepted: { label: 'Angenommen', color: theme.colors.success },
  rejected: { label: 'Abgelehnt', color: theme.colors.danger },
};

function suggestionModal() {
  const input = (id, label, style, { max, min = 1, required = true, placeholder } = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setMinLength(min).setRequired(required);
    if (placeholder) t.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(t);
  };
  return new ModalBuilder().setCustomId('hm:suggest:submit').setTitle('Neuen Markt vorschlagen').addComponents(
    input('title', 'Titel / Frage', TextInputStyle.Short, { max: 120, min: 10, placeholder: 'Gewinnt Fraktion X das Event am Samstag?' }),
    input('description', 'Beschreibung & Regeln', TextInputStyle.Paragraph, { max: 1000, min: 20 }),
    input('outcomes', 'Mögliche Ergebnisse', TextInputStyle.Short, { max: 200, placeholder: 'Ja / Nein' }),
    input('source', 'Entscheidungsquelle', TextInputStyle.Short, { max: 200, placeholder: 'z. B. offizieller Event-Post in #hugo-news' }),
    input('closes', 'Gewünschtes Ende (optional)', TextInputStyle.Short, { max: 50, required: false, placeholder: 'z. B. 31.12.2026 20:00' }),
  );
}

function suggestionEmbed(s) {
  const st = STATUS[s.status];
  const e = embeds.base(st.color)
    .setTitle(truncate(`Vorschlag #${s.number} · ${s.title}`, 256))
    .setDescription(truncate(s.description, 4000))
    .addFields(
      { name: 'Ergebnisse', value: truncate(s.outcomes, 1024), inline: false },
      { name: 'Entscheidungsquelle', value: truncate(s.source, 1024), inline: false },
      { name: 'Gewünschtes Ende', value: s.closes || '—', inline: true },
      { name: 'Eingereicht von', value: `<@${s.authorId}>`, inline: true },
      { name: 'Stimmen', value: `Dafür **${Object.values(s.votes).filter((v) => v === 'up').length}** · Dagegen **${Object.values(s.votes).filter((v) => v === 'down').length}**`, inline: true },
      { name: 'Status', value: st.label, inline: true },
    );
  if (s.decision) {
    e.addFields({ name: 'Entscheidung', value: truncate([`von <@${s.decision.by}>`, s.decision.reason, s.decision.websiteNote].filter(Boolean).join('\n'), 1024), inline: false });
  }
  return e;
}

function voteRow(s) {
  const closed = s.status !== 'open';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hm:suggest:vote:${s.id}:up`).setLabel('Dafür').setStyle(ButtonStyle.Success).setDisabled(closed),
    new ButtonBuilder().setCustomId(`hm:suggest:vote:${s.id}:down`).setLabel('Dagegen').setStyle(ButtonStyle.Secondary).setDisabled(closed),
  );
}

function decisionRow(s) {
  const closed = s.status !== 'open';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hm:suggest:accept:${s.id}`).setLabel('Annehmen').setStyle(ButtonStyle.Success).setDisabled(closed),
    new ButtonBuilder().setCustomId(`hm:suggest:reject:${s.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger).setDisabled(closed),
  );
}

async function refreshMessages(guild, s, deps) {
  const update = async (ref, components) => {
    if (!ref) return;
    const ch = guild.channels.cache.get(ref.channelId) ?? (await guild.channels.fetch(ref.channelId).catch(() => null));
    const msg = ch?.isTextBased() ? await ch.messages.fetch(ref.messageId).catch(() => null) : null;
    if (msg) await msg.edit({ embeds: [suggestionEmbed(s)], components, allowedMentions: { parse: [] } });
  };
  await update(s.publicMessage, [voteRow(s)]);
  await update(s.reviewMessage, [decisionRow(s)]);
}

async function submit(interaction, deps) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const g = deps.store.guild(interaction.guild.id);
  const voteChannel = await deps.ctx.channel(interaction.guild, 'communityVotes');
  if (!voteChannel?.isTextBased()) {
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Der Abstimmungs-Channel existiert noch nicht.')] });
  }
  const f = (id) => interaction.fields.getTextInputValue(id).trim();
  const number = ++g.suggestionCounter;
  const s = {
    id: `${Date.now().toString(36)}${number}`,
    number,
    authorId: interaction.user.id,
    title: f('title'),
    description: f('description'),
    outcomes: f('outcomes'),
    source: f('source'),
    closes: f('closes'),
    status: 'open',
    votes: {},
    createdAt: new Date().toISOString(),
  };
  const pub = await voteChannel.send({ embeds: [suggestionEmbed(s)], components: [voteRow(s)], allowedMentions: { parse: [] } });
  s.publicMessage = { channelId: voteChannel.id, messageId: pub.id };

  const review = await deps.ctx.channel(interaction.guild, 'marketDecisions');
  if (review?.isTextBased()) {
    const msg = await review.send({ content: `Neuer Marktvorschlag: ${pub.url}`, embeds: [suggestionEmbed(s)], components: [decisionRow(s)], allowedMentions: { parse: [] } });
    s.reviewMessage = { channelId: review.id, messageId: msg.id };
  }
  g.suggestions[s.id] = s;
  deps.store.save();
  return replyPrivate(interaction, { embeds: [embeds.success('Vorschlag eingereicht', `Die Community kann jetzt abstimmen: ${pub.url}`)] });
}

async function vote(interaction, deps, s, direction) {
  if (s.status !== 'open') return replyPrivate(interaction, { embeds: [embeds.info('Abstimmung beendet', 'Über diesen Vorschlag wurde bereits entschieden.')] });
  if (!deps.ctx.hasRoleKey(interaction.member, 'member') && !deps.ctx.hasRoleKey(interaction.member, 'verified')) {
    return replyPrivate(interaction, { embeds: [embeds.warning('Nicht berechtigt', 'Bitte akzeptiere zuerst die Regeln, um abzustimmen.')] });
  }
  const uid = interaction.user.id;
  let message;
  if (s.votes[uid] === direction) {
    delete s.votes[uid];
    message = 'Deine Stimme wurde zurückgezogen.';
  } else {
    s.votes[uid] = direction;
    message = direction === 'up' ? 'Du hast **dafür** gestimmt.' : 'Du hast **dagegen** gestimmt.';
  }
  deps.store.save();
  await interaction.update({ embeds: [suggestionEmbed(s)], components: [voteRow(s)] });
  await interaction.followUp({ content: message, flags: EPHEMERAL });
  // Review-Kopie aktualisieren (Stimmenstand)
  if (s.reviewMessage) refreshMessages(interaction.guild, s, deps).catch(() => {});
}

function reasonModal(s, kind) {
  return new ModalBuilder().setCustomId(`hm:suggest:${kind}modal:${s.id}`).setTitle(kind === 'accept' ? 'Vorschlag annehmen' : 'Vorschlag ablehnen').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel(kind === 'accept' ? 'Notiz (optional)' : 'Begründung')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(kind !== 'accept'),
    ),
  );
}

async function decide(interaction, deps, s, kind) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const { locked, value } = await deps.locks.run(`suggestion:${s.id}`, async () => {
    if (s.status !== 'open') return { already: true };
    let websiteNote = null;
    let website = null;

    if (kind === 'accept') {
      if (deps.api.configured && deps.env.marketCreationEnabled) {
        try {
          website = await deps.api.createMarketProposal({
            title: s.title,
            description: s.description,
            outcomes: s.outcomes.split(/\s*[/,;|]\s*/).filter(Boolean).slice(0, 10),
            resolutionSource: s.source,
            requestedCloseAt: s.closes || null,
            proposedByDiscordId: s.authorId,
            approvedByDiscordId: interaction.user.id,
            discordSuggestionId: s.id,
            votes: { up: Object.values(s.votes).filter((v) => v === 'up').length, down: Object.values(s.votes).filter((v) => v === 'down').length },
          }, `discord-suggestion:${s.id}`);
          websiteNote = website.url ? `Auf der Website angelegt: ${website.url}` : `Auf der Website angelegt (ID ${website.id}).`;
        } catch (err) {
          // Status bleibt "open": Ohne bestätigte Anlage wird nichts als erfolgreich gemeldet.
          return { apiError: err };
        }
      } else {
        websiteNote = 'Manuelle Anlage auf der Website erforderlich (automatische Marktanlage ist nicht aktiviert).';
      }
    }

    s.status = kind === 'accept' ? 'accepted' : 'rejected';
    s.decision = { by: interaction.user.id, at: new Date().toISOString(), reason: reason || null, websiteNote, websiteId: website?.id ?? null };
    deps.store.save();
    await refreshMessages(interaction.guild, s, deps);

    if (kind === 'reject') {
      const ch = await deps.ctx.channel(interaction.guild, 'rejectedMarkets');
      if (ch?.isTextBased()) await ch.send({ embeds: [suggestionEmbed(s)], allowedMentions: { parse: [] } });
    }
    await deps.ctx.audit(interaction.guild, 'marketDecisions', {
      title: `Vorschlag #${s.number} ${kind === 'accept' ? 'angenommen' : 'abgelehnt'}`,
      fields: [
        { name: 'Von', value: `<@${interaction.user.id}>` },
        { name: 'Website', value: websiteNote ?? '—', inline: false },
        { name: 'Begründung', value: reason || '—', inline: false },
      ],
    });
    return { ok: true, websiteNote };
  });

  if (locked) return replyPrivate(interaction, { embeds: [embeds.info('Bitte warten', 'Dieser Vorschlag wird gerade bearbeitet.')] });
  if (value.already) return replyPrivate(interaction, { embeds: [embeds.info('Bereits entschieden', 'Über diesen Vorschlag wurde bereits entschieden.')] });
  if (value.apiError) {
    return replyApiError(interaction, value.apiError, { ...deps, action: 'Marktanlage' })
      .then(() => interaction.followUp({ content: `Der Vorschlag bleibt offen. Fehler: ${userMessage(value.apiError)}`, flags: EPHEMERAL }));
  }
  return replyPrivate(interaction, {
    embeds: [embeds.success(kind === 'accept' ? 'Vorschlag angenommen' : 'Vorschlag abgelehnt', value.websiteNote ?? 'Die Entscheidung wurde veröffentlicht.')],
  });
}

async function handle(interaction, deps, [action, id, extra]) {
  if (!interaction.inGuild()) return;
  if (action === 'open' && interaction.isButton()) {
    if (!deps.checkRate(interaction, 'suggest')) return;
    return interaction.showModal(suggestionModal());
  }
  if (action === 'submit' && interaction.isModalSubmit()) return submit(interaction, deps);

  const s = deps.store.guild(interaction.guild.id).suggestions[id];
  if (!s) return replyPrivate(interaction, { embeds: [embeds.error('Nicht gefunden', 'Dieser Vorschlag existiert nicht mehr.')] });

  if (action === 'vote' && interaction.isButton() && ['up', 'down'].includes(extra)) {
    if (!deps.checkRate(interaction, 'vote')) return;
    return vote(interaction, deps, s, extra);
  }

  // Ab hier nur Market Moderatoren / Leitung
  if (!deps.ctx.can(interaction.member, 'marketDecision')) return deps.deny(interaction, 'Marktentscheidung');
  if ((action === 'accept' || action === 'reject') && interaction.isButton()) {
    if (s.status !== 'open') return replyPrivate(interaction, { embeds: [embeds.info('Bereits entschieden', STATUS[s.status].label)] });
    return interaction.showModal(reasonModal(s, action));
  }
  if (action === 'acceptmodal' && interaction.isModalSubmit()) return decide(interaction, deps, s, 'accept');
  if (action === 'rejectmodal' && interaction.isModalSubmit()) return decide(interaction, deps, s, 'reject');
}

module.exports = { prefix: 'suggest', handle, suggestionModal, suggestionEmbed };

'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embeds, truncate } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { userMessage } = require('../lib/hugoApi');
const theme = require('../config/theme');
const { withEmoji } = require('../lib/emojis');

/*
 * Ablauf: /vorschlag (Modal) → Prüfung durch die Marktverwaltung in #betrieb →
 * Annahme oder Ablehnung mit Begründung → Benachrichtigung per Direktnachricht.
 * Eine Annahme legt den Markt nur an, wenn die Website-API konfiguriert UND
 * MARKET_CREATION_ENABLED=true ist; sonst wird die manuelle Anlage vermerkt.
 */

const STATUS = {
  open: { label: 'In Prüfung', color: theme.colors.neutral },
  accepted: { label: 'Angenommen', color: theme.colors.success },
  rejected: { label: 'Abgelehnt', color: theme.colors.danger },
};

function suggestionModal() {
  const input = (id, label, style, { max, min = 1, required = true, placeholder } = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setMinLength(min).setRequired(required);
    if (placeholder) t.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(t);
  };
  return new ModalBuilder().setCustomId('hm:suggest:submit').setTitle('Markt vorschlagen').addComponents(
    input('title', 'Fragestellung', TextInputStyle.Short, { max: 120, min: 10, placeholder: 'Gewinnt Team Nord das Turnier am 14.11.?' }),
    input('description', 'Beschreibung und Regeln', TextInputStyle.Paragraph, { max: 1000, min: 20 }),
    input('outcomes', 'Mögliche Ergebnisse', TextInputStyle.Short, { max: 200, placeholder: 'Ja / Nein' }),
    input('source', 'Entscheidungsquelle', TextInputStyle.Short, { max: 200, placeholder: 'z. B. offizielle Ergebnisseite des Events' }),
    input('closes', 'Gewünschter Handelsschluss (optional)', TextInputStyle.Short, { max: 50, required: false, placeholder: 'z. B. 14.11.2026, 20:00 Uhr' }),
  );
}

function suggestionEmbed(s) {
  const st = STATUS[s.status];
  const e = embeds.base(st.color)
    .setAuthor({ name: `Marktvorschlag #${s.number} · ${st.label}` })
    .setTitle(truncate(s.title, 256))
    .setDescription(truncate(s.description, 4000))
    .addFields(
      { name: 'Ergebnisse', value: truncate(s.outcomes, 1024), inline: false },
      { name: 'Entscheidungsquelle', value: truncate(s.source, 1024), inline: false },
      { name: 'Handelsschluss', value: s.closes || '—', inline: true },
      { name: 'Eingereicht von', value: `<@${s.authorId}>`, inline: true },
    );
  if (s.decision) {
    e.addFields({ name: 'Entscheidung', value: truncate([`von <@${s.decision.by}>`, s.decision.reason, s.decision.websiteNote].filter(Boolean).join('\n'), 1024), inline: false });
  }
  return e;
}

function decisionRow(s) {
  const closed = s.status !== 'open';
  return new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`hm:suggest:accept:${s.id}`).setLabel('Annehmen').setStyle(ButtonStyle.Success).setDisabled(closed), 'check'),
    withEmoji(new ButtonBuilder().setCustomId(`hm:suggest:reject:${s.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Secondary).setDisabled(closed), 'error'),
  );
}

async function refreshReview(guild, s) {
  const ref = s.reviewMessage;
  if (!ref) return;
  const ch = guild.channels.cache.get(ref.channelId) ?? (await guild.channels.fetch(ref.channelId).catch(() => null));
  const msg = ch?.isTextBased() ? await ch.messages.fetch(ref.messageId).catch(() => null) : null;
  if (msg) await msg.edit({ embeds: [suggestionEmbed(s)], components: [decisionRow(s)], allowedMentions: { parse: [] } });
}

async function submit(interaction, deps) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const g = deps.store.guild(interaction.guild.id);
  const review = await deps.ctx.channel(interaction.guild, 'operations');
  if (!review?.isTextBased()) {
    return replyPrivate(interaction, { embeds: [embeds.error('Derzeit nicht möglich', 'Marktvorschläge sind noch nicht eingerichtet.')] });
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
    createdAt: new Date().toISOString(),
  };
  const msg = await review.send({ embeds: [suggestionEmbed(s)], components: [decisionRow(s)], allowedMentions: { parse: [] } });
  s.reviewMessage = { channelId: review.id, messageId: msg.id };
  g.suggestions[s.id] = s;
  deps.store.save();
  return replyPrivate(interaction, {
    embeds: [embeds.success('Vorschlag eingereicht', `Vielen Dank. Die Marktverwaltung prüft deinen Vorschlag #${number}. Über die Entscheidung informieren wir dich per Direktnachricht.`)],
  });
}

function reasonModal(s, kind) {
  return new ModalBuilder().setCustomId(`hm:suggest:${kind}modal:${s.id}`).setTitle(kind === 'accept' ? 'Vorschlag annehmen' : 'Vorschlag ablehnen').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel(kind === 'accept' ? 'Notiz (optional)' : 'Begründung')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(kind !== 'accept'),
    ),
  );
}

async function notifyAuthor(client, s) {
  const user = await client.users.fetch(s.authorId).catch(() => null);
  if (!user) return;
  const accepted = s.status === 'accepted';
  const e = embeds.base(STATUS[s.status].color)
    .setTitle(`Dein Marktvorschlag #${s.number} wurde ${accepted ? 'angenommen' : 'abgelehnt'}`)
    .setDescription(truncate(s.title, 4000));
  if (s.decision.reason) e.addFields({ name: accepted ? 'Notiz' : 'Begründung', value: truncate(s.decision.reason, 1024), inline: false });
  await user.send({ embeds: [e] }).catch(() => {}); // DMs können deaktiviert sein
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
          }, `discord-suggestion:${s.id}`);
          websiteNote = website.url ? `Auf der Website angelegt: ${website.url}` : `Auf der Website angelegt (ID ${website.id}).`;
        } catch (err) {
          // Ohne bestätigte Anlage bleibt der Vorschlag offen.
          return { apiError: err };
        }
      } else {
        websiteNote = 'Manuelle Anlage auf der Website erforderlich.';
      }
    }

    s.status = kind === 'accept' ? 'accepted' : 'rejected';
    s.decision = { by: interaction.user.id, at: new Date().toISOString(), reason: reason || null, websiteNote, websiteId: website?.id ?? null };
    deps.store.save();
    await refreshReview(interaction.guild, s);
    await notifyAuthor(interaction.client, s);
    return { ok: true, websiteNote };
  });

  if (locked) return replyPrivate(interaction, { embeds: [embeds.info('Bitte warten', 'Dieser Vorschlag wird gerade bearbeitet.')] });
  if (value.already) return replyPrivate(interaction, { embeds: [embeds.info('Bereits entschieden', 'Über diesen Vorschlag wurde bereits entschieden.')] });
  if (value.apiError) {
    await replyApiError(interaction, value.apiError, { ...deps, action: 'Marktanlage' });
    return interaction.followUp({ content: `Der Vorschlag bleibt offen. Grund: ${userMessage(value.apiError)}`, flags: EPHEMERAL });
  }
  return replyPrivate(interaction, {
    embeds: [embeds.success(kind === 'accept' ? 'Vorschlag angenommen' : 'Vorschlag abgelehnt', value.websiteNote ?? 'Die einreichende Person wurde informiert.')],
  });
}

async function handle(interaction, deps, [action, id]) {
  if (!interaction.inGuild()) return;
  if (action === 'open' && interaction.isButton()) {
    if (!deps.checkRate(interaction, 'suggest')) return;
    return interaction.showModal(suggestionModal());
  }
  if (action === 'submit' && interaction.isModalSubmit()) return submit(interaction, deps);
  // Abstimmungs-Buttons der früheren Struktur
  if (action === 'vote') {
    return replyPrivate(interaction, { embeds: [embeds.info('Abstimmung beendet', 'Öffentliche Abstimmungen über Marktvorschläge finden nicht mehr statt.')] });
  }

  const s = deps.store.guild(interaction.guild.id).suggestions[id];
  if (!s) return replyPrivate(interaction, { embeds: [embeds.error('Nicht gefunden', 'Dieser Vorschlag existiert nicht mehr.')] });

  // Ab hier nur Marktverwaltung und Leitung
  if (!deps.ctx.can(interaction.member, 'marketDecision')) return deps.deny(interaction, 'Marktentscheidung');
  if ((action === 'accept' || action === 'reject') && interaction.isButton()) {
    if (s.status !== 'open') return replyPrivate(interaction, { embeds: [embeds.info('Bereits entschieden', STATUS[s.status].label)] });
    return interaction.showModal(reasonModal(s, action));
  }
  if (action === 'acceptmodal' && interaction.isModalSubmit()) return decide(interaction, deps, s, 'accept');
  if (action === 'rejectmodal' && interaction.isModalSubmit()) return decide(interaction, deps, s, 'reject');
}

module.exports = { prefix: 'suggest', handle, suggestionModal, suggestionEmbed };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  AttachmentBuilder, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize,
  TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const theme = require('../config/theme');
const { emojis } = require('./emojis');

/*
 * Einheitliches Kartendesign auf Basis von Discord Components V2:
 * Container mit Akzentleiste, große Überschrift mit Logo, Abschnitte mit
 * Trennlinien, eingerückte Listen, kleine Fußzeile und Buttons in der Karte.
 */

const LOGO_FILE = path.join(__dirname, '..', '..', 'assets', 'brand', 'logo.png');
const LOGO_NAME = 'hugopredict.png';
const TEXT_LIMIT = 4000; // Discord: Summe aller Textbausteine einer Nachricht

const quote = (text) => String(text).split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');

/**
 * Baut eine Karte.
 * @param {object} o
 * @param {string} o.title        Große Überschrift
 * @param {string} [o.icon]       Emoji-Schlüssel vor der Überschrift
 * @param {string} [o.intro]      Text unter der Überschrift
 * @param {string} [o.eyebrow]    Kleine Zeile über der Überschrift (z. B. „Markt · Offen“)
 * @param {number} [o.accent]     Farbe der Akzentleiste
 * @param {boolean} [o.logo]      Logo oben rechts anzeigen (Standard: true)
 * @param {Array}  [o.blocks]     Abschnitte: { heading, icon, body, quote } oder { text }
 * @param {Array}  [o.actions]    ActionRowBuilder-Zeilen (Buttons/Auswahlmenüs) am Ende der Karte
 * @param {string|null} [o.footer] Fußzeile (klein); null = keine
 * @param {boolean} [o.ephemeral] Nur für die anfragende Person sichtbar
 * @param {'lg'|'md'} [o.size]   Überschriftgröße: lg für Panels, md für Einzelkarten
 */
function card({ title, icon, intro, eyebrow, accent = theme.colors.primary, logo = true, blocks = [], actions = [], footer, ephemeral = false, size = 'md' }) {
  const container = new ContainerBuilder().setAccentColor(accent);
  const head = [
    eyebrow ? `-# ${eyebrow}` : null,
    `${size === 'lg' ? '#' : '##'} ${icon ? emojis.icon(icon) : ''}${title}`,
    intro || null,
  ].filter(Boolean).join('\n');

  const withLogo = logo && fs.existsSync(LOGO_FILE);
  if (withLogo) {
    container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${LOGO_NAME}`).setDescription(theme.brand)));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
  }

  for (const b of blocks.filter(Boolean)) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const heading = b.heading ? `### ${b.icon ? emojis.icon(b.icon) : ''}${b.heading}\n` : '';
    const body = b.text ?? (b.quote === false ? b.body : quote(b.body));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${heading}${body}`));
  }

  const foot = footer === null ? null : `-# ${theme.brand}${footer ? ` · ${footer}` : ''}`;
  if (foot || actions.length) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  if (foot) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(foot));
  for (const row of actions) container.addActionRowComponents(row);

  return {
    components: [container],
    files: withLogo ? [new AttachmentBuilder(LOGO_FILE, { name: LOGO_NAME })] : [],
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] },
  };
}

/** Summe der Textlänge einer Karte (für Tests und Limit-Prüfung). */
function textLength(payload) {
  let n = 0;
  const walk = (c) => {
    if (c.type === 10) n += c.content.length;
    for (const k of ['components']) if (Array.isArray(c[k])) c[k].forEach(walk);
  };
  payload.components.map((c) => c.toJSON()).forEach(walk);
  return n;
}

/**
 * Bearbeitet eine gespeicherte Nachricht oder sendet sie neu. Ältere Nachrichten
 * im Embed-Format lassen sich nicht immer in Karten umwandeln – dann wird die
 * Karte neu gesendet und die alte Bot-Nachricht entfernt.
 */
async function upsert(channel, ref, payload) {
  const msg = ref?.channelId === channel.id && ref.messageId ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
  if (msg) {
    try {
      return await msg.edit({ content: null, embeds: [], attachments: [], ...payload });
    } catch {
      const sent = await channel.send(payload);
      if (msg.author?.id === channel.client?.user?.id) await msg.delete().catch(() => {});
      return sent;
    }
  }
  return channel.send(payload);
}

module.exports = { card, quote, textLength, upsert, TEXT_LIMIT, LOGO_NAME };

'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { discordTime } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const { formatAmount } = require('../minecraft/amount');
const { card } = require('../lib/ui');
const theme = require('../config/theme');

/*
 * /panel: kleines Panel, um Befehle über den Minecraft-Bot auszuführen
 * (z. B. /pay, /balance). Nur für die Discord-IDs aus PANEL_ADMIN_IDS.
 */

const button = (id, label, style = ButtonStyle.Secondary, icon = null, disabled = false) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  return icon ? withEmoji(b, icon) : b;
};

// Serverantwort als Codeblock; Backticks würden den Block beenden.
function codeBlock(lines, max = 1800) {
  let text = lines.map((l) => l.replace(/`/g, "'")).join('\n');
  if (text.length > max) text = `${text.slice(0, max)}\n…`;
  return `\`\`\`\n${text}\n\`\`\``;
}

const ERRORS = {
  offline_bot: 'Der Minecraft-Bot ist gerade nicht verbunden.',
  empty: 'Bitte einen Befehl eingeben.',
  too_long: 'Der Befehl ist zu lang (höchstens 256 Zeichen).',
  bad_name: 'Ungültiger Minecraft-Name (3–16 Zeichen, nur Buchstaben, Zahlen und _).',
  bad_amount: 'Ungültiger Betrag. Beispiele: 500, 15k, 1,5k',
};

function statusLines(i) {
  const conn = i.online
    ? `${emojis.icon('resolved')}**Online** als **${i.username ?? '?'}** auf \`${i.host}\`${i.since ? ` · seit ${discordTime(new Date(i.since), 'R')}` : ''}`
    : `${emojis.icon('warning')}**Offline**${i.connecting ? ' · verbindet …' : ''}${i.lastError ? `\n${i.lastError.slice(0, 200)}` : ''}`;
  return [
    conn,
    `Kontostand: **${i.balance === null || i.balance === undefined ? 'unbekannt' : formatAmount(i.balance)}**`,
    ...(i.online && i.players !== null ? [`Spieler online: **${i.players}**`] : []),
    `Einzahlungen: ${i.balanceCheck ? 'mit Kontostand-Prüfung' : 'sofort gutgeschrieben (ohne Kontostand-Prüfung)'}`,
  ].join('\n');
}

/** Hauptansicht. result: { title, lines, error } vom letzten Befehl. */
function mainView(minecraft, result = null) {
  if (!minecraft) {
    return card({
      eyebrow: `${emojis.icon('lock')}Admin-Panel`,
      title: 'Minecraft-Bot',
      icon: 'bot',
      intro: 'Der Minecraft-Bot ist ausgeschaltet (MC_ENABLED=false).',
      accent: theme.colors.warning,
      ephemeral: true,
    logo: false, // Panel-Nachrichten werden bearbeitet – ein Logo-Anhang ginge dabei verloren
    });
  }
  const i = minecraft.info();
  const blocks = [{ heading: 'Status', icon: 'info', body: statusLines(i) }];
  if (result) {
    blocks.push(result.error
      ? { heading: result.title, icon: 'warning', body: ERRORS[result.error] ?? result.error }
      : { heading: result.title, icon: 'check', text: result.lines.length ? codeBlock(result.lines) : '-# Keine Antwort vom Server.' });
  } else if (i.recent.length) {
    blocks.push({ heading: 'Letzte Servernachrichten', icon: 'announce', text: codeBlock(i.recent.slice(-8), 1200) });
  }
  const off = !i.online;
  return card({
    eyebrow: `${emojis.icon('lock')}Admin-Panel`,
    title: 'Minecraft-Bot',
    icon: 'bot',
    intro: 'Befehle laufen über den Bot-Account im Spiel. Die Antwort des Servers erscheint hier.',
    accent: i.online ? theme.colors.success : theme.colors.warning,
    blocks,
    actions: [new ActionRowBuilder().addComponents(
      button('hm:panel:cmd', 'Befehl ausführen', ButtonStyle.Primary, 'platform', off),
      button('hm:panel:pay', '/pay', ButtonStyle.Success, 'coin', off),
      button('hm:panel:balance', 'Kontostand', ButtonStyle.Secondary, 'balance', off),
      button('hm:panel:refresh', 'Aktualisieren', ButtonStyle.Secondary, 'check'),
    )],
    footer: 'Nur für dich sichtbar',
    ephemeral: true,
    logo: false, // Panel-Nachrichten werden bearbeitet – ein Logo-Anhang ginge dabei verloren
  });
}

function payConfirmView(name, amount) {
  return card({
    eyebrow: `${emojis.icon('lock')}Admin-Panel`,
    title: 'Zahlung bestätigen',
    icon: 'coin',
    intro: `Der Bot zahlt **${formatAmount(amount)}** an **${name}**. Das kann nicht rückgängig gemacht werden.`,
    accent: theme.colors.warning,
    actions: [new ActionRowBuilder().addComponents(
      button('hm:panel:payok', 'Ja, zahlen', ButtonStyle.Success, 'coin'),
      button('hm:panel:refresh', 'Abbrechen', ButtonStyle.Secondary),
    )],
    ephemeral: true,
    logo: false, // Panel-Nachrichten werden bearbeitet – ein Logo-Anhang ginge dabei verloren
  });
}

const input = (id, label, placeholder, max) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(true),
);
const commandModal = () => new ModalBuilder().setCustomId('hm:panel:cmdmodal').setTitle('Befehl ausführen')
  .addComponents(input('cmd', 'Befehl (mit /) oder Chat-Nachricht', '/money log', 256));
const payModal = () => new ModalBuilder().setCustomId('hm:panel:paymodal').setTitle('/pay')
  .addComponents(input('name', 'Minecraft-Name', 'Steve', 16), input('amount', 'Betrag', '15k', 20));

module.exports = { mainView, payConfirmView, commandModal, payModal, ERRORS };

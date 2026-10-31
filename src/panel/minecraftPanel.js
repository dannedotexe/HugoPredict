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

// Nur Antworten des Servers („[HugoSMP] …“) zeigen, nicht Broadcasts und Chat anderer Spieler.
// Kam keine solche Zeile, wird alles gezeigt – dann sieht man trotzdem, was ankam.
const SERVER_TAG = /^\[HugoSMP\]/i;
function serverLines(lines) {
  const own = lines.filter((l) => SERVER_TAG.test(l));
  return own.length ? own : lines;
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
      : { heading: result.title, icon: 'check', text: `${serverLines(result.lines).length ? codeBlock(serverLines(result.lines)) : '-# Keine Antwort vom Server.'}${result.received ? `\n-# Empfangen: ${result.received.raw} Servernachrichten` : ''}` });
  } else {
    const st = i.stats ?? { raw: 0, parsed: 0 };
    const shown = serverLines(i.recent);
    blocks.push({
      heading: 'Letzte Servernachrichten',
      icon: 'announce',
      text: `${shown.length ? codeBlock(shown.slice(-8), 1200) : '-# Noch keine.'}\n-# Seit dem Verbinden: ${st.raw} Servernachrichten empfangen`,
    });
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
      button('hm:panel:settings', 'Einstellungen', ButtonStyle.Secondary, 'info'),
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

const onOff = (v) => (v ? '**An**' : '**Aus**');

/** Einstellungen des Minecraft-Bots (gelten sofort, bleiben nach Neustarts). notice: { ok, text } */
function settingsView(minecraft, notice = null) {
  const st = minecraft.settings();
  const blocks = [{
    heading: 'Aktuell',
    icon: 'info',
    body: [
      `Kontostand-Prüfung: ${onOff(st.balanceCheck)}`,
      '-# An: Einzahlung zählt erst, wenn /balance den Anstieg zeigt. Aus: die Nachricht „Du hast … erhalten“ zählt sofort.',
      `Auszahlungen: ${onOff(st.payoutsEnabled)} · Limit pro Auszahlung: **${st.payoutMax > 0 ? formatAmount(st.payoutMax) : 'keins'}**`,
      '-# Führt von der Website freigegebene Auszahlungen per /pay aus. Braucht die Kontostand-Prüfung.',
      `Join-Befehle: ${st.joinCommands.length ? st.joinCommands.map((c) => `\`${c.replace(/`/g, "'")}\``).join(' · ') : '**keine**'}`,
      '-# Werden nach jedem Verbinden ausgeführt, z. B. /server smp. Gelten ab dem nächsten Verbinden.',
    ].join('\n'),
  }];
  if (notice) blocks.push({ heading: notice.ok ? 'Gespeichert' : 'Nicht gespeichert', icon: notice.ok ? 'check' : 'warning', body: notice.text });
  return card({
    eyebrow: `${emojis.icon('lock')}Admin-Panel`,
    title: 'Einstellungen',
    icon: 'info',
    intro: 'Änderungen gelten sofort und bleiben nach Neustarts erhalten.',
    blocks,
    actions: [
      new ActionRowBuilder().addComponents(
        button('hm:panel:toggle:balanceCheck', `Kontostand-Prüfung ${st.balanceCheck ? 'aus' : 'an'}schalten`, ButtonStyle.Secondary),
        button('hm:panel:toggle:payoutsEnabled', `Auszahlungen ${st.payoutsEnabled ? 'aus' : 'an'}schalten`, st.payoutsEnabled ? ButtonStyle.Danger : ButtonStyle.Secondary),
        button('hm:panel:limit', 'Limit ändern', ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        button('hm:panel:join', 'Join-Befehle', ButtonStyle.Secondary),
        button('hm:panel:reconnect', 'Neu verbinden', ButtonStyle.Secondary),
        button('hm:panel:refresh', 'Zurück', ButtonStyle.Primary),
      ),
    ],
    footer: 'Nur für dich sichtbar',
    ephemeral: true,
    logo: false,
  });
}

const input = (id, label, placeholder, max) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(true),
);
const commandModal = () => new ModalBuilder().setCustomId('hm:panel:cmdmodal').setTitle('Befehl ausführen')
  .addComponents(input('cmd', 'Befehl (mit /) oder Chat-Nachricht', '/money log', 256));
const payModal = () => new ModalBuilder().setCustomId('hm:panel:paymodal').setTitle('/pay')
  .addComponents(input('name', 'Minecraft-Name', 'Steve', 16), input('amount', 'Betrag', '15k', 20));

const limitModal = () => new ModalBuilder().setCustomId('hm:panel:limitmodal').setTitle('Auszahlungs-Limit')
  .addComponents(input('amount', 'Höchstbetrag pro Auszahlung', '50k', 20));
const joinModal = (current) => new ModalBuilder().setCustomId('hm:panel:joinmodal').setTitle('Join-Befehle').addComponents(
  new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('cmds').setLabel('Ein Befehl pro Zeile (leer = keine)').setPlaceholder('/server smp')
      .setStyle(TextInputStyle.Paragraph).setMaxLength(520).setRequired(false).setValue(current.join('\n')),
  ),
);

module.exports = { mainView, payConfirmView, settingsView, commandModal, payModal, limitModal, joinModal, ERRORS };

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

// Einheitlich: alle Panel-Knöpfe blau, nur die Zahlungsbestätigung grün/rot.
const button = (id, label, style = ButtonStyle.Primary, icon = null, disabled = false) => {
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
const SERVER_TAG = /^\[(?:HugoSMP|Nachricht)\]/i;
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

const money = (v) => (v === null || v === undefined ? '—' : `$${formatAmount(v)}`);
const PANEL = { ephemeral: true, logo: false }; // Panel-Nachrichten werden bearbeitet – ein Logo-Anhang ginge dabei verloren

/** Kopfzeile: Verbindung in einer Zeile. */
function eyebrow(i) {
  if (!i) return `${emojis.icon('closed')}Ausgeschaltet`;
  return i.online
    ? `${emojis.icon('resolved')}Online als ${i.username ?? '?'} · ${i.host}${i.players !== null ? ` · ${i.players} Spieler` : ''}`
    : `${emojis.icon('warning')}${i.connecting ? 'Verbindet …' : 'Offline'} · ${i.host}`;
}

/** Hauptansicht. result: { title, lines, error } vom letzten Befehl. */
function mainView(minecraft, result = null) {
  if (!minecraft) {
    return card({
      eyebrow: eyebrow(null),
      title: 'Minecraft-Bot',
      icon: 'bot',
      intro: 'Der Minecraft-Bot ist ausgeschaltet (MC_ENABLED=false).',
      accent: theme.colors.warning,
      ...PANEL,
    });
  }
  const i = minecraft.info();
  const blocks = [];
  // Großer Kontostand als Mittelpunkt
  blocks.push({
    text: `-# Kontostand des Bots\n# ${money(i.balance)}\n-# Einzahlungen ${i.balanceCheck ? 'mit Kontostand-Prüfung' : 'werden sofort gutgeschrieben'}${i.since && i.online ? ` · verbunden ${discordTime(new Date(i.since), 'R')}` : ''}`,
  });
  if (!i.online && i.lastError) blocks.push({ heading: 'Verbindung', icon: 'warning', body: i.lastError.slice(0, 200) });
  if (result) {
    const lines = serverLines(result.lines ?? []);
    blocks.push(result.error
      ? { heading: result.title, icon: 'warning', body: ERRORS[result.error] ?? result.error }
      : { heading: result.title, icon: 'check', text: lines.length ? codeBlock(lines) : '-# Keine Antwort vom Server.' });
  } else {
    const shown = serverLines(i.recent).slice(-5);
    if (shown.length) blocks.push({ heading: 'Zuletzt vom Server', icon: 'announce', text: codeBlock(shown, 900) });
  }
  const off = !i.online;
  return card({
    eyebrow: eyebrow(i),
    title: 'Minecraft-Bot',
    icon: 'bot',
    accent: i.online ? theme.colors.success : theme.colors.warning,
    blocks,
    actions: [
      new ActionRowBuilder().addComponents(
        button('hm:panel:pay', 'Bezahlen', ButtonStyle.Primary, 'coin', off),
        button('hm:panel:balance', 'Kontostand', ButtonStyle.Primary, 'balance', off),
        button('hm:panel:cmd', 'Befehl', ButtonStyle.Primary, 'platform', off),
      ),
      new ActionRowBuilder().addComponents(
        button('hm:panel:refresh', 'Aktualisieren', ButtonStyle.Primary, 'check'),
        button('hm:panel:settings', 'Einstellungen', ButtonStyle.Primary, 'info'),
      ),
    ],
    footer: null,
    ...PANEL,
  });
}

function payConfirmView(name, amount) {
  return card({
    eyebrow: `${emojis.icon('warning')}Zahlung bestätigen`,
    title: `${money(amount)} an ${name}`,
    icon: 'coin',
    intro: 'Der Bot zahlt diesen Betrag im Spiel aus. Das kann nicht rückgängig gemacht werden.',
    accent: theme.colors.warning,
    actions: [new ActionRowBuilder().addComponents(
      button('hm:panel:payok', 'Ja, zahlen', ButtonStyle.Success, 'coin'),
      button('hm:panel:refresh', 'Abbrechen', ButtonStyle.Danger),
    )],
    footer: null,
    ...PANEL,
  });
}

const state = (on) => (on ? `${emojis.icon('resolved')}**An**` : `${emojis.icon('closed')}**Aus**`);

/** Einstellungen des Minecraft-Bots (gelten sofort, bleiben nach Neustarts). notice: { ok, text } */
function settingsView(minecraft, notice = null) {
  const st = minecraft.settings();
  const blocks = [];
  if (notice) blocks.push({ heading: notice.ok ? 'Gespeichert' : 'Nicht gespeichert', icon: notice.ok ? 'check' : 'warning', body: notice.text });
  blocks.push(
    { heading: 'Einzahlungen', icon: 'coin', body: `Kontostand-Prüfung ${state(st.balanceCheck)}\n-# ${st.balanceCheck ? 'Eine Einzahlung zählt erst, wenn /balance den Anstieg zeigt.' : 'Die Nachricht „Du hast … erhalten“ zählt sofort.'}` },
    { heading: 'Auszahlungen', icon: 'balance', body: `Automatisch ${state(st.payoutsEnabled)} · Limit **${st.payoutMax > 0 ? money(st.payoutMax) : 'keins'}**\n-# Führt freigegebene Auszahlungen der Website per /pay aus. Braucht die Kontostand-Prüfung.` },
    { heading: 'Nach dem Verbinden', icon: 'platform', body: `${st.joinCommands.length ? st.joinCommands.map((c) => `\`${c.replace(/`/g, "'")}\``).join(' · ') : 'Keine Befehle'}\n-# Werden nach jedem Verbinden ausgeführt, z. B. /server smp. Bei HugoSMP nicht nötig.` },
  );
  return card({
    eyebrow: `${emojis.icon('info')}Gilt sofort und bleibt nach Neustarts`,
    title: 'Einstellungen',
    icon: 'info',
    blocks,
    actions: [
      new ActionRowBuilder().addComponents(
        button('hm:panel:toggle:balanceCheck', `Prüfung ${st.balanceCheck ? 'aus' : 'an'}`, ButtonStyle.Primary),
        button('hm:panel:toggle:payoutsEnabled', `Auszahlungen ${st.payoutsEnabled ? 'aus' : 'an'}`, ButtonStyle.Primary),
        button('hm:panel:limit', 'Limit', ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        button('hm:panel:join', 'Befehle nach dem Verbinden', ButtonStyle.Primary),
        button('hm:panel:reconnect', 'Neu verbinden', ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        button('hm:panel:refresh', 'Zurück', ButtonStyle.Primary),
      ),
    ],
    footer: null,
    ...PANEL,
  });
}

const input = (id, label, placeholder, max) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(true),
);
const commandModal = () => new ModalBuilder().setCustomId('hm:panel:cmdmodal').setTitle('Befehl ausführen')
  .addComponents(input('cmd', 'Befehl (mit /) oder Chat-Nachricht', '/money log', 256));
const payModal = () => new ModalBuilder().setCustomId('hm:panel:paymodal').setTitle('Bezahlen')
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

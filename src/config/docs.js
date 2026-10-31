'use strict';

/*
 * Inhalte für #regeln. Hier zentral gepflegt, damit Texte ohne
 * Code-Änderung an anderer Stelle angepasst werden können.
 *
 * Wichtig: Konkrete Gebührensätze sind bewusst NICHT hinterlegt – das Repository
 * enthält keine Gebührenlogik. Trage verbindliche Werte erst ein, wenn sie auf
 * der Website feststehen (FEE_DETAILS), sonst verweist der Text auf die Website.
 */

const FEE_DETAILS = null; // z. B. ['Handelsgebühr: 1 % des Ordervolumens', 'Keine Gebühr auf Gewinne']

function sections({ currency, websiteUrl }) {
  const site = websiteUrl ? `[Website](${websiteUrl})` : 'Website';
  return [
    {
      title: 'Die Plattform',
      icon: 'platform',
      body: [
        `HugoPredict ist eine Prognose-Plattform für Ereignisse rund um den Minecraft-Server HugoSMP und darüber hinaus. Jede Prognose stellt eine klar formulierte Frage mit festgelegten Ergebnissen.`,
        '',
        'Der Preis eines Ergebnisses liegt zwischen 0 und 100 % und spiegelt die aktuelle Einschätzung aller Teilnehmenden wider. Wird eine Prognose entschieden, erhalten Anteile am eingetretenen Ergebnis den vollen Wert, alle übrigen verfallen.',
        '',
        `Gehandelt wird ausschließlich auf der ${site}. Dieser Discord dient Information, Austausch und Support.`,
      ].join('\n'),
    },
    {
      title: `Ingame-Geld (${currency})`,
      icon: 'coin',
      body: [
        `Gehandelt wird mit HugoSMP-Geld (${currency}). Einzahlen: im Spiel per \`/pay\` an den Bot **HugoPredict**. Auszahlen: auf der ${site} beantragen. Echtgeld spielt keine Rolle – HugoPredict kauft und verkauft kein Ingame-Geld gegen Euro.`,
        '',
        `Kontostand, Positionen und Transaktionen werden ausschließlich von der Website geführt. Im Discord rufst du sie privat mit \`/balance\`, \`/portfolio\` und \`/history\` ab – die Antworten sieht nur du.`,
      ].join('\n'),
    },
    {
      title: 'Handelsgebühren',
      icon: 'fees',
      body: FEE_DETAILS
        ? FEE_DETAILS.map((l) => `• ${l}`).join('\n')
        : `Die jeweils gültigen Gebühren werden auf der ${site} vor jeder Order angezeigt und sind dort verbindlich. Änderungen werden in #ankündigungen bekannt gegeben.`,
    },
    {
      title: 'Prognoseregeln',
      icon: 'rules',
      body: [
        '1. Jede Prognose nennt ihre Ergebnisse, ihren Handelsschluss und eine Entscheidungsquelle.',
        '2. Entschieden wird ausschließlich anhand dieser Quelle durch die Prognoseverwaltung.',
        '3. Ist ein Ergebnis nicht eindeutig feststellbar, kann eine Prognose pausiert oder annulliert werden.',
        '4. Manipulation, Absprachen, Mehrfachkonten und das Ausnutzen von Fehlern sind untersagt.',
        '5. Wer an einem Ereignis selbst beteiligt ist oder über nicht öffentliche Informationen verfügt, handelt in dieser Prognose nicht.',
      ].join('\n'),
    },
    {
      title: 'Verhaltensregeln',
      icon: 'conduct',
      body: [
        '• Respektvoller, sachlicher Umgang. Keine Beleidigungen, keine Diskriminierung.',
        '• Keine Werbung, kein Spam, keine unaufgeforderten Direktnachrichten.',
        '• Keine Kontodaten oder privaten Informationen in öffentlichen Channels.',
        '• Probleme mit Guthaben oder Verdachtsfälle ausschließlich über #support melden.',
        '• Es gelten die Nutzungsbedingungen und Community-Richtlinien von Discord.',
        '',
        'Mit „Regeln akzeptieren“ erhältst du Zugang zur Community. Verknüpfe anschließend dein Konto in #verifizieren, um private Kontoabfragen zu nutzen.',
      ].join('\n'),
    },
  ];
}

module.exports = { sections, FEE_DETAILS };

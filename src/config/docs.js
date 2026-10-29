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
        `HugoPredict ist ein Prognosemarkt für Ereignisse rund um den Minecraft-Server HugoSMP. Jeder Markt stellt eine klar formulierte Frage mit festgelegten Ergebnissen.`,
        '',
        'Der Preis eines Ergebnisses liegt zwischen 0 und 100 % und spiegelt die aktuelle Einschätzung aller Teilnehmenden wider. Wird ein Markt entschieden, erhalten Anteile am eingetretenen Ergebnis den vollen Wert, alle übrigen verfallen.',
        '',
        `Gehandelt wird ausschließlich auf der ${site}. Dieser Discord dient Information, Austausch und Support.`,
      ].join('\n'),
    },
    {
      title: `Virtuelle ${currency}`,
      icon: 'coin',
      body: [
        `${currency} sind die virtuelle Währung der Plattform. Sie haben keinen realen Geldwert und können weder gegen Echtgeld gekauft noch in Echtgeld ausgezahlt werden.`,
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
      title: 'Marktregeln',
      icon: 'rules',
      body: [
        '1. Jeder Markt nennt seine Ergebnisse, seinen Handelsschluss und eine Entscheidungsquelle.',
        '2. Entschieden wird ausschließlich anhand dieser Quelle durch die Marktverwaltung.',
        '3. Ist ein Ergebnis nicht eindeutig feststellbar, kann ein Markt pausiert oder annulliert werden.',
        '4. Marktmanipulation, Absprachen, Mehrfachkonten und das Ausnutzen von Fehlern sind untersagt.',
        '5. Wer an einem Ereignis selbst beteiligt ist oder über nicht öffentliche Informationen verfügt, handelt in diesem Markt nicht.',
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
        'Mit „Regeln akzeptieren“ erhältst du Zugang zur Community. Verknüpfe anschließend dein Konto, um private Kontoabfragen zu nutzen.',
      ].join('\n'),
    },
  ];
}

module.exports = { sections, FEE_DETAILS };

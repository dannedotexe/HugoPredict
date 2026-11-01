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

/*
 * Jede Regel hat einen Paragrafen (§Abschnitt.Nummer). Bei /mod wählt das
 * Team den Paragrafen aus, die betroffene Person sieht ihn in der Nachricht.
 */
function rules({ currency, websiteUrl }) {
  const site = websiteUrl ? `[Website](${websiteUrl})` : 'Website';
  return [
    {
      title: 'Die Plattform',
      icon: 'platform',
      items: [
        { short: 'Prognosen', text: 'HugoPredict ist eine Prognose-Plattform für Ereignisse rund um den Minecraft-Server HugoSMP und darüber hinaus. Jede Prognose stellt eine klar formulierte Frage mit festgelegten Ergebnissen.' },
        { short: 'Preise', text: 'Der Preis eines Ergebnisses liegt zwischen 0 und 100 % und spiegelt die Einschätzung aller Teilnehmenden wider. Wird eine Prognose entschieden, erhalten Anteile am eingetretenen Ergebnis den vollen Wert, alle übrigen verfallen.' },
        { short: 'Website', text: `Geboten wird ausschließlich auf der ${site}. Dieser Discord dient Information, Austausch und Support.` },
      ],
    },
    {
      title: `Ingame-Geld (${currency})`,
      icon: 'coin',
      items: [
        { short: 'Ein- und Auszahlung', text: `Gehandelt wird mit HugoSMP-Geld (${currency}). Einzahlen: im Spiel per \`/pay\` an den Bot **HugoPredict**. Auszahlen: auf der ${site}. Echtgeld spielt keine Rolle – HugoPredict kauft und verkauft kein Ingame-Geld gegen Euro.` },
        { short: 'Kontostand', text: 'Kontostand, Positionen und Transaktionen führt ausschließlich die Website. Im Discord rufst du sie privat mit `/balance`, `/portfolio` und `/history` ab.' },
        { short: 'Gebühren', text: FEE_DETAILS ? FEE_DETAILS.join(' · ') : `Gültige Gebühren zeigt die ${site} vor jedem Gebot verbindlich an. Änderungen kommen in #ankündigungen.` },
      ],
    },
    {
      title: 'Prognoseregeln',
      icon: 'rules',
      items: [
        { short: 'Angaben', text: 'Jede Prognose nennt ihre Ergebnisse, ihren Handelsschluss und eine Entscheidungsquelle.' },
        { short: 'Entscheidung', text: 'Entschieden wird ausschließlich anhand dieser Quelle durch die Prognoseverwaltung.' },
        { short: 'Annullierung', text: 'Ist ein Ergebnis nicht eindeutig feststellbar, kann eine Prognose pausiert oder annulliert werden.' },
        { short: 'Manipulation & Zweitaccounts', text: 'Manipulation, Absprachen, Mehrfachkonten und das Ausnutzen von Fehlern sind untersagt.' },
        { short: 'Insider-Handel', text: 'Wer an einem Ereignis selbst beteiligt ist oder über nicht öffentliche Informationen verfügt (Insider), bietet in dieser Prognose nicht mit.' },
        { short: 'Strafen', text: '**Verstöße gegen §3.4 und §3.5 werden hart bestraft:** Das Konto wird gesperrt, Gewinne und Guthaben können eingezogen werden. Bei Zweitaccounts betrifft das alle Konten. Verdachtsfälle bitte über #support melden.' },
      ],
    },
    {
      title: 'Verhaltensregeln',
      icon: 'conduct',
      items: [
        { short: 'Respekt', text: 'Respektvoller, sachlicher Umgang. Keine Beleidigungen, keine Diskriminierung.' },
        { short: 'Werbung & Spam', text: 'Keine Werbung, kein Spam, keine unaufgeforderten Direktnachrichten.' },
        { short: 'Private Daten', text: 'Keine Kontodaten oder privaten Informationen in öffentlichen Channels.' },
        { short: 'Meldewege', text: 'Probleme mit Guthaben oder Verdachtsfälle ausschließlich über #support melden.' },
        { short: 'Discord-Richtlinien', text: 'Es gelten die Nutzungsbedingungen und Community-Richtlinien von Discord.' },
      ],
    },
  ].map((section, i) => ({ ...section, items: section.items.map((item, j) => ({ ...item, id: `${i + 1}.${j + 1}` })) }));
}

/** Für #regeln: Abschnitte mit „**§1.1** Text“-Zeilen. */
function sections(opts) {
  return rules(opts).map((s, i) => ({
    title: `§${i + 1} ${s.title}`,
    icon: s.icon,
    body: s.items.map((it) => `**§${it.id}** ${it.text}`).join('\n'),
  }));
}

/** Auswahl für /mod: „§3.4 Manipulation & Zweitaccounts“ (max. 25). */
function paragraphChoices() {
  return rules({ currency: '$', websiteUrl: '' }).flatMap((s) => s.items.map((it) => ({ name: `§${it.id} ${it.short}`, value: it.id }))).slice(0, 25);
}

/** „3.4“ → „§3.4 Manipulation & Zweitaccounts“ und der Regeltext. */
function paragraph(id, opts = { currency: '$', websiteUrl: '' }) {
  for (const s of rules(opts)) for (const it of s.items) if (it.id === id) return { id, label: `§${id} ${it.short}`, text: it.text };
  return null;
}

module.exports = { rules, sections, paragraphChoices, paragraph, FEE_DETAILS };

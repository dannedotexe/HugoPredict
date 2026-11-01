// Regeln mit Paragrafen – gleich wie #regeln im Discord (Bot: src/config/docs.js).
// Beim Sperren wählt der Admin den Paragrafen, die gesperrte Person sieht ihn.
export const RULES = [
  {
    "id": "1.1",
    "label": "§1.1 Prognosen",
    "text": "HugoPredict ist eine Prognose-Plattform für Ereignisse rund um den Minecraft-Server HugoSMP und darüber hinaus. Jede Prognose stellt eine klar formulierte Frage mit festgelegten Ergebnissen."
  },
  {
    "id": "1.2",
    "label": "§1.2 Preise",
    "text": "Der Preis eines Ergebnisses liegt zwischen 0 und 100 % und spiegelt die Einschätzung aller Teilnehmenden wider. Wird eine Prognose entschieden, erhalten Anteile am eingetretenen Ergebnis den vollen Wert, alle übrigen verfallen."
  },
  {
    "id": "1.3",
    "label": "§1.3 Website",
    "text": "Geboten wird ausschließlich auf der Website. Dieser Discord dient Information, Austausch und Support."
  },
  {
    "id": "2.1",
    "label": "§2.1 Ein- und Auszahlung",
    "text": "Gehandelt wird mit HugoSMP-Geld ($). Einzahlen: im Spiel per /pay an den Bot HugoPredict. Auszahlen: auf der Website. Echtgeld spielt keine Rolle – HugoPredict kauft und verkauft kein Ingame-Geld gegen Euro."
  },
  {
    "id": "2.2",
    "label": "§2.2 Kontostand",
    "text": "Kontostand, Positionen und Transaktionen führt ausschließlich die Website. Im Discord rufst du sie privat mit /balance, /portfolio und /history ab."
  },
  {
    "id": "2.3",
    "label": "§2.3 Gebühren",
    "text": "Gültige Gebühren zeigt die Website vor jedem Gebot verbindlich an. Änderungen kommen in #ankündigungen."
  },
  {
    "id": "3.1",
    "label": "§3.1 Angaben",
    "text": "Jede Prognose nennt ihre Ergebnisse, ihren Handelsschluss und eine Entscheidungsquelle."
  },
  {
    "id": "3.2",
    "label": "§3.2 Entscheidung",
    "text": "Entschieden wird ausschließlich anhand dieser Quelle durch die Prognoseverwaltung."
  },
  {
    "id": "3.3",
    "label": "§3.3 Annullierung",
    "text": "Ist ein Ergebnis nicht eindeutig feststellbar, kann eine Prognose pausiert oder annulliert werden."
  },
  {
    "id": "3.4",
    "label": "§3.4 Manipulation & Zweitaccounts",
    "text": "Manipulation, Absprachen, Mehrfachkonten und das Ausnutzen von Fehlern sind untersagt."
  },
  {
    "id": "3.5",
    "label": "§3.5 Insider-Handel",
    "text": "Wer an einem Ereignis selbst beteiligt ist oder über nicht öffentliche Informationen verfügt (Insider), bietet in dieser Prognose nicht mit."
  },
  {
    "id": "3.6",
    "label": "§3.6 Strafen",
    "text": "Verstöße gegen §3.4 und §3.5 werden hart bestraft: Das Konto wird gesperrt, Gewinne und Guthaben können eingezogen werden. Bei Zweitaccounts betrifft das alle Konten. Verdachtsfälle bitte über #support melden."
  },
  {
    "id": "4.1",
    "label": "§4.1 Respekt",
    "text": "Respektvoller, sachlicher Umgang. Keine Beleidigungen, keine Diskriminierung."
  },
  {
    "id": "4.2",
    "label": "§4.2 Werbung & Spam",
    "text": "Keine Werbung, kein Spam, keine unaufgeforderten Direktnachrichten."
  },
  {
    "id": "4.3",
    "label": "§4.3 Private Daten",
    "text": "Keine Kontodaten oder privaten Informationen in öffentlichen Channels."
  },
  {
    "id": "4.4",
    "label": "§4.4 Meldewege",
    "text": "Probleme mit Guthaben oder Verdachtsfälle ausschließlich über #support melden."
  },
  {
    "id": "4.5",
    "label": "§4.5 Discord-Richtlinien",
    "text": "Es gelten die Nutzungsbedingungen und Community-Richtlinien von Discord."
  }
];

export const rule = (id) => RULES.find((r) => r.id === String(id)) ?? null;

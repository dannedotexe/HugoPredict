'use strict';

/*
 * Erkennung von Chat-Nachrichten des Minecraft-Servers. Ausgewertet werden nur
 * Systemnachrichten, nie Spieler-Chat. Alle Muster sind am Zeilenanfang
 * verankert (höchstens ein Tag in Klammern wie „[Money]“ davor), damit ein
 * Spieler sie nicht mit einer Chat-Nachricht nachahmen kann. Zusätzlich zählt
 * eine Zahlung erst, wenn der Kontostand des Bots wirklich gestiegen ist.
 *
 * Eigene Muster (MC_PAY_PATTERN, MC_BALANCE_PATTERN) brauchen die benannten
 * Gruppen (?<amount>…) und – bei Zahlungen – (?<name>…).
 */

const PREFIX = String.raw`^(?:[\[(][^\])]{1,24}[\])]\s*(?:[»>:|]\s*)?)?`;
const AMT = String.raw`(?<amount>[$€]?\s?\d[\d.,]*\s?(?:k|tsd|mio|m|mrd|b)?\s?[$€⛃]?)`;
// Währung als Wort hinter dem Betrag, z. B. „1.234 Coins“ (gehört nicht zum Betrag)
const UNIT = String.raw`(?:\s?(?:coins?|münzen|taler|dollar|euro|hugocoins|hc))?`;
const NAME = String.raw`(?<name>[A-Za-z0-9_]{3,16})`;
const END = String.raw`\s*[.!]?$`;

const DEFAULT_PAY = [
  `${AMT}${UNIT} has been received from ${NAME}`,
  `${AMT}${UNIT} (?:wurden?|ist) (?:dir )?von ${NAME} (?:erhalten|überwiesen|gesendet|gezahlt|bezahlt)`,
  `Du hast ${AMT}${UNIT} von ${NAME} (?:erhalten|bekommen)`,
  `${NAME} hat dir ${AMT}${UNIT} (?:gezahlt|bezahlt|überwiesen|gesendet|geschickt|gegeben)`,
  `(?:You )?received ${AMT}${UNIT} from ${NAME}`,
];
const DEFAULT_BALANCE = [
  String.raw`(?:Dein |Your )?(?:Kontostand|Guthaben|Balance|Geld|Money)(?: beträgt| is)?\s*:?\s*${AMT}${UNIT}`,
];

// Hinweis-Wörter für Nachrichten, die wie eine Zahlung aussehen, aber nicht erkannt wurden.
const LOOKS_LIKE_PAYMENT = /(erhalten|bekommen|gezahlt|überwiesen|received|paid you|sent you)/i;

function compile(source, label) {
  let re;
  try {
    re = new RegExp(source, 'iu');
  } catch (err) {
    throw new Error(`${label} ist kein gültiger regulärer Ausdruck: ${err.message}`);
  }
  return re;
}

function buildPatterns({ payPattern = '', balancePattern = '' } = {}) {
  const pay = payPattern ? [compile(payPattern, 'MC_PAY_PATTERN')] : DEFAULT_PAY.map((p) => compile(PREFIX + p + END, 'Zahlungsmuster'));
  const balance = balancePattern ? [compile(balancePattern, 'MC_BALANCE_PATTERN')] : DEFAULT_BALANCE.map((p) => compile(PREFIX + p + END, 'Kontostandsmuster'));
  for (const re of pay) if (!/\(\?<amount>/.test(re.source) || !/\(\?<name>/.test(re.source)) throw new Error('MC_PAY_PATTERN braucht die Gruppen (?<amount>…) und (?<name>…).');
  for (const re of balance) if (!/\(\?<amount>/.test(re.source)) throw new Error('MC_BALANCE_PATTERN braucht die Gruppe (?<amount>…).');
  return { pay, balance };
}

function matchFirst(patterns, text) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.groups) return m.groups;
  }
  return null;
}

module.exports = { buildPatterns, matchFirst, LOOKS_LIKE_PAYMENT };

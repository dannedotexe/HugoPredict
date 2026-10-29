'use strict';

/*
 * Beträge aus dem Minecraft-Chat lesen, z. B. „15k“, „15.000“, „$15,000.50“
 * oder „1,5 Mio“. Ein Trennzeichen vor genau drei Ziffern gilt als
 * Tausendertrennzeichen, sonst als Komma.
 */

const SUFFIX = { k: 1e3, tsd: 1e3, m: 1e6, mio: 1e6, b: 1e9, mrd: 1e9 };
const AMOUNT = /^(\d[\d.,]*)(k|tsd|m|mio|b|mrd)?$/;

function parseAmount(raw, { allowZero = false } = {}) {
  const text = String(raw ?? '').toLowerCase().replace(/[$€⛃\s]/g, '').replace(/\.$/, '');
  const m = text.match(AMOUNT);
  if (!m) return null;
  const [, num, suffix] = m;
  const seps = num.match(/[.,]/g) ?? [];
  const last = Math.max(num.lastIndexOf('.'), num.lastIndexOf(','));
  let value;
  if (!seps.length) {
    value = Number(num);
  } else if (new Set(seps).size > 1) {
    // „15,000.50“ oder „15.000,50“: das letzte Zeichen trennt die Nachkommastellen.
    value = Number(`${num.slice(0, last).replace(/[.,]/g, '')}.${num.slice(last + 1)}`);
  } else if (num.length - last - 1 === 3 && !suffix && /^\d{1,3}([.,]\d{3})+$/.test(num)) {
    value = Number(num.replace(/[.,]/g, ''));
  } else if (seps.length === 1) {
    value = Number(num.replace(',', '.'));
  } else {
    return null;
  }
  value *= SUFFIX[suffix] ?? 1;
  if (!Number.isFinite(value) || value < 0 || (value === 0 && !allowZero)) return null;
  return Math.round(value * 100) / 100;
}

/** Betrag für Befehle wie /pay: ohne Trennzeichen, höchstens zwei Nachkommastellen. */
function commandAmount(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const formatAmount = (value) => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });

module.exports = { parseAmount, commandAmount, formatAmount };

'use strict';

/*
 * Zeitangaben in deutscher Ortszeit (Europe/Berlin, inkl. Sommer-/Winterzeit).
 * Unterstützt: "20:00", "morgen 20:00", "14.11. 20:00", "14.11.2026 20:00", "14.11.2026, 20:00 Uhr".
 */

const ZONE = 'Europe/Berlin';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Differenz Berlin – UTC in ms zum Zeitpunkt ts. */
function offsetAt(ts) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}

/** Berliner Wandzeit → UTC-Zeitstempel. */
function berlinToUtc(y, m, d, h, mi) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** Heutiges Datum in Berlin als { y, m, d }. */
function berlinToday(now) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

/**
 * Liest eine Zeitangabe. Gibt { ok: true, at } oder { ok: false, error } zurück.
 * Erlaubt sind Zeitpunkte zwischen einer Minute und 60 Tagen in der Zukunft.
 */
function parseBerlinTime(input, now = Date.now()) {
  const s = String(input ?? '').trim().toLowerCase().replace(/\s*uhr\s*$/, '').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m;
  const today = berlinToday(now);
  let at = null;
  if ((m = s.match(/^(heute |morgen )?(\d{1,2})[:.](\d{2})$/))) {
    const add = m[1] === 'morgen ' ? 1 : 0;
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + add));
    at = berlinToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), +m[2], +m[3]);
    if (!m[1] && at <= now) {
      const next = new Date(Date.UTC(today.y, today.m - 1, today.d + 1));
      at = berlinToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), +m[2], +m[3]);
    }
  } else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})? (\d{1,2})[:.](\d{2})$/))) {
    let year = m[3] ? +m[3] : today.y;
    if (year < 100) year += 2000;
    at = berlinToUtc(year, +m[2], +m[1], +m[4], +m[5]);
    if (!m[3] && at <= now) at = berlinToUtc(year + 1, +m[2], +m[1], +m[4], +m[5]);
    // Ungültige Daten wie 31.02. erkennen
    const check = new Date(at + offsetAt(at));
    if (check.getUTCDate() !== +m[1] || check.getUTCMonth() + 1 !== +m[2]) at = NaN;
  } else {
    return { ok: false, error: 'Format nicht erkannt. Beispiele: „20:00“, „morgen 18:30“, „14.11. 20:00“ oder „14.11.2026 20:00“.' };
  }
  const [hh, mm] = (s.match(/(\d{1,2})[:.](\d{2})$/) ?? []).slice(1).map(Number);
  if (!Number.isFinite(at) || hh > 23 || mm > 59) return { ok: false, error: 'Diese Uhrzeit oder dieses Datum gibt es nicht.' };
  if (at < now + 60_000) return { ok: false, error: 'Der Zeitpunkt muss mindestens eine Minute in der Zukunft liegen.' };
  if (at > now + 60 * 24 * 3_600_000) return { ok: false, error: 'Ankündigungen lassen sich höchstens 60 Tage im Voraus planen.' };
  return { ok: true, at };
}

module.exports = { parseBerlinTime, berlinToUtc, offsetAt };

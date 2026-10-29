'use strict';

/*
 * Eine Zahlung zählt nur, wenn der Kontostand des Bots tatsächlich gestiegen
 * ist. So kann niemand mit einer gefälschten Chat-Nachricht Geld „einzahlen“.
 *
 * reconcile() vergleicht die Summe der erkannten Zahlungen mit dem gemessenen
 * Anstieg. Nur wenn der Anstieg ALLE Zahlungen deckt, werden sie gutgeschrieben.
 * Fehlt etwas, ist mindestens eine Nachricht falsch – welche, lässt sich nicht
 * sicher sagen. Dann wird keine davon gutgeschrieben, sondern alle gehen zur
 * Prüfung an das Team. Eine gefälschte Nachricht kann so nie einer echten
 * Zahlung die Gutschrift wegnehmen.
 */

const EPSILON = 0.005;
const round = (v) => Math.round(v * 100) / 100;

function reconcile(claims, delta) {
  const total = claims.reduce((sum, c) => sum + c.amount, 0);
  const covered = delta + EPSILON >= total;
  return {
    confirmed: covered ? claims : [],
    unconfirmed: covered ? [] : claims,
    surplus: covered && delta - total > EPSILON ? round(delta - total) : 0,
    decreased: delta < -EPSILON,
  };
}

/** Passt der gemessene Rückgang zum ausgezahlten Betrag? */
const payoutMatches = (before, after, amount) => Math.abs(before - after - amount) <= EPSILON;

module.exports = { reconcile, payoutMatches };

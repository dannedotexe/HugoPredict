'use strict';

/*
 * Eine Zahlung zählt nur, wenn der Kontostand des Bots tatsächlich gestiegen
 * ist. So kann niemand mit einer gefälschten Chat-Nachricht Geld „einzahlen“.
 *
 * reconcile() verteilt den gemessenen Anstieg der Reihe nach auf die erkannten
 * Zahlungen. Was nicht gedeckt ist, wird nicht gutgeschrieben, sondern dem Team
 * gemeldet.
 */

const EPSILON = 0.005;

function reconcile(claims, delta) {
  let remaining = Math.max(0, delta);
  const confirmed = [];
  const unconfirmed = [];
  for (const claim of claims) {
    if (claim.amount <= remaining + EPSILON) {
      confirmed.push(claim);
      remaining -= claim.amount;
    } else {
      unconfirmed.push(claim);
    }
  }
  return { confirmed, unconfirmed, surplus: remaining > EPSILON ? Math.round(remaining * 100) / 100 : 0, decreased: delta < -EPSILON };
}

/** Passt der gemessene Rückgang zum ausgezahlten Betrag? */
const payoutMatches = (before, after, amount) => Math.abs(before - after - amount) <= EPSILON;

module.exports = { reconcile, payoutMatches };

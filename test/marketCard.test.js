'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { marketCard, marketHash } = require('../src/services/marketFeed');
const { normalizeMarket } = require('../src/lib/hugoApi');

const json = (p) => JSON.stringify(p.components.map((c) => c.toJSON()));

test('Prognose-Karte zeigt echte Ausgänge, Kategorie und Emoji', () => {
  const m = normalizeMarket({
    id: 7, title: 'Wie schwer ist Lutscha77', status: 'open', volume: 0, yesPrice: null, noPrice: null,
    outcomes: [{ label: 'über 100kg', price: 0.5 }, { label: 'unter 100kg', price: 0.5 }], category: 'Echte Welt', emoji: '🐋',
  });
  const s = json(marketCard(m, { currency: '$' }));
  assert.match(s, /über 100kg\*\* 50/);
  assert.match(s, /unter 100kg\*\* 50/);
  assert.doesNotMatch(s, /\*\*Ja\*\*/);
  assert.match(s, /Echte Welt/);
  assert.match(s, /🐋 Wie schwer ist Lutscha77/);
  // Ja/Nein bleibt wie bisher
  const yn = normalizeMarket({ id: 8, title: 'Gewinnt Clan A?', status: 'open', yesPrice: 0.62, noPrice: 0.38, outcomes: [{ label: 'Ja', price: 0.62 }, { label: 'Nein', price: 0.38 }] });
  assert.match(json(marketCard(yn, { currency: '$' })), /\*\*Ja\*\* 62/);
  // Geänderte Ausgänge oder Titel → Karte wird bearbeitet
  assert.notEqual(marketHash(m), marketHash({ ...m, outcomes: [{ label: 'über 120kg', price: 0.5 }, m.outcomes[1]] }));
  assert.notEqual(marketHash(m), marketHash({ ...m, title: 'Wie viel wiegt Lutscha77' }));
});

'use strict';

const { EmbedBuilder } = require('discord.js');
const theme = require('../config/theme');

const FOOTER = { text: theme.brand };

function base(color = theme.colors.neutral) {
  return new EmbedBuilder().setColor(color).setFooter(FOOTER).setTimestamp(new Date());
}

const embeds = {
  base,
  brand: () => base(theme.colors.primary),
  info: (title, description) => base(theme.colors.neutral).setTitle(title).setDescription(description ?? null),
  success: (title, description) => base(theme.colors.success).setTitle(title).setDescription(description ?? null),
  warning: (title, description) => base(theme.colors.warning).setTitle(title).setDescription(description ?? null),
  error: (title, description) => base(theme.colors.danger).setTitle(title).setDescription(description ?? null),
};

/** Wert sicher auf Discord-Längen begrenzen. */
function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** Kurz wie im Spiel: 950 · 1,5k · 10k · 2,3m · 1b (abgerundet, nie zu viel angezeigt). */
function shortNumber(value) {
  const v = Number(value), a = Math.abs(v);
  for (const [unit, size] of [['t', 1e12], ['b', 1e9], ['m', 1e6], ['k', 1e3]]) {
    if (a >= size) return `${a / size >= 100 ? Math.trunc(v / size) : nf1.format(Math.trunc((v / size) * 10) / 10)}${unit}`;
  }
  return nf.format(v);
}

function formatAmount(value, currency) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${shortNumber(value)} ${currency}`;
}

/** Preis im Bereich 0–1 als Prozent/Wahrscheinlichkeit. */
function formatPrice(value) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '—';
  return `${nf.format(Math.round(n * 1000) / 10)} %`;
}

/** Discord-Zeitstempel (wird in der Zeitzone des Lesers angezeigt). */
function discordTime(value, style = 'f') {
  if (!value) return '—';
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return '—';
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function formatRetry(ms) {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.ceil(s / 60)} Minute(n)` : `${s} Sekunde(n)`;
}

module.exports = {
  shortNumber, embeds, truncate, formatAmount, formatPrice, discordTime, formatRetry };

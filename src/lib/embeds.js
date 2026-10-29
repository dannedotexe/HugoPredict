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

function formatAmount(value, currency) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${nf.format(Number(value))} ${currency}`;
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

module.exports = { embeds, truncate, formatAmount, formatPrice, discordTime, formatRetry };

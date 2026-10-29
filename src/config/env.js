'use strict';

const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

function str(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function int(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = str(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Umgebungsvariable ${name} muss eine Zahl zwischen ${min} und ${max} sein (aktuell: "${raw}").`);
  }
  return value;
}

function bool(name, fallback) {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'ja', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'nein', 'off'].includes(raw)) return false;
  throw new Error(`Umgebungsvariable ${name} muss true oder false sein (aktuell: "${raw}").`);
}

function url(name) {
  const raw = str(name);
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Umgebungsvariable ${name} ist keine gültige URL: "${raw}".`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Umgebungsvariable ${name} muss mit http:// oder https:// beginnen.`);
  }
  return raw.replace(/\/+$/, '');
}

const env = {
  discordToken: str('DISCORD_TOKEN'),
  clientId: str('DISCORD_CLIENT_ID'),
  guildId: str('DISCORD_GUILD_ID'),

  websiteUrl: url('WEBSITE_URL'),
  apiUrl: url('HUGO_API_URL'),
  apiKey: str('HUGO_API_KEY'),
  apiTimeoutMs: int('HUGO_API_TIMEOUT_MS', 8000, { min: 1000, max: 60000 }),
  marketCreationEnabled: bool('MARKET_CREATION_ENABLED', false),

  currency: str('CURRENCY_NAME', 'HC'),
  marketFeedIntervalSeconds: int('MARKET_FEED_INTERVAL_SECONDS', 60, { min: 15, max: 3600 }),
  marketFeedMaxMarkets: int('MARKET_FEED_MAX_MARKETS', 20, { min: 1, max: 50 }),
  closingSoonHours: int('CLOSING_SOON_HOURS', 48, { min: 1, max: 720 }),
  leaderboardIntervalMinutes: int('LEADERBOARD_INTERVAL_MINUTES', 15, { min: 1, max: 1440 }),

  ticketCloseConfirmation: bool('TICKET_CLOSE_CONFIRMATION', true),
  maxOpenTicketsPerUser: int('MAX_OPEN_TICKETS_PER_USER', 2, { min: 1, max: 10 }),
  welcomeOnJoin: bool('WELCOME_ON_JOIN', false),

  dataDir: path.resolve(str('DATA_DIR', path.join(__dirname, '..', '..', 'data'))),
  logLevel: str('LOG_LEVEL', 'info'),
};

env.apiConfigured = Boolean(env.apiUrl && env.apiKey);

function assertDiscordEnv({ needToken = true } = {}) {
  const missing = [];
  if (needToken && !env.discordToken) missing.push('DISCORD_TOKEN');
  if (!env.clientId) missing.push('DISCORD_CLIENT_ID');
  if (missing.length) {
    throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}. Siehe .env.example.`);
  }
  if (env.apiUrl && env.apiUrl.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.apiUrl)) {
    // Der API-Key würde unverschlüsselt übertragen.
    throw new Error('HUGO_API_URL muss HTTPS verwenden (http:// ist nur für localhost erlaubt).');
  }
}

module.exports = { env, assertDiscordEnv };

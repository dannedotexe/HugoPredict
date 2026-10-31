import crypto from 'node:crypto';
import express from 'express';
import * as svc from './services.js';
import { botState } from './bot.js';

// Server side of the contract in docs/API.md of the bot repository.
// The bot authenticates with a shared key; without a key every request is refused.

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/;
const SNOWFLAKE = /^\d{15,25}$/;
const EXT_ID = /^[\w-]{1,64}$/;
const HEARTBEAT_TTL = 3 * 60e3;
const STATUSES = ['open', 'paused', 'closed', 'resolved', 'rejected'];

const sha = (text) => crypto.createHash('sha256').update(text).digest();
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

export const botApiKey = () => process.env.HUGO_API_KEY || '';
export const botApiEnabled = () => botApiKey().length >= 32;

function requireKey(req, res, next) {
  if (!botApiEnabled()) return res.status(503).json({ message: 'Bot-API ist nicht eingerichtet (HUGO_API_KEY fehlt)' });
  const given = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1] || '';
  if (!crypto.timingSafeEqual(sha(given), sha(botApiKey()))) return res.status(401).json({ message: 'Nicht autorisiert' });
  next();
}

const handle = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    if (!(err instanceof svc.AppError)) console.error(err);
    res.status(err.status || 500).json({ message: err instanceof svc.AppError ? err.message : 'Serverfehler' });
  }
};

function mcName(value) {
  if (!MC_NAME.test(String(value))) throw new svc.AppError('Ungültiger Minecraft-Name', 422);
  return String(value);
}

function marketForBot(m) {
  const [a, b] = m.outcomes;
  const binary = m.outcomes.length === 2 && /^ja$/i.test(a.label) && /^nein$/i.test(b.label);
  const site = (process.env.WEBSITE_URL || '').replace(/\/+$/, '');
  return {
    id: String(m.id),
    title: m.title,
    description: m.description,
    yesPrice: binary ? a.price : null,
    noPrice: binary ? b.price : null,
    volume: m.volume,
    status: m.status === 'cancelled' ? 'rejected' : m.status,
    outcome: m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label ?? null,
    closesAt: iso(m.closesAt),
    createdAt: iso(m.createdAt),
    url: site ? `${site}/#/market/${m.id}` : null,
  };
}

let heartbeatTimer;
function heartbeat({ online, username }) {
  clearTimeout(heartbeatTimer);
  botState.online = online === true;
  if (typeof username === 'string' && MC_NAME.test(username)) botState.username = username;
  heartbeatTimer = setTimeout(() => { botState.online = false; }, HEARTBEAT_TTL);
  heartbeatTimer.unref?.();
}

export const botApi = express.Router();
botApi.use(requireKey);

botApi.get('/health', handle(() => ({ status: 'ok' })));

botApi.get('/markets', handle((req) => {
  const status = String(req.query.status || 'open');
  if (!STATUSES.includes(status)) throw new svc.AppError('Unbekannter Status', 422);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  return { markets: svc.listMarkets().map(marketForBot).filter((m) => m.status === status).slice(0, limit) };
}));

botApi.post('/minecraft/heartbeat', handle((req) => heartbeat(req.body)));

botApi.post('/minecraft/links', handle((req) => {
  const { discordId, discordUsername, minecraftName, minecraftUuid } = req.body;
  if (!SNOWFLAKE.test(String(discordId))) throw new svc.AppError('Ungültige Discord-ID', 422);
  if (typeof minecraftUuid !== 'string' || !minecraftUuid) throw new svc.AppError('Minecraft-UUID fehlt', 422);
  svc.saveDiscordLink(String(discordId), discordUsername, mcName(minecraftName), minecraftUuid);
  return { linked: true };
}));

// A player whispered "login" to the bot; the bot whispers this code back to that player only.
botApi.post('/minecraft/login-codes', handle((req) => svc.createLoginCode(mcName(req.body.minecraftName))));

botApi.post('/minecraft/deposits', handle((req) => {
  const { id, minecraftName, amount } = req.body;
  if (!EXT_ID.test(String(id))) throw new svc.AppError('Ungültige Einzahlungs-ID', 422);
  if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) throw new svc.AppError('Ungültiger Betrag', 422);
  const res = svc.recordDeposit(mcName(minecraftName), amount, 'bot-api', String(id));
  return { accepted: true, linked: res.credited, credited: res.credited ? res.amount : null };
}));

// --- Discord-Befehle (/balance, /portfolio, /history, /leaderboard) ---

function discordUser(req, res) {
  if (!SNOWFLAKE.test(String(req.params.discordId))) throw new svc.AppError('Ungültige Discord-ID', 422);
  const user = svc.userByDiscord(req.params.discordId);
  if (!user) {
    res.status(404).json({ code: 'not_linked', message: 'Dein Discord-Konto ist noch nicht mit HugoPredict verknüpft. Nutze „Konto verknüpfen“ in #regeln.' });
    return null;
  }
  return user;
}
const withSite = (marketId) => {
  const site = (process.env.WEBSITE_URL || '').replace(/\/+$/, '');
  return site ? `${site}/#/market/${marketId}` : null;
};

botApi.get('/users/discord/:discordId/balance', handle((req, res) => {
  const user = discordUser(req, res);
  return user && svc.discordAccount(user.id).balance;
}));

botApi.get('/users/discord/:discordId/portfolio', handle((req, res) => {
  const user = discordUser(req, res);
  if (!user) return null;
  const acc = svc.discordAccount(user.id);
  return { totalValue: acc.totalValue, positions: acc.positions.map((p) => ({ ...p, url: withSite(p.marketId) })) };
}));

botApi.get('/users/discord/:discordId/transactions', handle((req, res) => {
  const user = discordUser(req, res);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  return user && { transactions: svc.discordAccount(user.id, { limit }).transactions };
}));

// Die Website führt eine Rangliste nach Gewinn seit Beginn. Andere Arten gibt es (noch) nicht.
botApi.get('/leaderboards/:type', handle((req) => {
  if (req.params.type !== 'all-time') throw new svc.AppError('Diese Rangliste gibt es auf der Website noch nicht', 404);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
  return {
    period: 'Seit Beginn',
    generatedAt: new Date().toISOString(),
    entries: svc.leaderboard().slice(0, limit).map((e, i) => ({
      rank: i + 1, username: e.mcName ?? e.username, value: e.profit, detail: `Vermögen ${e.netWorth}`,
    })),
  };
}));

botApi.get('/minecraft/payouts', handle(() => ({ payouts: svc.approvedPayouts() })));
botApi.post('/minecraft/payouts/:id/complete', handle((req) => svc.completePayout(Number(req.params.id))));
botApi.post('/minecraft/payouts/:id/fail', handle((req) =>
  svc.failPayout(Number(req.params.id), String(req.body.reason || '').slice(0, 300), req.body.uncertain === true)));

botApi.use((req, res) => res.status(404).json({ message: 'Nicht gefunden' }));

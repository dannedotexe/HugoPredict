import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { db } from './db.js';
import * as svc from './services.js';
import { botState, startBot } from './bot.js';
import { botApi } from './botApi.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' https://mc-heads.net data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});
app.use(express.json({ limit: '20kb' }));
app.use('/api/bot', botApi);
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), bot: botState.online }));
app.use(express.static(path.join(root, '..', 'public')));
app.get('/lmsr.js', (req, res) => res.sendFile(path.join(root, 'lmsr.js')));

const COOKIE = 'hp_session';
const cookieFlags = `HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;

function readToken(req) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)hp_session=([a-f0-9]+)/);
  return match?.[1];
}

app.use((req, res, next) => {
  req.user = svc.userBySession(readToken(req));
  next();
});

// Wraps a sync handler: return value is sent as JSON, AppErrors become 4xx responses.
const handle = (fn) => (req, res) => {
  try {
    res.json(fn(req, res) ?? { ok: true });
  } catch (err) {
    if (!(err instanceof svc.AppError)) console.error(err);
    res.status(err.status || 500).json({ error: err instanceof svc.AppError ? err.message : 'Serverfehler' });
  }
};
const auth = (req) => {
  if (!req.user) throw new svc.AppError('Bitte zuerst einloggen', 401);
  return req.user;
};
const admin = (req) => {
  if (!auth(req).isAdmin) throw new svc.AppError('Nur für Admins', 403);
  return req.user;
};

// Simple per-IP limit for login/register attempts.
const attempts = new Map();
function rateLimit(req) {
  const key = req.ip;
  const entry = attempts.get(key) || { n: 0, reset: Date.now() + 10 * 60e3 };
  if (Date.now() > entry.reset) Object.assign(entry, { n: 0, reset: Date.now() + 10 * 60e3 });
  if (++entry.n > 15) throw new svc.AppError('Zu viele Versuche, warte ein paar Minuten', 429);
  attempts.set(key, entry);
}

// ---------- Public ----------

app.get('/api/status', handle(() => ({
  botOnline: botState.online,
  botEnabled: botState.enabled,
  botName: botState.username,
  payoutsNeedApproval: !!process.env.HUGO_API_KEY,
  fee: svc.FEE,
  minWithdraw: svc.MIN_WITHDRAW,
  payCommand: (process.env.PAY_COMMAND || '/pay {player} {amount}').replace('{player}', botState.username).replace('{amount}', '<Betrag>'),
})));

app.post('/api/login/start', handle((req) => {
  rateLimit(req);
  return svc.startLogin();
}));

app.post('/api/login/poll', handle((req, res) => {
  const token = svc.pollLogin(req.body.secret);
  if (!token) return { loggedIn: false };
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieFlags}`);
  return { loggedIn: true };
}));

app.post('/api/logout', handle((req, res) => {
  svc.logout(readToken(req));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}));

app.get('/api/me', handle((req) => ({ user: req.user ? svc.publicUser(req.user) : null })));

app.get('/api/markets', handle((req) => ({ markets: svc.listMarkets(req.query) })));
app.get('/api/markets/:id', handle((req) => ({ market: svc.getMarket(Number(req.params.id), req.user?.id) })));
app.get('/api/leaderboard', handle(() => ({ leaders: svc.leaderboard() })));

// ---------- Logged in ----------

app.post('/api/markets/:id/buy', handle((req) =>
  svc.buy(auth(req).id, Number(req.params.id), Number(req.body.outcomeId), req.body.amount)));
app.post('/api/markets/:id/sell', handle((req) =>
  svc.sell(auth(req).id, Number(req.params.id), Number(req.body.outcomeId), req.body.shares)));

app.get('/api/portfolio', handle((req) => svc.portfolio(auth(req).id)));
app.get('/api/withdrawals', handle((req) => ({ withdrawals: svc.userWithdrawals(auth(req).id) })));
app.post('/api/withdrawals', handle((req) => svc.requestWithdrawal(auth(req).id, req.body.amount)));
app.post('/api/withdrawals/:id/cancel', handle((req) => svc.cancelWithdrawal(auth(req).id, Number(req.params.id))));

// ---------- Admin ----------

app.get('/api/admin/overview', handle((req) => {
  admin(req);
  return { ...svc.adminOverview(), bot: botState };
}));
app.post('/api/admin/markets', handle((req) => (admin(req), svc.createMarket(req.body))));
app.post('/api/admin/markets/:id/close', handle((req) => (admin(req), svc.closeMarket(Number(req.params.id)))));
app.post('/api/admin/markets/:id/resolve', handle((req) =>
  (admin(req), svc.resolveMarket(Number(req.params.id), Number(req.body.outcomeId)))));
app.post('/api/admin/markets/:id/cancel', handle((req) => (admin(req), svc.cancelMarket(Number(req.params.id)))));
app.post('/api/admin/withdrawals/:id/approve', handle((req) => (admin(req), svc.approveWithdrawal(Number(req.params.id)))));
app.post('/api/admin/credit', handle((req) => (admin(req), svc.adminCredit(req.body.username, req.body.amount, req.body.note))));

app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`HugoPredict läuft auf http://localhost:${port}`));
const bot = startBot();

function shutdown(signal) {
  console.log(`${signal} erhalten, fahre herunter…`);
  bot?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

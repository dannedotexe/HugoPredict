import crypto from 'node:crypto';
import { db, tx } from './db.js';
import * as lmsr from './lmsr.js';

export const FEE = Number(process.env.FEE_PERCENT ?? 1) / 100;
export const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW ?? 10);
const DEFAULT_LIQUIDITY = Number(process.env.DEFAULT_LIQUIDITY ?? 100);
const SESSION_TTL = 30 * 24 * 3600e3;
const COLORS = ['#3ddc84', '#ff5d6c', '#4da3ff', '#ffb547', '#b27cff', '#2fd6c4', '#ff7ac6', '#c7d36f', '#ff8a4c', '#8f9bb3'];
export const CATEGORIES = ['clan', 'meta', 'server', 'irl'];

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const r2 = (x) => Math.round(x * 100) / 100;
const now = () => Date.now();
const ADMIN_MC = 'alpha_noah';

// ---------- Balance ----------

export function changeBalance(userId, delta, type, ref = null) {
  delta = r2(delta);
  const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  if (!u) throw new AppError('User nicht gefunden', 404);
  const next = r2(u.balance + delta);
  if (next < 0) throw new AppError('Nicht genug Guthaben');
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(next, userId);
  db.prepare('INSERT INTO ledger (user_id, type, amount, ref, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, delta, ref, now());
  return next;
}

// ---------- Accounts ----------

const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

export function register(username, password) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username || '')) throw new AppError('Username: 3–16 Zeichen (A–Z, 0–9, _)');
  if (typeof password !== 'string' || password.length < 8) throw new AppError('Passwort braucht mindestens 8 Zeichen');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new AppError('Username ist schon vergeben');
  const salt = crypto.randomBytes(16).toString('hex');
  const r = db.prepare('INSERT INTO users (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword(password, salt), salt, now());
  return createSession(Number(r.lastInsertRowid));
}

export function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPassword(String(password || ''), u.salt), 'hex'), Buffer.from(u.pass_hash, 'hex'));
  if (!ok) throw new AppError('Username oder Passwort falsch', 401);
  return createSession(u.id);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now());
  return token;
}

export function logout(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userBySession(token) {
  if (!token) return null;
  const u = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.created_at > ?')
    .get(token, now() - SESSION_TTL);
  // Only this one Minecraft account is ever admin, never a matching username.
  if (u) u.isAdmin = (u.mc_name || '').toLowerCase() === ADMIN_MC;
  return u || null;
}

export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    balance: u.balance,
    mcName: u.mc_name,
    isAdmin: u.isAdmin,
    verifyCode: !u.mc_name && u.verify_expires > now() ? u.verify_code : null,
  };
}

// ---------- Minecraft linking ----------

export function startLink(userId) {
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  db.prepare('UPDATE users SET verify_code = ?, verify_expires = ? WHERE id = ?').run(code, now() + 15 * 60e3, userId);
  return code;
}

export function completeLink(mcName, code) {
  return tx(() => {
    const u = db.prepare('SELECT * FROM users WHERE verify_code = ? AND verify_expires > ?').get(String(code).toUpperCase(), now());
    if (!u) throw new AppError('Code ungültig oder abgelaufen');
    const taken = db.prepare('SELECT id FROM users WHERE mc_name = ? AND id <> ?').get(mcName, u.id);
    if (taken) throw new AppError('Dieser Minecraft-Name ist schon mit einem anderen Account verknüpft');
    db.prepare('UPDATE users SET mc_name = ?, verify_code = NULL, verify_expires = NULL WHERE id = ?').run(mcName, u.id);
    return { username: u.username, claimed: claimDeposits(u.id, mcName) };
  });
}

// Deposits sent before the account existed are credited now.
function claimDeposits(userId, mcName) {
  let claimed = 0;
  for (const d of db.prepare('SELECT * FROM deposits WHERE user_id IS NULL AND mc_name = ?').all(mcName)) {
    db.prepare('UPDATE deposits SET user_id = ? WHERE id = ?').run(userId, d.id);
    changeBalance(userId, d.amount, 'deposit', `dep#${d.id}`);
    claimed += d.amount;
  }
  return r2(claimed);
}

// ---------- Login through the Minecraft bot ----------
// The site shows a code, the player whispers it to the bot, and the browser that holds the secret is logged in.

// 5 Zeichen, Großbuchstaben und Ziffern ohne leicht verwechselbare (0/O, 1/I/L): 31^5 ≈ 29 Mio.
// Raten bringt nichts: Wer einen fremden Code errät, meldet den fremden Browser in SEIN Konto an.
const LOGIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LOGIN_LENGTH = 5;
const LOGIN_TTL = 5 * 60e3;
const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');

export function startLogin() {
  return tx(() => {
    db.prepare('DELETE FROM login_requests WHERE expires_at <= ?').run(now());
    // Aktive Codes sind eindeutig (code_hash ist Primärschlüssel) – bei Kollision neu würfeln.
    let code;
    do {
      code = Array.from(crypto.randomBytes(LOGIN_LENGTH), (b) => LOGIN_ALPHABET[b % LOGIN_ALPHABET.length]).join('');
    } while (db.prepare('SELECT 1 FROM login_requests WHERE code_hash = ?').get(hashCode(code)));
    const secret = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO login_requests (code_hash, secret_hash, expires_at) VALUES (?, ?, ?)').run(hashCode(code), hashCode(secret), now() + LOGIN_TTL);
    return { code, secret, expiresInSeconds: LOGIN_TTL / 1000 };
  });
}

export function confirmLogin(mcName, code) {
  const res = db.prepare('UPDATE login_requests SET mc_name = ? WHERE code_hash = ? AND mc_name IS NULL AND expires_at > ?')
    .run(mcName, hashCode(String(code || '').trim().toUpperCase()), now());
  if (!res.changes) throw new AppError('Code ungültig oder abgelaufen', 404);
}

function freeUsername(mcName) {
  const taken = (name) => db.prepare('SELECT 1 FROM users WHERE username = ?').get(name);
  if (!taken(mcName)) return mcName;
  for (let i = 2; ; i++) {
    const name = `${mcName.slice(0, 15 - String(i).length)}_${i}`;
    if (!taken(name)) return name;
  }
}

// Returns a session token once the bot confirmed the code, null while still waiting.
export function pollLogin(secret) {
  const hash = hashCode(String(secret || ''));
  return tx(() => {
    const row = db.prepare('SELECT * FROM login_requests WHERE secret_hash = ? AND expires_at > ?').get(hash, now());
    if (!row) throw new AppError('Code ungültig oder abgelaufen', 410);
    if (!row.mc_name) return null;
    db.prepare('DELETE FROM login_requests WHERE secret_hash = ?').run(hash);
    let u = db.prepare('SELECT id FROM users WHERE mc_name = ?').get(row.mc_name);
    if (!u) {
      const salt = crypto.randomBytes(16).toString('hex');
      const r = db.prepare('INSERT INTO users (username, pass_hash, salt, mc_name, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(freeUsername(row.mc_name), hashPassword(crypto.randomBytes(32).toString('hex'), salt), salt, row.mc_name, now());
      u = { id: Number(r.lastInsertRowid) };
      claimDeposits(u.id, row.mc_name);
    }
    return createSession(u.id);
  });
}

// ---------- Deposits & withdrawals ----------

export function saveDiscordLink(discordId, discordUsername, mcName, mcUuid) {
  tx(() => {
    const taken = db.prepare('SELECT discord_id FROM discord_links WHERE mc_uuid = ? AND discord_id <> ?').get(mcUuid, discordId);
    if (taken) throw new AppError('Dieses Minecraft-Konto ist schon mit einem anderen Discord-Konto verknüpft', 409);
    db.prepare(`INSERT INTO discord_links (discord_id, discord_username, mc_name, mc_uuid, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (discord_id) DO UPDATE SET discord_username = excluded.discord_username, mc_name = excluded.mc_name, mc_uuid = excluded.mc_uuid`)
      .run(discordId, String(discordUsername ?? '').slice(0, 64), mcName, mcUuid, now());
  });
}

// extId comes from the external bot: a repeated report must not credit twice.
export function recordDeposit(mcName, amount, raw, extId = null) {
  amount = r2(amount);
  if (!(amount > 0)) return null;
  return tx(() => {
    const seen = extId && db.prepare('SELECT amount, user_id FROM deposits WHERE ext_id = ?').get(extId);
    if (seen) return { credited: seen.user_id !== null, amount: seen.amount };
    const u = db.prepare('SELECT id FROM users WHERE mc_name = ?').get(mcName);
    const r = db.prepare('INSERT INTO deposits (mc_name, amount, user_id, raw, ext_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(mcName, amount, u?.id ?? null, raw, extId, now());
    if (u) changeBalance(u.id, amount, 'deposit', `dep#${r.lastInsertRowid}`);
    return { credited: !!u, amount };
  });
}

export function requestWithdrawal(userId, amount) {
  amount = Number(amount);
  if (!Number.isInteger(amount) || amount < MIN_WITHDRAW) throw new AppError(`Auszahlung: ganze Zahl, mindestens ${MIN_WITHDRAW}`);
  return tx(() => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!u.mc_name) throw new AppError('Verknüpfe zuerst deinen Minecraft-Account');
    const open = db.prepare("SELECT COUNT(*) n FROM withdrawals WHERE user_id = ? AND status IN ('pending', 'approved', 'processing')").get(userId).n;
    if (open >= 3) throw new AppError('Du hast schon 3 offene Auszahlungen');
    const r = db.prepare('INSERT INTO withdrawals (user_id, mc_name, amount, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, u.mc_name, amount, now());
    changeBalance(userId, -amount, 'withdraw', `wd#${r.lastInsertRowid}`);
    return { id: Number(r.lastInsertRowid) };
  });
}

export function cancelWithdrawal(userId, id) {
  return tx(() => {
    const w = db.prepare("SELECT * FROM withdrawals WHERE id = ? AND user_id = ? AND status = 'pending'").get(id, userId);
    if (!w) throw new AppError('Auszahlung kann nicht mehr storniert werden');
    db.prepare("UPDATE withdrawals SET status = 'cancelled', processed_at = ? WHERE id = ?").run(now(), id);
    changeBalance(userId, w.amount, 'withdraw_refund', `wd#${id}`);
  });
}

export function nextWithdrawal() {
  return db.prepare("SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY id LIMIT 1").get();
}

export function markWithdrawal(id, status, error = null) {
  tx(() => {
    db.prepare('UPDATE withdrawals SET status = ?, error = ?, processed_at = ? WHERE id = ?').run(status, error, now(), id);
    if (status === 'failed') {
      const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
      changeBalance(w.user_id, w.amount, 'withdraw_refund', `wd#${id}`);
    }
  });
}

// ---------- Payouts through the external bot ----------
// The team approves each withdrawal; the bot only ever sees approved ones.

export function approveWithdrawal(id) {
  const r = db.prepare("UPDATE withdrawals SET status = 'approved' WHERE id = ? AND status = 'pending'").run(id);
  if (!r.changes) throw new AppError('Auszahlung wartet nicht auf Freigabe');
}

export function approvedPayouts() {
  return db.prepare("SELECT id, mc_name, amount FROM withdrawals WHERE status = 'approved' ORDER BY id").all()
    .map((w) => ({ id: String(w.id), minecraftName: w.mc_name, amount: w.amount }));
}

function payoutById(id) {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
  if (!w) throw new AppError('Auszahlung nicht gefunden', 404);
  return w;
}

export function completePayout(id) {
  tx(() => {
    const w = payoutById(id);
    if (w.status === 'done') return;
    if (!['approved', 'uncertain'].includes(w.status)) throw new AppError('Auszahlung ist nicht freigegeben', 409);
    db.prepare("UPDATE withdrawals SET status = 'done', error = NULL, processed_at = ? WHERE id = ?").run(now(), id);
  });
}

// uncertain: the money may have moved, so nothing is refunded until the team has checked in game.
export function failPayout(id, reason, uncertain) {
  tx(() => {
    const w = payoutById(id);
    if (w.status === (uncertain ? 'uncertain' : 'failed')) return;
    if (w.status !== 'approved') throw new AppError('Auszahlung ist nicht freigegeben', 409);
    db.prepare('UPDATE withdrawals SET status = ?, error = ?, processed_at = ? WHERE id = ?')
      .run(uncertain ? 'uncertain' : 'failed', reason, now(), id);
    if (!uncertain) changeBalance(w.user_id, w.amount, 'withdraw_refund', `wd#${id}`);
  });
}

export function userWithdrawals(userId) {
  return db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(userId);
}

// ---------- Markets ----------

const outcomesOf = (marketId) => db.prepare('SELECT * FROM outcomes WHERE market_id = ? ORDER BY id').all(marketId);

function marketView(m) {
  const outs = outcomesOf(m.id);
  const ps = lmsr.prices(outs.map((o) => o.q), m.b);
  const closed = m.status === 'open' && m.closes_at && now() > m.closes_at;
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    category: m.category,
    emoji: m.emoji,
    b: m.b,
    status: closed ? 'closed' : m.status,
    closesAt: m.closes_at,
    resolvedOutcomeId: m.resolved_outcome_id,
    createdAt: m.created_at,
    volume: r2(m.volume ?? 0),
    outcomes: outs.map((o, i) => ({ id: o.id, label: o.label, color: o.color, q: o.q, price: ps[i] })),
  };
}

const MARKET_SELECT = 'SELECT m.*, COALESCE((SELECT SUM(amount) FROM trades t WHERE t.market_id = m.id), 0) AS volume FROM markets m';

export function listMarkets({ category, status } = {}) {
  let rows = db.prepare(`${MARKET_SELECT} ORDER BY m.id DESC`).all().map(marketView);
  if (category && category !== 'all') rows = rows.filter((m) => m.category === category);
  if (status === 'open') rows = rows.filter((m) => m.status === 'open');
  else if (status === 'done') rows = rows.filter((m) => m.status !== 'open');
  const rank = { open: 0, closed: 1, resolved: 2, cancelled: 3 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || b.volume - a.volume);
}

export function getMarket(id, userId) {
  const m = db.prepare(`${MARKET_SELECT} WHERE m.id = ?`).get(id);
  if (!m) throw new AppError('Markt nicht gefunden', 404);
  const view = marketView(m);

  const n = view.outcomes.length;
  const trades = db.prepare('SELECT created_at, prices FROM trades WHERE market_id = ? ORDER BY id').all(id);
  let history = [{ t: m.created_at, p: Array(n).fill(1 / n) }, ...trades.map((t) => ({ t: t.created_at, p: JSON.parse(t.prices) }))];
  if (history.length > 300) {
    const step = history.length / 300;
    history = Array.from({ length: 300 }, (_, i) => history[Math.floor(i * step)]).concat(history.at(-1));
  }
  history.push({ t: now(), p: view.outcomes.map((o) => o.price) });

  const recent = db.prepare(`SELECT t.side, t.shares, t.amount, t.outcome_id, t.created_at, u.username
    FROM trades t JOIN users u ON u.id = t.user_id WHERE t.market_id = ? ORDER BY t.id DESC LIMIT 15`).all(id);
  const positions = userId
    ? db.prepare('SELECT outcome_id, shares, spent FROM positions WHERE user_id = ? AND market_id = ? AND shares > 0').all(userId, id)
    : [];
  return { ...view, history, recent, positions };
}

export function createMarket({ title, description = '', category, emoji, closesAt, b, outcomes }) {
  title = String(title || '').trim();
  if (title.length < 5) throw new AppError('Titel ist zu kurz');
  if (!CATEGORIES.includes(category)) throw new AppError('Ungültige Kategorie');
  const labels = (outcomes || []).map((o) => String(o).trim()).filter(Boolean);
  if (labels.length < 2 || labels.length > 10) throw new AppError('2 bis 10 Outcomes nötig');
  if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw new AppError('Outcomes müssen unterschiedlich sein');
  const liquidity = Number(b) || DEFAULT_LIQUIDITY;
  if (liquidity < 10 || liquidity > 100000) throw new AppError('Liquidität muss zwischen 10 und 100000 liegen');
  const closes = closesAt ? new Date(closesAt).getTime() : null;
  if (closes !== null && !(closes > now())) throw new AppError('Schlusszeit muss in der Zukunft liegen');

  return tx(() => {
    const r = db.prepare('INSERT INTO markets (title, description, category, emoji, b, closes_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(title, String(description), category, String(emoji || '🎲').slice(0, 8), liquidity, closes, now());
    const marketId = Number(r.lastInsertRowid);
    const binary = labels.length === 2 && /^ja$/i.test(labels[0]) && /^nein$/i.test(labels[1]);
    labels.forEach((label, i) => {
      const color = binary ? COLORS[i] : COLORS[(i + 2) % COLORS.length];
      db.prepare('INSERT INTO outcomes (market_id, label, color) VALUES (?, ?, ?)').run(marketId, label, color);
    });
    return { id: marketId };
  });
}

function tradableMarket(marketId) {
  const m = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
  if (!m) throw new AppError('Markt nicht gefunden', 404);
  if (m.status !== 'open' || (m.closes_at && now() > m.closes_at)) throw new AppError('Dieser Markt ist geschlossen');
  return m;
}

function recordTrade(userId, m, outs, idx, side, shares, amount, fee) {
  const ps = lmsr.prices(outs.map((o) => o.q), m.b);
  db.prepare('INSERT INTO trades (user_id, market_id, outcome_id, side, shares, amount, fee, prices, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, m.id, outs[idx].id, side, shares, amount, fee, JSON.stringify(ps.map((p) => Math.round(p * 1e4) / 1e4)), now());
  return ps[idx];
}

export function buy(userId, marketId, outcomeId, amount) {
  amount = r2(Number(amount));
  if (!(amount >= 1)) throw new AppError('Mindesteinsatz ist 1');
  return tx(() => {
    const m = tradableMarket(marketId);
    const outs = outcomesOf(marketId);
    const idx = outs.findIndex((o) => o.id === outcomeId);
    if (idx < 0) throw new AppError('Outcome nicht gefunden');

    const fee = r2(amount * FEE);
    const shares = lmsr.sharesForAmount(outs.map((o) => o.q), m.b, idx, amount - fee);
    changeBalance(userId, -amount, 'buy', `m#${marketId}`);
    outs[idx].q += shares;
    db.prepare('UPDATE outcomes SET q = ? WHERE id = ?').run(outs[idx].q, outcomeId);
    db.prepare(`INSERT INTO positions (user_id, outcome_id, market_id, shares, spent) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, outcome_id) DO UPDATE SET shares = shares + excluded.shares, spent = spent + excluded.spent`)
      .run(userId, outcomeId, marketId, shares, amount);
    const price = recordTrade(userId, m, outs, idx, 'buy', shares, amount, fee);
    return { shares, price };
  });
}

export function sell(userId, marketId, outcomeId, shares) {
  shares = Number(shares);
  if (!(shares > 0)) throw new AppError('Ungültige Anzahl Anteile');
  return tx(() => {
    const m = tradableMarket(marketId);
    const outs = outcomesOf(marketId);
    const idx = outs.findIndex((o) => o.id === outcomeId);
    if (idx < 0) throw new AppError('Outcome nicht gefunden');
    const pos = db.prepare('SELECT * FROM positions WHERE user_id = ? AND outcome_id = ?').get(userId, outcomeId);
    if (!pos || pos.shares < shares - 1e-6) throw new AppError('Du hast nicht so viele Anteile');
    shares = Math.min(shares, pos.shares);

    const gross = lmsr.sellValue(outs.map((o) => o.q), m.b, idx, shares);
    const fee = r2(gross * FEE);
    const payout = r2(gross - fee);
    outs[idx].q -= shares;
    db.prepare('UPDATE outcomes SET q = ? WHERE id = ?').run(outs[idx].q, outcomeId);
    if (pos.shares - shares < 1e-6) db.prepare('DELETE FROM positions WHERE user_id = ? AND outcome_id = ?').run(userId, outcomeId);
    else db.prepare('UPDATE positions SET shares = shares - ?, spent = spent - ? WHERE user_id = ? AND outcome_id = ?').run(shares, payout, userId, outcomeId);
    changeBalance(userId, payout, 'sell', `m#${marketId}`);
    const price = recordTrade(userId, m, outs, idx, 'sell', shares, payout, fee);
    return { payout, price };
  });
}

export function closeMarket(marketId) {
  const r = db.prepare("UPDATE markets SET status = 'closed' WHERE id = ? AND status = 'open'").run(marketId);
  if (!r.changes) throw new AppError('Markt ist nicht offen');
}

export function resolveMarket(marketId, outcomeId) {
  return tx(() => {
    const m = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
    if (!m || !['open', 'closed'].includes(m.status)) throw new AppError('Markt kann nicht aufgelöst werden');
    if (!outcomesOf(marketId).some((o) => o.id === outcomeId)) throw new AppError('Outcome gehört nicht zu diesem Markt');
    let paid = 0;
    for (const p of db.prepare('SELECT * FROM positions WHERE market_id = ? AND outcome_id = ? AND shares > 0').all(marketId, outcomeId)) {
      changeBalance(p.user_id, p.shares, 'payout', `m#${marketId}`);
      paid += p.shares;
    }
    db.prepare('DELETE FROM positions WHERE market_id = ?').run(marketId);
    db.prepare("UPDATE markets SET status = 'resolved', resolved_outcome_id = ?, resolved_at = ? WHERE id = ?").run(outcomeId, now(), marketId);
    return { paid: r2(paid) };
  });
}

export function cancelMarket(marketId) {
  return tx(() => {
    const m = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
    if (!m || !['open', 'closed'].includes(m.status)) throw new AppError('Markt kann nicht storniert werden');
    // Refund each user's net stake (what they put in minus what they already sold for).
    const rows = db.prepare('SELECT user_id, SUM(spent) spent FROM positions WHERE market_id = ? GROUP BY user_id').all(marketId);
    for (const r of rows) if (r.spent > 0) changeBalance(r.user_id, r.spent, 'refund', `m#${marketId}`);
    db.prepare('DELETE FROM positions WHERE market_id = ?').run(marketId);
    db.prepare("UPDATE markets SET status = 'cancelled', resolved_at = ? WHERE id = ?").run(now(), marketId);
  });
}

// ---------- Portfolio & stats ----------

function priceMap() {
  const map = new Map();
  for (const m of db.prepare("SELECT id, b FROM markets WHERE status IN ('open', 'closed')").all()) {
    const outs = outcomesOf(m.id);
    lmsr.prices(outs.map((o) => o.q), m.b).forEach((p, i) => map.set(outs[i].id, p));
  }
  return map;
}

export function portfolio(userId) {
  const prices = priceMap();
  const positions = db.prepare(`SELECT p.*, o.label, o.color, m.title, m.emoji, m.status
    FROM positions p JOIN outcomes o ON o.id = p.outcome_id JOIN markets m ON m.id = p.market_id
    WHERE p.user_id = ? AND p.shares > 0 ORDER BY m.id DESC`).all(userId)
    .map((p) => ({ ...p, price: prices.get(p.outcome_id) ?? 0, value: r2(p.shares * (prices.get(p.outcome_id) ?? 0)) }));
  const ledger = db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(userId);
  return { positions, ledger };
}

// ---------- Discord ----------

// Website-Konto zu einer Discord-ID (über die Verknüpfung, die der Bot meldet).
export function userByDiscord(discordId) {
  return db.prepare(`SELECT u.* FROM discord_links d JOIN users u ON u.mc_name = d.mc_name WHERE d.discord_id = ?`).get(String(discordId)) ?? null;
}

const LEDGER_LABELS = {
  deposit: 'Einzahlung', withdraw: 'Auszahlung', withdraw_refund: 'Auszahlung zurückgebucht',
  buy: 'Kauf', sell: 'Verkauf', payout: 'Gewinn', refund: 'Erstattung', admin: 'Korrektur',
};

/** Konto für die Discord-Befehle /balance, /portfolio und /history. */
export function discordAccount(userId, { limit = 10 } = {}) {
  const { positions, ledger } = portfolio(userId);
  const u = db.prepare('SELECT username, mc_name, balance FROM users WHERE id = ?').get(userId);
  const locked = r2(positions.reduce((sum, p) => sum + p.value, 0));
  return {
    balance: { balance: r2(u.balance + locked), available: r2(u.balance), locked, username: u.mc_name ?? u.username },
    positions: positions.map((p) => ({
      marketId: String(p.market_id), marketTitle: p.title, side: p.label, shares: r2(p.shares),
      avgPrice: p.shares > 0 ? r2(p.spent / p.shares) : null, currentPrice: r2(p.price), value: p.value,
    })),
    totalValue: locked,
    transactions: ledger.slice(0, limit).map((l) => ({
      id: String(l.id), type: l.type, amount: r2(l.amount),
      description: LEDGER_LABELS[l.type] ?? l.type, createdAt: new Date(l.created_at).toISOString(),
    })),
  };
}

// ---------- Admin-Panel im Discord (/panel, nur lesend) ----------

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const one = (sql, ...args) => db.prepare(sql).get(...args);

/** Kennzahlen für das Dashboard und die Wirtschaftsseite. */
export function panelSummary() {
  const prices = priceMap();
  let positionsValue = 0;
  for (const p of db.prepare('SELECT outcome_id, shares FROM positions WHERE shares > 0').all()) positionsValue += p.shares * (prices.get(p.outcome_id) ?? 0);
  const marketCounts = Object.fromEntries(listMarkets().reduce((m, x) => m.set(x.status, (m.get(x.status) || 0) + 1), new Map()));
  const withdrawals = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n, COALESCE(SUM(amount), 0) s FROM withdrawals GROUP BY status').all()
    .map((w) => [w.status, { count: w.n, sum: r2(w.s) }]));
  return {
    users: one('SELECT COUNT(*) n FROM users').n,
    mcPlayers: one('SELECT COUNT(*) n FROM users WHERE mc_name IS NOT NULL').n,
    discordLinks: one('SELECT COUNT(*) n FROM discord_links').n,
    balances: r2(one('SELECT COALESCE(SUM(balance), 0) s FROM users').s),
    positionsValue: r2(positionsValue),
    trades: one('SELECT COUNT(*) n FROM trades').n,
    volume: r2(one('SELECT COALESCE(SUM(amount), 0) s FROM trades').s),
    fees: r2(one('SELECT COALESCE(SUM(fee), 0) s FROM trades').s),
    deposits: { count: one('SELECT COUNT(*) n FROM deposits').n, sum: r2(one('SELECT COALESCE(SUM(amount), 0) s FROM deposits').s), unclaimed: r2(one('SELECT COALESCE(SUM(amount), 0) s FROM deposits WHERE user_id IS NULL').s) },
    withdrawals,
    markets: marketCounts,
    top: db.prepare('SELECT username, mc_name, balance FROM users ORDER BY balance DESC LIMIT 10').all()
      .map((u) => ({ username: u.username, mcName: u.mc_name, balance: r2(u.balance) })),
  };
}

/** Registrierte Nutzer mit Discord-Verknüpfung, durchsuchbar. */
export function panelUsers({ q = '', offset = 0, limit = 10 } = {}) {
  const like = `%${String(q).trim().replace(/[%_]/g, '')}%`;
  const where = `WHERE u.username LIKE ? OR u.mc_name LIKE ? OR d.discord_username LIKE ? OR d.discord_id LIKE ?`;
  const from = 'FROM users u LEFT JOIN discord_links d ON d.mc_name = u.mc_name';
  const total = one(`SELECT COUNT(*) n ${from} ${where}`, like, like, like, like).n;
  const users = db.prepare(`SELECT u.id, u.username, u.mc_name, u.balance, u.created_at, d.discord_id, d.discord_username
    ${from} ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(like, like, like, like, limit, offset)
    .map((u) => ({ id: u.id, username: u.username, mcName: u.mc_name, balance: r2(u.balance), createdAt: iso(u.created_at), discordId: u.discord_id ?? null, discordName: u.discord_username ?? null }));
  return { total, users };
}

/** Märkte mit Status, Volumen und Ergebnis. */
export function panelMarkets() {
  return {
    markets: listMarkets().map((m) => ({
      id: m.id, title: m.title, category: m.category, status: m.status, volume: m.volume,
      closesAt: iso(m.closesAt), createdAt: iso(m.createdAt),
      outcomes: m.outcomes.map((o) => ({ label: o.label, price: r2(o.price) })),
      result: m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label ?? null,
    })),
  };
}

/** Letzte Buchungen (Ledger), optional nach Typ gefiltert. */
export function panelTransactions({ type = '', limit = 15 } = {}) {
  const rows = type
    ? db.prepare('SELECT l.*, u.username, u.mc_name FROM ledger l JOIN users u ON u.id = l.user_id WHERE l.type = ? ORDER BY l.id DESC LIMIT ?').all(type, limit)
    : db.prepare('SELECT l.*, u.username, u.mc_name FROM ledger l JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ?').all(limit);
  return {
    transactions: rows.map((l) => ({
      id: String(l.id), type: l.type, label: LEDGER_LABELS[l.type] ?? l.type, amount: r2(l.amount),
      user: l.mc_name ?? l.username, ref: l.ref, createdAt: iso(l.created_at),
    })),
  };
}

export function leaderboard() {
  const prices = priceMap();
  const values = new Map();
  for (const p of db.prepare('SELECT user_id, outcome_id, shares FROM positions WHERE shares > 0').all())
    values.set(p.user_id, (values.get(p.user_id) || 0) + p.shares * (prices.get(p.outcome_id) ?? 0));
  const profit = new Map(
    db.prepare(`SELECT user_id, SUM(CASE WHEN type IN ('deposit','withdraw','withdraw_refund','admin') THEN 0 ELSE amount END) pnl
      FROM ledger GROUP BY user_id`).all().map((r) => [r.user_id, r.pnl]),
  );
  return db.prepare('SELECT id, username, mc_name, balance FROM users').all()
    .map((u) => {
      const inPositions = values.get(u.id) || 0;
      return { username: u.username, mcName: u.mc_name, netWorth: r2(u.balance + inPositions), profit: r2((profit.get(u.id) || 0) + inPositions) };
    })
    .filter((u) => u.netWorth > 0 || u.profit !== 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 25);
}

export function adminOverview() {
  return {
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    totalBalance: r2(db.prepare('SELECT COALESCE(SUM(balance), 0) s FROM users').get().s),
    fees: r2(db.prepare('SELECT COALESCE(SUM(fee), 0) s FROM trades').get().s),
    withdrawals: db.prepare(`SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id = w.user_id
      ORDER BY (w.status IN ('pending','approved','processing','uncertain','failed')) DESC, w.id DESC LIMIT 30`).all(),
    deposits: db.prepare('SELECT d.*, u.username FROM deposits d LEFT JOIN users u ON u.id = d.user_id ORDER BY d.id DESC LIMIT 30').all(),
  };
}

export function adminCredit(username, amount, note) {
  amount = r2(Number(amount));
  if (!amount) throw new AppError('Ungültiger Betrag');
  return tx(() => {
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username || ''));
    if (!u) throw new AppError('User nicht gefunden', 404);
    return { balance: changeBalance(u.id, amount, 'admin', String(note || '').slice(0, 100) || null) };
  });
}

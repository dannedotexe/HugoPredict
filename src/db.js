import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = process.env.DB_FILE || 'data/hugopredict.db';
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    mc_name TEXT UNIQUE COLLATE NOCASE,
    verify_code TEXT,
    verify_expires INTEGER,
    balance REAL NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS markets (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🎲',
    b REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    closes_at INTEGER,
    resolved_outcome_id INTEGER,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outcomes (
    id INTEGER PRIMARY KEY,
    market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    q REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS positions (
    user_id INTEGER NOT NULL REFERENCES users(id),
    outcome_id INTEGER NOT NULL REFERENCES outcomes(id),
    market_id INTEGER NOT NULL REFERENCES markets(id),
    shares REAL NOT NULL DEFAULT 0,
    spent REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, outcome_id)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    market_id INTEGER NOT NULL REFERENCES markets(id),
    outcome_id INTEGER NOT NULL REFERENCES outcomes(id),
    side TEXT NOT NULL,
    shares REAL NOT NULL,
    amount REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    prices TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY,
    mc_name TEXT NOT NULL COLLATE NOCASE,
    amount REAL NOT NULL,
    user_id INTEGER REFERENCES users(id),
    raw TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    mc_name TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at INTEGER NOT NULL,
    processed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    ref TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discord_links (
    discord_id TEXT PRIMARY KEY,
    discord_username TEXT,
    mc_name TEXT NOT NULL COLLATE NOCASE,
    mc_uuid TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_codes (
    mc_name TEXT PRIMARY KEY COLLATE NOCASE,
    code_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id, id);
  CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id);
`);

// Databases created before the bot API lack the id that makes deposit reports idempotent.
if (!db.prepare('PRAGMA table_info(deposits)').all().some((c) => c.name === 'ext_id')) {
  db.exec('ALTER TABLE deposits ADD COLUMN ext_id TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_ext ON deposits(ext_id) WHERE ext_id IS NOT NULL');

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

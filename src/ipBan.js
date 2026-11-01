// IP- und Geräte-Sperren: Wird ein Konto gesperrt, werden auch seine IP-Adressen
// und Geräte (zufällige Kennung im Browser) gesperrt. Von dort ist dann kein Login
// und kein Bieten/Auszahlen mehr möglich – auch nicht mit einem Zweitaccount.
// Beides wird nur als Hash (HMAC mit geheimem Schlüssel) gespeichert und nach
// 90 Tagen ohne Nutzung gelöscht. Tabellen heißen aus Kompatibilität *_ips.
import crypto from 'node:crypto';
import { db } from './db.js';

const KEEP_MS = 90 * 24 * 3600e3;
const TOUCH_MS = 10 * 60e3; // dieselbe IP höchstens alle 10 Minuten neu schreiben

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS user_ips (
    user_id INTEGER NOT NULL, ip_hash TEXT NOT NULL, last_seen INTEGER NOT NULL,
    PRIMARY KEY (user_id, ip_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_user_ips_hash ON user_ips(ip_hash);
  CREATE TABLE IF NOT EXISTS banned_ips (
    ip_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, rule TEXT, created_at INTEGER NOT NULL
  );
`);

let key = db.prepare("SELECT value FROM meta WHERE key = 'ip_key'").get()?.value;
if (!key) {
  key = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO meta (key, value) VALUES ('ip_key', ?)").run(key);
}

const hmac = (v) => crypto.createHmac('sha256', key).update(v).digest('hex');
export const ipHash = (ip) => (ip ? hmac(String(ip).replace(/^::ffff:/, '')) : null);
export const DEVICE_ID = /^[a-f0-9]{32}$/;
export const deviceHash = (id) => (DEVICE_ID.test(String(id ?? '')) ? hmac(`d:${id}`) : null);
const hashes = (ip, device) => [ipHash(ip), deviceHash(device)].filter(Boolean);

const touched = new Map();
/** Merkt sich, von welcher IP und welchem Gerät ein Konto die Website nutzt. */
export function seen(userId, ip, device = null) {
  if (!userId) return;
  for (const h of hashes(ip, device)) {
    const k = `${userId}:${h}`;
    if (Date.now() - (touched.get(k) || 0) < TOUCH_MS) continue;
    touched.set(k, Date.now());
    db.prepare(`INSERT INTO user_ips (user_id, ip_hash, last_seen) VALUES (?, ?, ?)
      ON CONFLICT(user_id, ip_hash) DO UPDATE SET last_seen = excluded.last_seen`).run(userId, h, Date.now());
  }
  if (Math.random() < 0.01) db.prepare('DELETE FROM user_ips WHERE last_seen < ?').run(Date.now() - KEEP_MS);
}

/** Paragraf der Sperre (IP oder Gerät) oder null. */
export function ipBanRule(ip, device = null) {
  for (const h of hashes(ip, device)) {
    const row = db.prepare('SELECT rule FROM banned_ips WHERE ip_hash = ?').get(h);
    if (row) return row.rule ?? '';
  }
  return null;
}

/** Alle IPs des Kontos sperren – außer solche, die auch ein Admin nutzt. */
export function banUserIps(userId, rule, adminIds = []) {
  const skip = new Set(adminIds.length
    ? db.prepare(`SELECT ip_hash FROM user_ips WHERE user_id IN (${adminIds.map(() => '?').join(',')})`).all(...adminIds).map((r) => r.ip_hash)
    : []);
  let n = 0;
  for (const { ip_hash: h } of db.prepare('SELECT ip_hash FROM user_ips WHERE user_id = ?').all(userId)) {
    if (skip.has(h)) continue;
    db.prepare('INSERT OR REPLACE INTO banned_ips (ip_hash, user_id, rule, created_at) VALUES (?, ?, ?, ?)').run(h, userId, rule, Date.now());
    n += 1;
  }
  return n;
}

export function unbanUserIps(userId) {
  return db.prepare('DELETE FROM banned_ips WHERE user_id = ?').run(userId).changes;
}

/** Andere Konten, die schon dieselbe IP genutzt haben (Hinweis auf Zweitaccounts). */
export function sharedIpUsers(userId) {
  return db.prepare(`SELECT DISTINCT u.id, u.username, u.mc_name, u.banned FROM user_ips a
    JOIN user_ips b ON b.ip_hash = a.ip_hash AND b.user_id != a.user_id
    JOIN users u ON u.id = b.user_id WHERE a.user_id = ? LIMIT 20`).all(userId)
    .map((u) => ({ id: u.id, name: u.mc_name || u.username, banned: !!u.banned }));
}

'use strict';

const crypto = require('node:crypto');

/*
 * Codes für die Kontoverknüpfung. Der Minecraft-Bot flüstert den Code dem
 * Spieler im Spiel zu, die Person gibt ihn in Discord ein. Nur wer wirklich
 * mit diesem Minecraft-Konto online ist, kann den Code kennen.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I
const CODE_LENGTH = 6;

class LinkCodes {
  constructor({ ttlMs = 10 * 60_000, maxAttempts = 5, resendMs = 60_000, now = Date.now } = {}) {
    Object.assign(this, { ttlMs, maxAttempts, resendMs, now });
    this.byDiscord = new Map();
  }

  /** Neuer Code für eine Discord-ID. Gibt { code } oder { retryAfterMs } zurück. */
  create(discordId, player) {
    const existing = this.byDiscord.get(discordId);
    const t = this.now();
    if (existing && t - existing.createdAt < this.resendMs) return { retryAfterMs: this.resendMs - (t - existing.createdAt) };
    const code = Array.from(crypto.randomBytes(CODE_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join('');
    this.byDiscord.set(discordId, { code, player, createdAt: t, attempts: 0 });
    return { code };
  }

  /** Prüft einen eingegebenen Code. Gibt { player } oder { error } zurück. */
  verify(discordId, input) {
    const entry = this.byDiscord.get(discordId);
    if (!entry) return { error: 'missing' };
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.byDiscord.delete(discordId);
      return { error: 'expired' };
    }
    const given = String(input ?? '').trim().toUpperCase();
    const a = Buffer.from(given);
    const b = Buffer.from(entry.code);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      entry.attempts += 1;
      if (entry.attempts >= this.maxAttempts) {
        this.byDiscord.delete(discordId);
        return { error: 'locked' };
      }
      return { error: 'wrong', attemptsLeft: this.maxAttempts - entry.attempts };
    }
    this.byDiscord.delete(discordId);
    return { player: entry.player };
  }

  pending(discordId) {
    const entry = this.byDiscord.get(discordId);
    return Boolean(entry && this.now() - entry.createdAt <= this.ttlMs);
  }
}

module.exports = { LinkCodes, CODE_LENGTH };

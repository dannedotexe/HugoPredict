'use strict';

/**
 * Sliding-Window-Rate-Limiter im Speicher.
 * hit() gibt { ok: true } zurück oder { ok: false, retryAfterMs }.
 */
class RateLimiter {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.buckets = new Map();
  }

  hit(key, { limit, windowMs }) {
    const t = this.now();
    const list = (this.buckets.get(key) ?? []).filter((ts) => t - ts < windowMs);
    if (list.length >= limit) {
      this.buckets.set(key, list);
      return { ok: false, retryAfterMs: windowMs - (t - list[0]) };
    }
    list.push(t);
    this.buckets.set(key, list);
    return { ok: true };
  }

  sweep(maxWindowMs = 3_600_000) {
    const t = this.now();
    for (const [key, list] of this.buckets) {
      const kept = list.filter((ts) => t - ts < maxWindowMs);
      if (kept.length) this.buckets.set(key, kept);
      else this.buckets.delete(key);
    }
  }
}

/** Verhindert, dass dieselbe Aktion parallel mehrfach läuft (z. B. Doppelklick). */
class LockSet {
  constructor() {
    this.locks = new Set();
  }

  async run(key, fn) {
    if (this.locks.has(key)) return { locked: true };
    this.locks.add(key);
    try {
      return { locked: false, value: await fn() };
    } finally {
      this.locks.delete(key);
    }
  }
}

// Limits für sensible Commands: [Anzahl, Zeitfenster in ms]
const LIMITS = {
  default: { limit: 8, windowMs: 30_000 },
  balance: { limit: 5, windowMs: 30_000 },
  portfolio: { limit: 5, windowMs: 30_000 },
  history: { limit: 5, windowMs: 30_000 },
  daily: { limit: 3, windowMs: 60_000 },
  verify: { limit: 4, windowMs: 10 * 60_000 },
  verifyCheck: { limit: 10, windowMs: 10 * 60_000 },
  suggest: { limit: 2, windowMs: 10 * 60_000 },
  ticket: { limit: 2, windowMs: 5 * 60_000 },
  vote: { limit: 20, windowMs: 60_000 },
  setup: { limit: 2, windowMs: 60_000 },
};

module.exports = { RateLimiter, LockSet, LIMITS };

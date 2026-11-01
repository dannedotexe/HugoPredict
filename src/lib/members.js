'use strict';

/*
 * Alle Mitglieder eines Servers holen – aber nur einmal pro Minute.
 * Discord drosselt die Gateway-Abfrage (opcode 8) stark; holen mehrere
 * Dienste kurz hintereinander die Liste (z. B. bei /aktualisieren), teilen
 * sie sich ein Ergebnis. Wird trotzdem gedrosselt, wartet der Bot die
 * genannte Zeit und versucht es einmal neu, sonst nimmt er den Cache.
 */

const FRESH_MS = 60_000;
const cache = new Map(); // guildId → { at, promise }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(guild, waitFn) {
  try {
    return await guild.members.fetch();
  } catch (err) {
    const retry = /retry after ([\d.]+) seconds/i.exec(err.message ?? '');
    if (retry) {
      await waitFn(Math.ceil(Number(retry[1]) * 1000) + 500);
      try { return await guild.members.fetch(); } catch { /* unten: Cache */ }
    }
    if (guild.members.cache?.size) return guild.members.cache;
    throw err;
  }
}

function allMembers(guild, { now = Date.now, waitFn = wait } = {}) {
  const hit = cache.get(guild.id);
  if (hit && now() - hit.at < FRESH_MS) return hit.promise;
  const promise = fetchOnce(guild, waitFn);
  cache.set(guild.id, { at: now(), promise });
  promise.catch(() => cache.delete(guild.id));
  return promise;
}

module.exports = { allMembers, _reset: () => cache.clear() };

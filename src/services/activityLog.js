'use strict';

/*
 * Aktivitätsprotokoll für das Admin-Panel (/panel): merkt sich die letzten
 * Protokolleinträge (ctx.audit) sowie Warnungen und Fehler des Loggers.
 * Nur im Speicher; das bisherige Verhalten von ctx.audit und Logger bleibt gleich.
 */

const MAX_ENTRIES = 200;

/** Ringpuffer für die letzten Ereignisse (nur im Speicher, geht bei Neustart verloren). */
function createActivityLog(max = MAX_ENTRIES) {
  const entries = [];
  return {
    push(entry) {
      entries.push({ at: new Date().toISOString(), ...entry });
      if (entries.length > max) entries.shift();
    },
    list: (filter = () => true) => entries.filter(filter).slice().reverse(),
  };
}

/** Hängt Protokoll-Einträge und Warnungen/Fehler an den Ringpuffer, ohne das Verhalten zu ändern. */
function instrument({ ctx, logger, activity }) {
  const audit = ctx.audit;
  ctx.audit = (guild, route, entry = {}) => {
    activity.push({
      kind: 'audit',
      route,
      guildId: guild?.id ?? null,
      guildName: guild?.name ?? null,
      title: String(entry.title ?? '').slice(0, 200),
      description: entry.description ? String(entry.description).slice(0, 500) : null,
      fields: (entry.fields ?? []).slice(0, 8).map((f) => ({ name: String(f.name).slice(0, 80), value: String(f.value ?? '').slice(0, 200) })),
    });
    return audit(guild, route, entry);
  };
  for (const level of ['warn', 'error']) {
    const original = logger[level];
    logger[level] = (...args) => {
      activity.push({
        kind: level,
        title: args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 500),
      });
      return original(...args);
    };
  }
}

module.exports = { createActivityLog, instrument };

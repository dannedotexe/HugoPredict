'use strict';

const { publishAnnouncement } = require('../interactions/announcements');

/** Veröffentlicht fällige geplante Ankündigungen (Prüfung alle 30 Sekunden). */
function createScheduler({ store, logger, deps }) {
  let running = false;
  async function tick(client) {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      for (const guild of client.guilds.cache.values()) {
        const g = store.guild(guild.id);
        const due = (g.scheduled ?? []).filter((a) => a.at <= now);
        for (const a of due) {
          // Vor dem Senden entfernen, damit eine Ankündigung nie doppelt erscheint.
          g.scheduled = g.scheduled.filter((x) => x.id !== a.id);
          store.flush();
          try {
            await publishAnnouncement(guild, { ...a, scheduled: true }, deps);
          } catch (err) {
            logger.warn('Geplante Ankündigung fehlgeschlagen:', err.message);
            await deps.ctx.audit(guild, 'system', { title: 'Geplante Ankündigung fehlgeschlagen', description: `„${a.title}“: ${err.message}` });
          }
        }
      }
    } finally {
      running = false;
    }
  }
  return { tick };
}

module.exports = { createScheduler };

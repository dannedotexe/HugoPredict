'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Kleiner persistenter JSON-Store für Discord-Metadaten (IDs, Panels, Tickets,
 * Vorschläge). Er enthält bewusst KEINE Wirtschaftsdaten – Guthaben und
 * Transaktionen verwaltet ausschließlich die Website.
 *
 * Schreibvorgänge sind atomar (temporäre Datei + rename) und gebündelt.
 */
class Store {
  constructor(dir, { fileName = 'store.json', debounceMs = 250 } = {}) {
    this.dir = dir;
    this.file = path.join(dir, fileName);
    this.debounceMs = debounceMs;
    this.timer = null;
    this.data = { version: 1, guilds: {} };
    this.load();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.file)) return;
    const raw = fs.readFileSync(this.file, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.guilds) this.data = parsed;
    } catch (err) {
      // Beschädigte Datei nicht überschreiben, sondern sichern.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.copyFileSync(this.file, backup);
      throw new Error(`Store-Datei ist beschädigt und wurde nach ${backup} gesichert: ${err.message}`);
    }
  }

  guild(guildId) {
    const g = (this.data.guilds[guildId] ??= {});
    g.categories ??= {};
    g.channels ??= {};
    g.roles ??= {};
    g.panels ??= {};
    g.marketFeed ??= { messages: {}, summaries: {}, seen: {}, prices: {}, initialized: {} };
    g.leaderboards ??= {};
    g.tickets ??= {};
    g.ticketCounter ??= 0;
    g.suggestions ??= {};
    g.suggestionCounter ??= 0;
    g.moderation ??= { counter: 0, cases: [] };
    g.supportVoice ??= { open: true };
    return g;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };

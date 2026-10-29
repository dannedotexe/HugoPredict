'use strict';

const fs = require('node:fs');
const path = require('node:path');

/*
 * Custom-Emojis des Bots (assets/emojis/*.png, erzeugt mit scripts/build-emojis.js).
 * Sie werden beim Start als Application Emojis hochgeladen: Sie gehören dem Bot,
 * funktionieren auf jedem Server und belegen keine Emoji-Plätze des Servers.
 * Ist ein Emoji nicht verfügbar, wird es weggelassen – nie durch Standard-Emojis ersetzt.
 */

const ASSET_DIR = path.join(__dirname, '..', '..', 'assets', 'emojis');
const PREFIX = 'hp_';

class EmojiRegistry {
  constructor(dir = ASSET_DIR) {
    this.dir = dir;
    this.map = new Map();
  }

  files() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.png')).sort();
  }

  filePath(key) {
    return path.join(this.dir, `${key}.png`);
  }

  /** Lädt fehlende Emojis hoch und merkt sich alle IDs. */
  async sync(client, logger = console) {
    const manager = client.application?.emojis;
    if (!manager) return;
    let existing;
    try {
      existing = await manager.fetch();
    } catch (err) {
      logger.warn('Emojis konnten nicht geladen werden:', err.message);
      return;
    }
    let created = 0;
    for (const file of this.files()) {
      const key = file.slice(0, -4);
      const name = `${PREFIX}${key}`;
      let emoji = existing.find((e) => e.name === name);
      if (!emoji) {
        try {
          emoji = await manager.create({ attachment: this.filePath(key), name });
          created++;
        } catch (err) {
          logger.warn(`Emoji ${name} konnte nicht hochgeladen werden:`, err.message);
          continue;
        }
      }
      this.map.set(key, { id: emoji.id, name });
    }
    logger.info(`Emojis bereit: ${this.map.size} (${created} neu hochgeladen).`);
  }

  /** Emoji für Texte, mit Leerzeichen dahinter – oder leer. */
  icon(key) {
    const e = this.map.get(key);
    return e ? `<:${e.name}:${e.id}> ` : '';
  }

  /** Emoji für Buttons und Auswahlmenüs – oder undefined. */
  component(key) {
    const e = this.map.get(key);
    return e ? { id: e.id, name: e.name } : undefined;
  }
}

const emojis = new EmojiRegistry();

/** Setzt das Emoji eines Buttons/einer Option nur, wenn es verfügbar ist. */
function withEmoji(builder, key) {
  const e = emojis.component(key);
  return e ? builder.setEmoji(e) : builder;
}

module.exports = { emojis, withEmoji, EmojiRegistry, PREFIX };

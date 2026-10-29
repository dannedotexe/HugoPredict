'use strict';

const { CATEGORIES } = require('../config/serverLayout');

/*
 * Macht aus Channel-Namen im Text („#bewerben“, „#regeln“) anklickbare
 * Discord-Links (<#ID>). Erkannt werden die Namen aus dem Layout ohne Emoji,
 * z. B. „📝┃bewerben“ → #bewerben. Unbekannte Namen bleiben unverändert.
 */

const BY_NAME = new Map(
  CATEGORIES.flatMap((c) => c.channels)
    .map((ch) => [ch.name.split('┃').pop().toLowerCase(), ch.key])
    .filter(([name]) => /^[a-zäöüß0-9-]+$/.test(name)),
);

function linkChannelNames(text, channelId) {
  return String(text).replace(/(^|[^\w<&])#([a-zäöüß0-9-]+)/giu, (all, before, name) => {
    const key = BY_NAME.get(name.toLowerCase());
    const id = key && channelId(key);
    return id ? `${before}<#${id}>` : all;
  });
}

module.exports = { linkChannelNames };

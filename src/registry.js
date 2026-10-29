'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { InteractionContextType } = require('discord.js');

/** Lädt alle Commands aus src/commands (nur Server-Kontext, keine DMs). */
function loadCommands() {
  const dir = path.join(__dirname, 'commands');
  const commands = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const cmd = require(path.join(dir, file));
    if (!cmd?.data || typeof cmd.execute !== 'function') throw new Error(`Ungültiger Command: ${file}`);
    cmd.data.setContexts(InteractionContextType.Guild);
    if (commands.has(cmd.data.name)) throw new Error(`Doppelter Command-Name: ${cmd.data.name}`);
    commands.set(cmd.data.name, cmd);
  }
  return commands;
}

function loadInteractionHandlers() {
  const dir = path.join(__dirname, 'interactions');
  const handlers = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const h = require(path.join(dir, file));
    if (h?.prefix && typeof h.handle === 'function') handlers.set(h.prefix, h);
  }
  return handlers;
}

module.exports = { loadCommands, loadInteractionHandlers };

'use strict';

// Prüft alle JavaScript-Dateien mit `node --check` und lädt alle Commands.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(root);

for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
const { loadCommands, loadInteractionHandlers } = require('../src/registry');
const commands = loadCommands();
for (const c of commands.values()) c.data.toJSON();
console.log(`${files.length} Dateien geprüft, ${commands.size} Commands und ${loadInteractionHandlers().size} Interaktions-Handler geladen.`);

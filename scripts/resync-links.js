'use strict';

/*
 * Überträgt alle im Bot gespeicherten Minecraft-Verknüpfungen erneut an die
 * Website (z. B. nach einem Umzug der Datenbank). Doppelte Übertragung ist
 * harmlos: die Website legt nichts doppelt an.
 *   node scripts/resync-links.js
 */
const fs = require('node:fs');
const path = require('node:path');
const env = require('../src/config/env');
const { HugoApi, userMessage } = require('../src/lib/hugoApi');

async function main() {
  const file = path.join(env.dataDir, 'minecraft.json');
  const links = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).minecraft?.links ?? {} : {};
  const api = new HugoApi({ baseUrl: env.apiUrl, apiKey: env.apiKey, timeoutMs: env.apiTimeoutMs, logger: console });
  if (!api.configured) throw new Error('Bot ist nicht mit der Website verbunden (HUGO_API_URL/HUGO_API_KEY).');
  let ok = 0;
  let failed = 0;
  for (const [discordId, l] of Object.entries(links)) {
    try {
      await api.linkMinecraftAccount({ discordId, discordUsername: l.discordUsername, minecraftName: l.name, minecraftUuid: l.uuid });
      ok++;
    } catch (err) {
      failed++;
      console.log(`  ${l.name}: ${userMessage(err)}`);
    }
  }
  console.log(`Verknüpfungen übertragen: ${ok}${failed ? `, fehlgeschlagen: ${failed}` : ''}`);
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});

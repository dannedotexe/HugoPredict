'use strict';

const { REST, Routes } = require('discord.js');
const { env, assertDiscordEnv } = require('./config/env');
const { loadCommands } = require('./registry');

/**
 * Registriert die Slash-Commands. Mit DISCORD_GUILD_ID sofort für diesen
 * Server, sonst global (Discord verteilt globale Commands verzögert).
 */
async function main() {
  assertDiscordEnv();
  const body = [...loadCommands().values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(env.discordToken);
  const route = env.guildId ? Routes.applicationGuildCommands(env.clientId, env.guildId) : Routes.applicationCommands(env.clientId);
  const result = await rest.put(route, { body });
  console.log(`${result.length} Slash-Commands ${env.guildId ? `für Server ${env.guildId}` : 'global'} registriert.`);
}

main().catch((err) => {
  console.error('Registrierung fehlgeschlagen:', err.message);
  process.exitCode = 1;
});

'use strict';

const { ApplicationFlagsBitField, GatewayIntentBits, REST, Routes } = require('discord.js');

/**
 * Prüft vor dem Login, ob der privilegierte „Server Members Intent“ im
 * Developer Portal freigeschaltet ist. Ohne Freigabe würde Discord den Login
 * ablehnen – der Bot startet dann einfach ohne diesen Intent (Begrüßung und
 * Teile der Statistik entfallen), statt auszufallen.
 */
async function membersIntentAllowed(token, { get } = {}) {
  try {
    const fetchApp = get ?? ((route) => new REST().setToken(token).get(route));
    const app = await fetchApp(Routes.currentApplication());
    const flags = new ApplicationFlagsBitField(Number(app?.flags ?? 0));
    return flags.has(ApplicationFlagsBitField.Flags.GatewayGuildMembers)
      || flags.has(ApplicationFlagsBitField.Flags.GatewayGuildMembersLimited);
  } catch {
    return false;
  }
}

async function resolveIntents(token, opts) {
  const members = await membersIntentAllowed(token, opts);
  // GuildVoiceStates ist nicht privilegiert (Support-Warteraum).
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];
  if (members) intents.push(GatewayIntentBits.GuildMembers);
  return { intents, members };
}

module.exports = { membersIntentAllowed, resolveIntents };

'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { PRIVILEGES } = require('../config/serverLayout');
const { embeds, truncate } = require('./embeds');

/**
 * Hilfsfunktionen, die gespeicherte Keys (aus serverLayout.js) auf echte
 * Discord-Objekte abbilden, Berechtigungen prüfen und Audit-Logs schreiben.
 */
function createGuildContext({ store, logger }) {
  const roleId = (guildId, key) => store.guild(guildId).roles[key] ?? null;
  const channelId = (guildId, key) => store.guild(guildId).channels[key] ?? null;

  async function channel(guild, key) {
    const id = channelId(guild.id, key);
    if (!id) return null;
    return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
  }

  function hasRoleKey(member, key) {
    const id = roleId(member.guild.id, key);
    return Boolean(id && member.roles.cache.has(id));
  }

  /** Prüft ein Privileg aus PRIVILEGES. Server-Eigentümer und Administratoren dürfen immer. */
  function can(member, privilege) {
    if (!member?.guild) return false;
    if (member.guild.ownerId === member.id) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    return (PRIVILEGES[privilege] ?? []).some((key) => hasRoleKey(member, key));
  }

  /** Schreibt ein Log-Embed in einen Team-Channel. Fehler dabei werden nur geloggt. */
  async function audit(guild, key, { title, description, fields = [], color, files } = {}) {
    try {
      const ch = await channel(guild, key);
      if (!ch?.isTextBased()) return;
      const embed = embeds.info(title, description ? truncate(description, 4000) : null);
      if (color !== undefined) embed.setColor(color);
      if (fields.length) {
        embed.addFields(fields.slice(0, 25).map((f) => ({
          name: truncate(f.name, 256),
          value: truncate(f.value || '—', 1024),
          inline: f.inline ?? true,
        })));
      }
      await ch.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
    } catch (err) {
      logger.warn(`Audit-Log (${key}) fehlgeschlagen:`, err.message);
    }
  }

  return { roleId, channelId, channel, hasRoleKey, can, audit };
}

module.exports = { createGuildContext };

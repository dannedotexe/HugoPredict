'use strict';

/*
 * Rolle „| MC-Verifiziert“: Wer sich auf der Website mit seinem Minecraft-Konto
 * angemeldet hat (/msg HugoPredict CODE) und Discord verknüpft hat.
 * - Website-Anmeldung → der Minecraft-Bot meldet sie, der verknüpfte Discord bekommt die Rolle
 * - Discord-Verknüpfung, wenn es schon ein Website-Konto gibt → Rolle sofort
 * - /aktualisieren: alle Verknüpften mit Website-Konto nachtragen
 */

function createMcVerifiedService({ ctx, api, minecraft, logger }) {
  async function grant(guild, discordId) {
    const roleId = ctx.roleId(guild.id, 'mcVerified');
    if (!roleId) return false;
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member || member.user?.bot || member.roles.cache.has(roleId)) return false;
    try {
      await member.roles.add(roleId, 'HugoPredict: auf der Website mit Minecraft angemeldet');
      return true;
    } catch (err) {
      logger.warn('MC-Verifiziert:', err.message);
      return false;
    }
  }

  const linkedIds = (minecraftName) => Object.entries(minecraft?.links?.() ?? {})
    .filter(([, l]) => String(l.name ?? '').toLowerCase() === String(minecraftName).toLowerCase())
    .map(([id]) => id);

  /** Ein Website-Konto gibt es, wenn die Website den Discord-Nutzer kennt. */
  const hasWebsiteAccount = (discordId) => (api?.configured ? api.getBalance(discordId).then(() => true, () => false) : Promise.resolve(false));

  /** Website-Anmeldung per /msg bestätigt. */
  async function onWebsiteLogin(client, minecraftName) {
    let n = 0;
    for (const id of linkedIds(minecraftName)) for (const guild of client.guilds.cache.values()) if (await grant(guild, id)) n += 1;
    return n;
  }

  /** Nach der Discord-Verknüpfung: schon ein Website-Konto? */
  async function onDiscordLinked(client, discordId) {
    if (!(await hasWebsiteAccount(discordId))) return 0;
    let n = 0;
    for (const guild of client.guilds.cache.values()) if (await grant(guild, discordId)) n += 1;
    return n;
  }

  async function sweep(guild) {
    const roleId = ctx.roleId(guild.id, 'mcVerified');
    if (!roleId) return 0;
    let n = 0;
    for (const id of Object.keys(minecraft?.links?.() ?? {})) {
      const member = guild.members.cache.get(id);
      if (!member || member.roles.cache.has(roleId)) continue;
      if (await hasWebsiteAccount(id) && await grant(guild, id)) n += 1;
    }
    return n;
  }

  return { onWebsiteLogin, onDiscordLinked, sweep, grant };
}

module.exports = { createMcVerifiedService };

'use strict';

/*
 * Rolle „| Bots“ für andere Bots: neue Bots bekommen sie beim Beitritt,
 * bestehende bei /aktualisieren. Der eigene Bot bekommt sie nicht.
 */

function createBotRoleService({ ctx, logger }) {
  async function assign(member) {
    if (!member.user?.bot || member.id === member.client?.user?.id) return false;
    const roleId = ctx.roleId(member.guild.id, 'otherBots');
    if (!roleId || member.roles.cache.has(roleId)) return false;
    try {
      await member.roles.add(roleId, 'HugoPredict: Rolle für Bots');
      return true;
    } catch (err) {
      logger.warn(`Bot-Rolle für ${member.user.username}:`, err.message);
      return false;
    }
  }

  /** Allen Bots auf dem Server die Rolle geben. Braucht den „Server Members Intent“. */
  async function sweep(guild) {
    const members = await guild.members.fetch();
    let added = 0;
    for (const member of members.values()) if (await assign(member)) added += 1;
    return added;
  }

  return { assign, sweep };
}

module.exports = { createBotRoleService };

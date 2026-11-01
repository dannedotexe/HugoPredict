'use strict';

const { allMembers } = require('../lib/members');

/*
 * Rolle „| Mitglied“ (+ standardmäßig alle Pings) direkt beim Beitritt.
 * „| DC-Verifiziert“ gibt es weiterhin nur über die Kontoverknüpfung.
 * Bestehende Mitglieder ohne die Rolle bekommen sie bei /aktualisieren.
 */

const DEFAULT_PINGS = ['notifyMarkets', 'notifyNews'];

function createMemberRoleService({ ctx, logger }) {
  async function give(member) {
    if (member.user?.bot) return false;
    const memberRole = ctx.roleId(member.guild.id, 'member');
    if (!memberRole || member.roles.cache.has(memberRole)) return false;
    // Wer die Mitglied-Rolle neu bekommt, bekommt auch die Pings (abwählbar in #pings)
    const ids = [memberRole, ...DEFAULT_PINGS.map((k) => ctx.roleId(member.guild.id, k))].filter((id) => id && !member.roles.cache.has(id));
    try {
      await member.roles.add(ids, 'HugoPredict: Mitglied beim Beitritt');
      return true;
    } catch (err) {
      logger.warn(`Mitglied-Rolle für ${member.user?.username}:`, err.message);
      return false;
    }
  }

  async function sweep(guild) {
    const members = await allMembers(guild);
    let added = 0;
    for (const m of members.values()) if (await give(m)) added += 1;
    return added;
  }

  return { onMemberAdd: give, sweep };
}

module.exports = { createMemberRoleService, DEFAULT_PINGS };

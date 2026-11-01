'use strict';

const { allMembers } = require('../lib/members');

/*
 * Rolle „| OG“: Wer bis Ende 2026 (deutsche Zeit) beitritt, bekommt sie –
 * neue Mitglieder beim Beitritt, bestehende bei /aktualisieren. Keine Bots.
 */

const OG_CUTOFF = new Date('2027-01-01T00:00:00+01:00');

function createOgRoleService({ ctx, logger, cutoff = OG_CUTOFF, now = () => new Date() }) {
  const eligible = (member, joined) => !member.user?.bot && joined instanceof Date && joined < cutoff;

  async function give(member) {
    const roleId = ctx.roleId(member.guild.id, 'og');
    if (!roleId || member.roles.cache.has(roleId)) return false;
    try {
      await member.roles.add(roleId, 'HugoPredict: OG – beigetreten bis Ende 2026');
      return true;
    } catch (err) {
      logger.warn(`OG-Rolle für ${member.user?.username}:`, err.message);
      return false;
    }
  }

  /** Beim Beitritt: nur solange die Frist läuft. */
  async function onMemberAdd(member) {
    if (!eligible(member, now())) return false;
    return give(member);
  }

  /** Alle, die vor Fristende beigetreten sind und die Rolle noch nicht haben. */
  async function sweep(guild) {
    const members = await allMembers(guild);
    let added = 0;
    for (const member of members.values()) if (eligible(member, member.joinedAt) && await give(member)) added += 1;
    return added;
  }

  return { onMemberAdd, sweep };
}

module.exports = { createOgRoleService, OG_CUTOFF };

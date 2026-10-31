'use strict';

/*
 * Teamrollen im Server-Namen: „Supporter | Steve“. Maßgeblich ist die höchste
 * Teamrolle; ohne Teamrolle entfernt der Bot den Zusatz wieder. Der Name
 * dahinter bleibt erhalten (z. B. der Minecraft-Name aus der Verknüpfung).
 * Den Server-Eigentümer und Personen über der Bot-Rolle kann der Bot nicht
 * umbenennen – das wird still übersprungen.
 */

// Reihenfolge = Rang (die erste passende Rolle gewinnt)
const PREFIXES = [
  ['owner', 'Inhaber'],
  ['admin', 'Admin'],
  ['developer', 'Dev'],
  ['marketMod', 'Prognosen'],
  ['moderator', 'Mod'],
  ['support', 'Supporter'],
];
const SEPARATOR = ' | ';
const MAX_NICK = 32;
const PREFIX_PATTERN = new RegExp(`^(?:${PREFIXES.map(([, p]) => p).join('|')})\\s*\\|\\s*`);

/** Name ohne Team-Zusatz. */
const baseName = (member) => {
  const current = member.nickname ?? member.user?.globalName ?? member.user?.username ?? '';
  return current.replace(PREFIX_PATTERN, '').trim() || member.user?.username || '';
};

function desiredNickname(member, ctx, base = baseName(member)) {
  const prefix = PREFIXES.find(([key]) => ctx.hasRoleKey(member, key))?.[1];
  if (!prefix) return base.slice(0, MAX_NICK);
  return `${prefix}${SEPARATOR}${base.slice(0, MAX_NICK - prefix.length - SEPARATOR.length)}`;
}

function createStaffNamesService({ ctx, logger }) {
  /** Setzt den Namen passend zur Teamrolle. Gibt true zurück, wenn er geändert wurde. */
  async function apply(member, { base } = {}) {
    if (!member?.guild || member.user?.bot || member.id === member.guild.ownerId) return false;
    const wanted = desiredNickname(member, ctx, base ?? baseName(member));
    const shown = member.nickname ?? member.user?.globalName ?? member.user?.username;
    if (!wanted || wanted === shown) return false;
    if (member.manageable === false) return false;
    try {
      await member.setNickname(wanted, 'HugoPredict: Teamrolle im Namen');
      return true;
    } catch (err) {
      logger.warn(`Name für ${member.user?.username}:`, err.message);
      return false;
    }
  }

  async function onMemberUpdate(oldMember, newMember) {
    const before = [...(oldMember.roles?.cache?.keys() ?? [])].sort().join();
    const after = [...newMember.roles.cache.keys()].sort().join();
    if (before === after) return;
    // Verifizierung entzogen: Minecraft-Name fällt weg, zurück zum Discord-Namen.
    const lostVerified = oldMember.roles?.cache && ctx.hasRoleKey(oldMember, 'verified') && !ctx.hasRoleKey(newMember, 'verified');
    if (lostVerified) {
      await resetToDiscordName(newMember);
      return;
    }
    await apply(newMember);
  }

  /** Server-Namen zurücksetzen (Discord-Name), bei Teamrolle mit Zusatz. */
  async function resetToDiscordName(member) {
    if (!member?.guild || member.user?.bot || member.id === member.guild.ownerId || member.manageable === false) return false;
    const discordName = member.user?.globalName ?? member.user?.username ?? '';
    const prefix = PREFIXES.find(([key]) => ctx.hasRoleKey(member, key))?.[1];
    const wanted = prefix ? desiredNickname(member, ctx, discordName) : null; // null = Server-Name entfernen
    if ((member.nickname ?? null) === wanted) return false;
    try {
      await member.setNickname(wanted, 'HugoPredict: Verifizierung entfernt');
      return true;
    } catch (err) {
      logger.warn(`Name für ${member.user?.username}:`, err.message);
      return false;
    }
  }

  /** Alle Mitglieder abgleichen (z. B. bei /aktualisieren). Braucht den „Server Members Intent“. */
  async function sweep(guild) {
    const members = await guild.members.fetch();
    let changed = 0;
    for (const member of members.values()) if (await apply(member)) changed += 1;
    return changed;
  }

  return { apply, onMemberUpdate, sweep };
}

module.exports = { createStaffNamesService, desiredNickname, baseName, PREFIXES };

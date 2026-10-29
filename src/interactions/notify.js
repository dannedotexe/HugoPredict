'use strict';

const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');
const { ROLES } = require('../config/serverLayout');

/** Buttons in #regeln: Benachrichtigungs-Rollen an- bzw. abmelden. */
async function handle(interaction, deps, [key]) {
  if (!interaction.isButton() || !interaction.inGuild()) return;
  const def = ROLES.find((r) => r.key === key && r.notify);
  if (!def) return;
  if (!deps.checkRate(interaction, 'default')) return;
  const roleId = deps.ctx.roleId(interaction.guild.id, key);
  if (!roleId) return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Diese Benachrichtigung ist noch nicht eingerichtet.')] });
  const has = interaction.member.roles.cache.has(roleId);
  try {
    if (has) await interaction.member.roles.remove(roleId, 'Benachrichtigung abgemeldet');
    else await interaction.member.roles.add(roleId, 'Benachrichtigung angemeldet');
  } catch (err) {
    deps.logger.warn(`Benachrichtigungs-Rolle ${def.name}:`, err.message);
    return replyPrivate(interaction, { embeds: [embeds.error('Nicht möglich', 'Die Einstellung konnte nicht gespeichert werden. Bitte versuche es später erneut.')] });
  }
  return replyPrivate(interaction, {
    embeds: [has
      ? embeds.info(`${def.name}: abgemeldet`, 'Du erhältst hierzu keine Benachrichtigungen mehr.')
      : embeds.success(`${def.name}: angemeldet`, 'Du wirst ab jetzt benachrichtigt. Ein weiterer Klick meldet dich wieder ab.')],
  });
}

module.exports = { prefix: 'notify', handle };

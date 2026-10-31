'use strict';

// Verweis auf #verifizieren (anklickbar, wenn der Channel eingerichtet ist)
const verifyRef = (interaction, deps) => {
  const id = deps.ctx.channelId?.(interaction.guild.id, 'verify');
  return id ? `<#${id}>` : '#verifizieren';
};

const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');

/** "Regeln akzeptieren" vergibt ausschließlich die Member-Rolle. */
async function handle(interaction, deps, [action]) {
  if (action !== 'accept' || !interaction.isButton() || !interaction.inGuild()) return;
  if (!deps.checkRate(interaction, 'default')) return;
  const roleId = deps.ctx.roleId(interaction.guild.id, 'member');
  if (!roleId) return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Die Rolle „Mitglied“ ist noch nicht eingerichtet. Bitte wende dich an den Kundenservice.')] });
  if (interaction.member.roles.cache.has(roleId)) {
    return replyPrivate(interaction, { embeds: [embeds.info('Bereits akzeptiert', 'Du hast die Regeln bereits akzeptiert.')] });
  }
  try {
    await interaction.member.roles.add(roleId, 'Regeln akzeptiert');
  } catch (err) {
    deps.logger.warn('Rolle Mitglied:', err.message);
    await deps.ctx.audit(interaction.guild, 'system', { title: 'Rolle nicht vergeben', description: `Mitglied für <@${interaction.user.id}>: ${err.message}` });
    return replyPrivate(interaction, { embeds: [embeds.error('Rolle nicht vergeben', 'Die Rolle konnte nicht vergeben werden. Das Team wurde informiert.')] });
  }
  return replyPrivate(interaction, {
    embeds: [embeds.success('Regeln akzeptiert', `Du hast jetzt Zugang zur Community. Verknüpfe als Nächstes dein Konto in ${verifyRef(interaction, deps)} oder mit \`/verify\`, um Kontoabfragen zu nutzen.`)],
  });
}

module.exports = { prefix: 'rules', handle };

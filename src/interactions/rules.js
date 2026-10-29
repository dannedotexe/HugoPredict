'use strict';

const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');

/** "Regeln akzeptieren" vergibt ausschließlich die Member-Rolle. */
async function handle(interaction, deps, [action]) {
  if (action !== 'accept' || !interaction.isButton() || !interaction.inGuild()) return;
  if (!deps.checkRate(interaction, 'default')) return;
  const roleId = deps.ctx.roleId(interaction.guild.id, 'member');
  if (!roleId) return replyPrivate(interaction, { embeds: [embeds.error('Nicht eingerichtet', 'Die Member-Rolle existiert noch nicht. Bitte informiere das Team.')] });
  if (interaction.member.roles.cache.has(roleId)) {
    return replyPrivate(interaction, { embeds: [embeds.info('Bereits akzeptiert', 'Du hast die Regeln bereits akzeptiert.')] });
  }
  try {
    await interaction.member.roles.add(roleId, 'Regeln akzeptiert');
  } catch (err) {
    deps.logger.warn('Member-Rolle:', err.message);
    return replyPrivate(interaction, { embeds: [embeds.error('Fehler', 'Die Rolle konnte nicht vergeben werden. Bitte informiere das Team.')] });
  }
  const verifyId = deps.ctx.channelId(interaction.guild.id, 'verification');
  return replyPrivate(interaction, {
    embeds: [embeds.success('Willkommen an Bord', `Du hast jetzt Zugriff auf die Community.${verifyId ? ` Verknüpfe als Nächstes deinen Minecraft-Account in <#${verifyId}>, um Trading-Funktionen freizuschalten.` : ''}`)],
  });
}

module.exports = { prefix: 'rules', handle };

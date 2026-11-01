'use strict';

/*
 * /blacklist – sperrt eine Person auf einen Schlag überall:
 * Discord-Bann + Sperre des verknüpften Website-Kontos, beides mit Paragraf.
 * /blacklist entfernen hebt beides wieder auf. Nur Inhaber und Administrator.
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const mod = require('../lib/moderation');
const { paragraphChoices, paragraph } = require('../config/docs');

const SNOWFLAKE = /^\d{15,25}$/;

const data = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Person überall sperren: Discord-Bann und Website-Konto')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addSubcommand((s) => s.setName('hinzufügen').setDescription('Discord bannen und Website-Konto sperren')
    .addUserOption((o) => o.setName('nutzer').setDescription('Betroffene Person').setRequired(true))
    .addStringOption((o) => o.setName('paragraf').setDescription('Gegen welche Regel verstoßen wurde (sieht die Person)').setRequired(true).addChoices(...paragraphChoices()))
    .addStringOption((o) => o.setName('grund').setDescription('Begründung (wird protokolliert und der Person mitgeteilt)').setRequired(true).setMinLength(3).setMaxLength(500))
    .addIntegerOption((o) => o.setName('nachrichten_loeschen').setDescription('Nachrichten der Person löschen').addChoices(...mod.BAN_DELETE)))
  .addSubcommand((s) => s.setName('entfernen').setDescription('Discord-Bann und Website-Sperre aufheben')
    .addStringOption((o) => o.setName('nutzer_id').setDescription('Discord-ID der Person').setRequired(true).setMinLength(15).setMaxLength(25))
    .addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(500)));

/** Ergebnis der Website-Sperre als Text */
function websiteLine(res, adding) {
  if (res.error) return `⚠️ Fehlgeschlagen: ${res.error}`;
  if (!res.linked) return 'Kein Website-Konto verknüpft';
  return `${adding ? 'Gesperrt' : 'Entsperrt'}: **${res.mcName}**`;
}

module.exports = {
  data,
  privilege: 'ban',
  rateLimit: 'moderate',
  async execute(interaction, deps) {
    const sub = interaction.options.getSubcommand();
    const adding = sub === 'hinzufügen';
    const { guild, member: actor } = interaction;
    const me = guild.members.me;
    const reason = interaction.options.getString('grund', true).trim();

    let user;
    if (adding) {
      user = interaction.options.getUser('nutzer', true);
    } else {
      const id = interaction.options.getString('nutzer_id', true).trim();
      if (!SNOWFLAKE.test(id)) return replyPrivate(interaction, { embeds: [embeds.error('Ungültige ID', 'Bitte gib eine gültige Discord-ID an.')] });
      user = await interaction.client.users.fetch(id).catch(() => null);
      if (!user) return replyPrivate(interaction, { embeds: [embeds.error('Nicht gefunden', 'Zu dieser ID existiert kein Discord-Konto.')] });
    }

    const action = adding ? 'ban' : 'unban';
    const target = adding ? await guild.members.fetch(user.id).catch(() => null) : null;
    const problem = mod.checkTarget(action, { actor, target, me, guild });
    if (problem) return replyPrivate(interaction, { embeds: [embeds.error('Aktion nicht möglich', problem)] });

    await interaction.deferReply({ flags: EPHEMERAL });
    const rule = adding ? interaction.options.getString('paragraf', true) : null;
    const draft = { action, targetId: user.id, moderatorId: actor.id, reason: `[Blacklist] ${reason}`, paragraph: rule };
    const auditReason = `Blacklist${rule ? ` · §${rule}` : ''} · ${reason} – durch ${actor.user.username}`.slice(0, 512);

    // 1) Website zuerst: klappt der Discord-Bann danach nicht, ist die Person trotzdem gesperrt.
    const site = deps.api?.configured
      ? await deps.api.setWebsiteBan(user.id, { banned: adding, rule }).catch((err) => ({ error: err.message }))
      : { error: 'Website-API nicht eingerichtet' };

    // 2) Discord: vor dem Bann per DM informieren (danach nicht mehr möglich)
    let dm = null;
    let discord;
    try {
      if (adding) {
        dm = await user.send({ embeds: [mod.noticeEmbed({ ...draft, reason }, guild.name)
          .addFields({ name: 'Website', value: 'Dein HugoPredict-Konto auf der Website ist ebenfalls gesperrt.', inline: false })] })
          .then(() => true).catch(() => false);
        await guild.members.ban(user.id, { reason: auditReason, deleteMessageSeconds: interaction.options.getInteger('nachrichten_loeschen') ?? 0 });
        discord = 'Gebannt';
      } else {
        const ban = await guild.bans.fetch(user.id).catch(() => null);
        if (ban) await guild.members.unban(user.id, auditReason);
        discord = ban ? 'Entbannt' : 'War nicht gebannt';
      }
    } catch (err) {
      deps.logger.warn(`/blacklist ${sub} (Discord):`, err.message);
      discord = `⚠️ Fehlgeschlagen: ${err.message}`;
    }

    const entry = mod.recordCase(deps.store, guild.id, { ...draft, dm });
    const fields = [
      ...mod.caseEmbed(entry).data.fields,
      { name: 'Discord', value: discord, inline: true },
      { name: 'Website', value: websiteLine(site, adding), inline: true },
    ];
    const log = { title: `Fall #${entry.number} · Blacklist ${adding ? '' : 'aufgehoben'}`.trim(), fields, color: mod.ACTIONS[action].color };
    await deps.ctx.audit(guild, 'moderation', log);
    await deps.ctx.audit(guild, 'audit', log);

    const failed = discord.startsWith('⚠️') || site.error;
    const label = rule ? paragraph(rule)?.label : null;
    const e = embeds[failed ? 'warning' : 'success'](
      adding ? `Fall #${entry.number} · Blacklist` : `Fall #${entry.number} · Blacklist aufgehoben`,
      `<@${user.id}>${label ? ` · Verstoß gegen ${label}` : ''}`,
    ).addFields(
      { name: 'Discord', value: discord, inline: true },
      { name: 'Website', value: websiteLine(site, adding), inline: true },
    );
    if (dm === false) e.addFields({ name: 'Hinweis', value: 'Die Person konnte nicht per Direktnachricht informiert werden.', inline: false });
    return replyPrivate(interaction, { embeds: [e] });
  },
};

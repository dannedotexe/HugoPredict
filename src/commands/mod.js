'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate, EPHEMERAL } = require('../lib/respond');
const mod = require('../lib/moderation');

const SNOWFLAKE = /^\d{15,25}$/;
const reasonOption = (o) => o.setName('grund').setDescription('Begründung (wird protokolliert und der Person mitgeteilt)').setRequired(true).setMinLength(3).setMaxLength(500);
const userOption = (o) => o.setName('nutzer').setDescription('Betroffene Person').setRequired(true);

const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Moderationswerkzeuge')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((s) => s.setName('verwarnen').setDescription('Verwarnung aussprechen').addUserOption(userOption).addStringOption(reasonOption))
  .addSubcommand((s) => s.setName('timeout').setDescription('Person vorübergehend stummschalten').addUserOption(userOption)
    .addIntegerOption((o) => o.setName('dauer').setDescription('Dauer').setRequired(true).addChoices(...mod.TIMEOUTS))
    .addStringOption(reasonOption))
  .addSubcommand((s) => s.setName('timeout-aufheben').setDescription('Timeout vorzeitig beenden').addUserOption(userOption).addStringOption(reasonOption))
  .addSubcommand((s) => s.setName('kicken').setDescription('Person vom Server entfernen').addUserOption(userOption).addStringOption(reasonOption))
  .addSubcommand((s) => s.setName('bannen').setDescription('Person dauerhaft ausschließen (nur Inhaber und Administrator)').addUserOption(userOption).addStringOption(reasonOption)
    .addIntegerOption((o) => o.setName('nachrichten_loeschen').setDescription('Nachrichten der Person löschen').addChoices(...mod.BAN_DELETE)))
  .addSubcommand((s) => s.setName('entbannen').setDescription('Bann aufheben (nur Inhaber und Administrator)')
    .addStringOption((o) => o.setName('nutzer_id').setDescription('Discord-ID der Person').setRequired(true).setMinLength(15).setMaxLength(25))
    .addStringOption(reasonOption))
  .addSubcommand((s) => s.setName('verlauf').setDescription('Moderationsverlauf einer Person anzeigen').addUserOption(userOption));

const ACTION_BY_SUB = {
  verwarnen: 'warn', timeout: 'timeout', 'timeout-aufheben': 'untimeout', kicken: 'kick', bannen: 'ban', entbannen: 'unban',
};

module.exports = {
  data,
  privilege: 'moderate',
  rateLimit: 'moderate',
  async execute(interaction, deps) {
    const sub = interaction.options.getSubcommand();
    const { guild, member: actor } = interaction;
    const me = guild.members.me;

    if (sub === 'verlauf') {
      const user = interaction.options.getUser('nutzer', true);
      return replyPrivate(interaction, { embeds: [mod.historyEmbed(user, mod.casesFor(deps.store, guild.id, user.id))] });
    }

    const action = ACTION_BY_SUB[sub];
    if (['ban', 'unban'].includes(action) && !deps.ctx.can(actor, 'ban')) return deps.deny(interaction, `/mod ${sub}`);
    const reason = interaction.options.getString('grund', true).trim();

    let user;
    if (action === 'unban') {
      const id = interaction.options.getString('nutzer_id', true).trim();
      if (!SNOWFLAKE.test(id)) return replyPrivate(interaction, { embeds: [embeds.error('Ungültige ID', 'Bitte gib eine gültige Discord-ID an.')] });
      user = await interaction.client.users.fetch(id).catch(() => null);
      if (!user) return replyPrivate(interaction, { embeds: [embeds.error('Nicht gefunden', 'Zu dieser ID existiert kein Discord-Konto.')] });
    } else {
      user = interaction.options.getUser('nutzer', true);
    }
    const target = action === 'unban' ? null : await guild.members.fetch(user.id).catch(() => null);

    const problem = mod.checkTarget(action, { actor, target, me, guild });
    if (problem) return replyPrivate(interaction, { embeds: [embeds.error('Aktion nicht möglich', problem)] });
    if (action === 'untimeout' && !target.isCommunicationDisabled()) {
      return replyPrivate(interaction, { embeds: [embeds.info('Kein Timeout aktiv', 'Für diese Person läuft derzeit kein Timeout.')] });
    }

    await interaction.deferReply({ flags: EPHEMERAL });
    const durationMs = action === 'timeout' ? interaction.options.getInteger('dauer', true) : null;
    const draft = { action, targetId: user.id, moderatorId: actor.id, reason, durationMs, number: '…' };
    const auditReason = `${reason} – durch ${actor.user.username}`.slice(0, 512);

    // Vor Kick/Bann benachrichtigen – danach ist keine Direktnachricht mehr möglich.
    let dm = null;
    const notify = async () => {
      dm = await user.send({ embeds: [mod.noticeEmbed(draft, guild.name)] }).then(() => true).catch(() => false);
    };

    try {
      if (['kick', 'ban'].includes(action)) await notify();
      if (action === 'timeout') await target.timeout(durationMs, auditReason);
      if (action === 'untimeout') await target.timeout(null, auditReason);
      if (action === 'kick') await target.kick(auditReason);
      if (action === 'ban') {
        await guild.members.ban(user.id, { reason: auditReason, deleteMessageSeconds: interaction.options.getInteger('nachrichten_loeschen') ?? 0 });
      }
      if (action === 'unban') {
        const ban = await guild.bans.fetch(user.id).catch(() => null);
        if (!ban) return replyPrivate(interaction, { embeds: [embeds.info('Kein Bann', 'Diese Person ist nicht gebannt.')] });
        await guild.members.unban(user.id, auditReason);
      }
      if (['warn', 'timeout'].includes(action)) await notify();
    } catch (err) {
      deps.logger.warn(`/mod ${sub} fehlgeschlagen:`, err.message);
      return replyPrivate(interaction, { embeds: [embeds.error('Aktion fehlgeschlagen', `Discord hat die Aktion abgelehnt: ${err.message}`)] });
    }

    const { number: _draftNumber, ...caseData } = draft;
    const entry = mod.recordCase(deps.store, guild.id, { ...caseData, dm });
    const log = { title: `Fall #${entry.number} · ${mod.ACTIONS[action].label}`, fields: mod.caseEmbed(entry).data.fields, color: mod.ACTIONS[action].color };
    await deps.ctx.audit(guild, 'moderation', log);
    if (['kick', 'ban', 'unban'].includes(action)) await deps.ctx.audit(guild, 'audit', log);

    const e = embeds.success(`Fall #${entry.number} angelegt`, `<@${user.id}> wurde ${mod.ACTIONS[action].past}.`);
    if (dm === false) e.addFields({ name: 'Hinweis', value: 'Die Person konnte nicht per Direktnachricht informiert werden.', inline: false });
    return replyPrivate(interaction, { embeds: [e] });
  },
};

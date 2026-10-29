'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embeds, formatAmount, discordTime } = require('../lib/embeds');
const { replyPrivate, replyApiError, EPHEMERAL } = require('../lib/respond');
const { card } = require('../lib/ui');

/** Ein Idempotenz-Schlüssel pro Nutzer und UTC-Tag: Wiederholungen lösen keine zweite Gutschrift aus. */
function dailyKey(userId, date = new Date()) {
  return `discord-daily:${userId}:${date.toISOString().slice(0, 10)}`;
}

module.exports = {
  data: new SlashCommandBuilder().setName('daily').setDescription('Holt deinen täglichen Bonus ab'),
  rateLimit: 'daily',
  dailyKey,
  async execute(interaction, deps) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const { locked, value } = await deps.locks.run(`daily:${interaction.user.id}`, async () => {
      try {
        return { ok: true, res: await deps.api.claimDaily(interaction.user.id, dailyKey(interaction.user.id)) };
      } catch (err) {
        return { ok: false, err };
      }
    });
    if (locked) return replyPrivate(interaction, { embeds: [embeds.warning('Bitte warten', 'Deine Anfrage wird bereits verarbeitet.')] });
    if (!value.ok) return replyApiError(interaction, value.err, { ...deps, action: '/daily' });

    const res = value.res;
    if (!res.claimed) {
      return replyPrivate(interaction, {
        embeds: [embeds.info('Bereits abgeholt', res.nextClaimAt ? `Dein nächster Bonus ist ${discordTime(res.nextClaimAt, 'R')} verfügbar.` : 'Du hast deinen Bonus heute bereits abgeholt.')],
      });
    }

    if (interaction.guild) {
      await deps.ctx.audit(interaction.guild, 'audit', {
        title: 'Daily-Bonus (von der Website bestätigt)',
        fields: [
          { name: 'Nutzer', value: `<@${interaction.user.id}> (${interaction.user.id})` },
          { name: 'Betrag', value: formatAmount(res.amount, deps.env.currency) },
          { name: 'Transaktion', value: res.transactionId ?? '—' },
        ],
      });
    }
    const c = deps.env.currency;
    return replyPrivate(interaction, card({
      icon: 'coin',
      title: 'Bonus gutgeschrieben',
      intro: `# +${formatAmount(res.amount, c)}\n-# Von der Website bestätigt`,
      logo: false,
      blocks: [(res.balance !== null || res.nextClaimAt) && {
        heading: 'Details',
        body: [res.balance !== null ? `Neues Guthaben **${formatAmount(res.balance, c)}**` : null, res.nextClaimAt ? `Nächster Bonus ${discordTime(res.nextClaimAt, 'R')}` : null].filter(Boolean).join('\n'),
      }],
      footer: 'Nur für dich sichtbar',
      ephemeral: true,
    }));
  },
};

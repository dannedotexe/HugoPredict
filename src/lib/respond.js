'use strict';

const { MessageFlags } = require('discord.js');
const { embeds } = require('./embeds');
const { ApiError, userMessage } = require('./hugoApi');

const EPHEMERAL = MessageFlags.Ephemeral;

/** Antwortet unabhängig davon, ob schon geantwortet/deferred wurde. */
async function reply(interaction, payload) {
  const data = { allowedMentions: { parse: [] }, ...payload };
  if (interaction.deferred || interaction.replied) {
    const { flags, ...rest } = data;
    if (interaction.deferred && !interaction.replied) {
      // Sichtbarkeit steht seit dem Defer fest; das Karten-Flag (Components V2) muss erhalten bleiben.
      const v2 = (flags ?? 0) & MessageFlags.IsComponentsV2;
      return interaction.editReply(v2 ? { ...rest, flags: v2 } : rest);
    }
    return interaction.followUp({ ...rest, flags });
  }
  return interaction.reply(data);
}

/** Private Antwort; Flags der Nutzlast (z. B. Karten) werden ergänzt, nicht ersetzt. */
const replyPrivate = (interaction, payload) => reply(interaction, { ...payload, flags: EPHEMERAL | (payload.flags ?? 0) });

function apiErrorEmbed(err) {
  const title = err instanceof ApiError && err.code === 'not_linked' ? 'Konto nicht verknüpft' : 'Aktion nicht möglich';
  return embeds.error(title, userMessage(err));
}

/** Meldet API-Fehler privat und protokolliert unerwartete Fehler. */
async function replyApiError(interaction, err, { logger, ctx, action } = {}) {
  const expected = err instanceof ApiError && ['not_linked', 'not_found', 'conflict', 'bad_request', 'rate_limited', 'not_configured'].includes(err.code);
  if (!expected) {
    logger?.warn(`${action ?? 'API'} fehlgeschlagen:`, err.message);
    if (interaction.guild && ctx) {
      await ctx.audit(interaction.guild, 'system', {
        title: 'API-Fehler',
        description: `${action ?? 'Aktion'} von <@${interaction.user.id}>: \`${String(err.message).slice(0, 500)}\``,
      });
    }
  }
  return replyPrivate(interaction, { embeds: [apiErrorEmbed(err)] });
}

module.exports = { reply, replyPrivate, replyApiError, apiErrorEmbed, EPHEMERAL };

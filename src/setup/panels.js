'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { TICKET_TYPES, ROLES } = require('../config/serverLayout');
const { LEGACY_PANELS } = require('../config/legacyLayout');
const { sections } = require('../config/docs');
const { truncate } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const { card, upsert } = require('../lib/ui');
const theme = require('../config/theme');

/** Abschnitt „Rollen“: Rollen-Erwähnung (pingt nicht) plus Beschreibung. */
function rolesSection(roleIds = {}) {
  return ROLES.map((r) => `${emojis.icon(r.icon)}${roleIds[r.key] ? `<@&${roleIds[r.key]}>` : `**${r.name}**`}\n${r.description}`).join('\n');
}

function panelDefinitions() {
  return [
    {
      key: 'docs',
      channelKey: 'docs',
      build: ({ env, roleIds, channelIds = {} }) => {
        // Channel-Namen im Text werden zu anklickbaren Verweisen, sofern eingerichtet.
        const link = (text) => text
          .replace(/#ankündigungen/g, channelIds.announcements ? `<#${channelIds.announcements}>` : '#ankündigungen')
          .replace(/#support/g, channelIds.support ? `<#${channelIds.support}>` : '#support');
        const blocks = [
          ...sections({ currency: env.currency, websiteUrl: env.websiteUrl }).map((s) => ({ heading: s.title, icon: s.icon, body: link(s.body) })),
          { heading: 'Rollen', icon: 'roles', body: rolesSection(roleIds) },
        ];
        const buttons = [
          withEmoji(new ButtonBuilder().setCustomId('hm:rules:accept').setStyle(ButtonStyle.Success).setLabel('Regeln akzeptieren'), 'check'),
          withEmoji(new ButtonBuilder().setCustomId('hm:verify:start').setStyle(ButtonStyle.Secondary).setLabel('Konto verknüpfen'), 'link'),
        ];
        if (env.websiteUrl) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Website').setURL(env.websiteUrl), 'external'));
        return card({
          size: 'lg',
          icon: 'logo',
          title: 'Regeln & Infos',
          intro: `Alles Wichtige zu **${theme.brand}** auf einen Blick.\nBitte lies die Regeln, bevor du der Community beitrittst.`,
          blocks,
          footer: 'Mit „Regeln akzeptieren“ erhältst du Zugang zur Community',
          actions: [new ActionRowBuilder().addComponents(buttons)],
        });
      },
    },
    {
      key: 'tickets',
      channelKey: 'support',
      build: () => card({
        size: 'lg',
        icon: 'support',
        title: 'Kundenservice',
        intro: 'Du hast eine Frage oder ein Problem? Wähle unten dein Anliegen.\nEs wird ein privater Channel erstellt, den nur du und das zuständige Team sehen.',
        blocks: [
          { heading: 'Anliegen', icon: 'info', body: TICKET_TYPES.map((t) => `${emojis.icon(t.key)}**${t.label}**\n${t.description}`).join('\n') },
          { heading: 'Sicherheit', icon: 'lock', body: 'Das Team fragt niemals nach Passwörtern.\nKorrekturen von Guthaben erfolgen ausschließlich über die Website.' },
        ],
        footer: 'Antworten erhältst du direkt in deinem Anfrage-Channel',
        actions: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('hm:ticket:select')
            .setPlaceholder('Anliegen auswählen …')
            .addOptions(TICKET_TYPES.map((t) => withEmoji(
              new StringSelectMenuOptionBuilder().setLabel(t.label).setValue(t.key).setDescription(truncate(t.description, 100)),
              t.key,
            ))),
        )],
      }),
    },
  ];
}

/**
 * Veröffentlicht alle Panels. Vorhandene Panel-Nachrichten werden bearbeitet
 * statt neu gepostet; Panels der früheren Struktur werden weiterverwendet,
 * wenn sie im selben Channel liegen.
 */
async function publishPanels(guild, { store, env, statusService, statsService }) {
  const g = store.guild(guild.id);
  const result = { created: [], updated: [], errors: [] };

  const publish = async (key, channelId, payload) => {
    const channel = channelId && (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)));
    if (!channel?.isTextBased()) {
      result.errors.push(`${key}: Channel fehlt – die Serverstruktur ist nicht vollständig eingerichtet.`);
      return;
    }
    const ref = [g.panels[key], g.panels[LEGACY_PANELS[key]]].find((p) => p?.channelId === channel.id);
    const msg = await upsert(channel, ref, payload);
    (ref && msg.id === ref.messageId ? result.updated : result.created).push(key);
    g.panels[key] = { channelId: channel.id, messageId: msg.id };
    if (LEGACY_PANELS[key]) delete g.panels[LEGACY_PANELS[key]];
  };

  for (const def of panelDefinitions()) {
    try {
      await publish(def.key, g.channels[def.channelKey], def.build({ guild, env, roleIds: g.roles, channelIds: g.channels }));
    } catch (err) {
      result.errors.push(`${def.key}: ${err.message}`);
    }
  }
  try {
    await publish('status', g.channels.system, await statusService.buildPayload());
  } catch (err) {
    result.errors.push(`status: ${err.message}`);
  }
  if (statsService) {
    try {
      await statsService.updateGuild(guild.client, guild);
      result.updated.push('stats');
    } catch (err) {
      result.errors.push(`stats: ${err.message}`);
    }
  }

  store.flush();
  return result;
}

module.exports = { publishPanels, panelDefinitions, rolesSection };

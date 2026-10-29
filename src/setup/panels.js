'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { TICKET_TYPES, ROLES } = require('../config/serverLayout');
const { LEGACY_PANELS } = require('../config/legacyLayout');
const { sections } = require('../config/docs');
const { embeds, truncate } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const theme = require('../config/theme');

const heading = (icon, title) => `${emojis.icon(icon)}**${title}**`;

/** Abschnitt „Rollen“: Rollen-Erwähnung (pingt nicht in Embeds) plus Beschreibung. */
function rolesSection(roleIds = {}) {
  return ROLES.map((r) => `${emojis.icon(r.icon)}${roleIds[r.key] ? `<@&${roleIds[r.key]}>` : `**${r.name}**`}\n${r.description}`).join('\n\n');
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
        const list = [
          ...sections({ currency: env.currency, websiteUrl: env.websiteUrl }),
          { title: 'Rollen', icon: 'roles', body: rolesSection(roleIds) },
        ];
        const header = embeds.brand().setDescription([
          `${heading('logo', `${theme.brand} · Dokumentation`)}`,
          '',
          'Alles Wichtige zur Plattform auf einen Blick. Bitte lies die Regeln, bevor du der Community beitrittst.',
        ].join('\n'));
        const body = list.map((s) => embeds.base(theme.colors.neutral).setDescription(truncate(`${heading(s.icon, s.title)}\n\n${link(s.body)}`, 4096)));
        const all = [header, ...body];
        // Nur das letzte Embed trägt Footer und Zeitstempel – die Nachricht wirkt dadurch ruhiger.
        all.slice(0, -1).forEach((e) => e.setFooter(null).setTimestamp(null));
        const buttons = [
          withEmoji(new ButtonBuilder().setCustomId('hm:rules:accept').setStyle(ButtonStyle.Success).setLabel('Regeln akzeptieren'), 'check'),
          withEmoji(new ButtonBuilder().setCustomId('hm:verify:start').setStyle(ButtonStyle.Secondary).setLabel('Konto verknüpfen'), 'link'),
        ];
        if (env.websiteUrl) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Website').setURL(env.websiteUrl), 'external'));
        return { embeds: all, components: [new ActionRowBuilder().addComponents(buttons)] };
      },
    },
    {
      key: 'tickets',
      channelKey: 'support',
      build: () => ({
        embeds: [
          embeds.brand().setDescription([
            heading('support', 'Kundenservice'),
            '',
            'Wähle unten das passende Anliegen. Es wird ein privater Channel erstellt, den nur du und das zuständige Team sehen.',
            '',
            ...TICKET_TYPES.map((t) => `${emojis.icon(t.key)}**${t.label}**\n${t.description}`),
            '',
            'Das Team fragt niemals nach Passwörtern. Korrekturen von Guthaben erfolgen ausschließlich über die Website.',
          ].join('\n')),
        ],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('hm:ticket:select')
            .setPlaceholder('Anliegen auswählen')
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
async function publishPanels(guild, { store, env, statusService }) {
  const g = store.guild(guild.id);
  const result = { created: [], updated: [], errors: [] };

  const publish = async (key, channelId, payload) => {
    const channel = channelId && (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)));
    if (!channel?.isTextBased()) {
      result.errors.push(`${key}: Channel fehlt – die Serverstruktur ist nicht vollständig eingerichtet.`);
      return;
    }
    const candidates = [g.panels[key], g.panels[LEGACY_PANELS[key]]].filter((p) => p?.channelId === channel.id);
    for (const ref of candidates) {
      const msg = await channel.messages.fetch(ref.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ content: null, ...payload });
        g.panels[key] = { channelId: channel.id, messageId: msg.id };
        if (LEGACY_PANELS[key]) delete g.panels[LEGACY_PANELS[key]];
        result.updated.push(key);
        return;
      }
    }
    const msg = await channel.send({ ...payload, allowedMentions: { parse: [] } });
    g.panels[key] = { channelId: channel.id, messageId: msg.id };
    result.created.push(key);
  };

  for (const def of panelDefinitions()) {
    try {
      await publish(def.key, g.channels[def.channelKey], def.build({ guild, env, roleIds: g.roles, channelIds: g.channels }));
    } catch (err) {
      result.errors.push(`${def.key}: ${err.message}`);
    }
  }
  try {
    await publish('status', g.channels.system, { embeds: [await statusService.buildEmbed()] });
  } catch (err) {
    result.errors.push(`status: ${err.message}`);
  }

  store.flush();
  return result;
}

module.exports = { publishPanels, panelDefinitions, rolesSection };

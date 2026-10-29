'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { TICKET_TYPES } = require('../config/serverLayout');
const { LEGACY_PANELS } = require('../config/legacyLayout');
const { sections } = require('../config/docs');
const { embeds, truncate } = require('../lib/embeds');
const theme = require('../config/theme');

function panelDefinitions() {
  return [
    {
      key: 'docs',
      channelKey: 'docs',
      build: ({ env }) => {
        const list = sections({ currency: env.currency, websiteUrl: env.websiteUrl });
        const header = embeds.brand()
          .setTitle(`${theme.brand} · Dokumentation`)
          .setDescription('Alles Wichtige zur Plattform auf einen Blick. Bitte lies die Regeln, bevor du der Community beitrittst.');
        const body = list.map((s) => embeds.base(theme.colors.neutral).setTitle(s.title).setDescription(truncate(s.body, 4096)));
        const all = [header, ...body];
        // Nur das letzte Embed trägt Footer und Zeitstempel – die Nachricht wirkt dadurch ruhiger.
        all.slice(0, -1).forEach((e) => e.setFooter(null).setTimestamp(null));
        const buttons = [
          new ButtonBuilder().setCustomId('hm:rules:accept').setStyle(ButtonStyle.Success).setLabel('Regeln akzeptieren'),
          new ButtonBuilder().setCustomId('hm:verify:start').setStyle(ButtonStyle.Secondary).setLabel('Konto verknüpfen'),
        ];
        if (env.websiteUrl) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Website').setURL(env.websiteUrl));
        return { embeds: all, components: [new ActionRowBuilder().addComponents(buttons)] };
      },
    },
    {
      key: 'tickets',
      channelKey: 'support',
      build: () => ({
        embeds: [
          embeds.brand().setTitle('Kundenservice').setDescription([
            'Wähle unten das passende Anliegen. Es wird ein privater Channel erstellt, den nur du und das zuständige Team sehen.',
            '',
            ...TICKET_TYPES.map((t) => `**${t.label}**\n${t.description}`),
            '',
            'Das Team fragt niemals nach Passwörtern. Korrekturen von Guthaben erfolgen ausschließlich über die Website.',
          ].join('\n')),
        ],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('hm:ticket:select')
            .setPlaceholder('Anliegen auswählen')
            .addOptions(TICKET_TYPES.map((t) => ({ label: t.label, value: t.key, description: truncate(t.description, 100) }))),
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
      result.errors.push(`${key}: Channel fehlt – bitte zuerst /setup-server ausführen.`);
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
      await publish(def.key, g.channels[def.channelKey], def.build({ guild, env, ids: g.channels }));
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

module.exports = { publishPanels, panelDefinitions };

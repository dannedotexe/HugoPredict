'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { TICKET_TYPES } = require('../config/serverLayout');
const { LEGACY_PANELS } = require('../config/legacyLayout');
const { sections } = require('../config/docs');
const { truncate } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const { card, upsert } = require('../lib/ui');
const theme = require('../config/theme');

function panelDefinitions() {
  return [
    {
      key: 'docs',
      channelKey: 'docs',
      build: ({ env, channelIds = {} }) => {
        // Channel-Namen im Text werden zu anklickbaren Verweisen, sofern eingerichtet.
        const link = (text) => text
          .replace(/#ankündigungen/g, channelIds.announcements ? `<#${channelIds.announcements}>` : '#ankündigungen')
          .replace(/#support/g, channelIds.support ? `<#${channelIds.support}>` : '#support');
        const blocks = sections({ currency: env.currency, websiteUrl: env.websiteUrl }).map((s) => ({ heading: s.title, icon: s.icon, body: link(s.body) }));
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
      key: 'notify',
      channelKey: 'pings',
      build: () => card({
        icon: 'announce',
        title: 'Benachrichtigungen',
        intro: 'Entscheide selbst, worüber du informiert wirst. Ein Klick meldet dich an, ein weiterer wieder ab.',
        logo: false,
        blocks: [{
          body: [
            `${emojis.icon('open')}**Neue Prognosen**\nPing, sobald eine neue Prognose eröffnet wird.`,
            `${emojis.icon('announce')}**Ankündigungen**\nPing bei wichtigen Mitteilungen des Teams.`,
          ].join('\n'),
        }],
        footer: null,
        actions: [new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId('hm:notify:notifyMarkets').setStyle(ButtonStyle.Secondary).setLabel('Neue Prognosen'), 'open'),
          withEmoji(new ButtonBuilder().setCustomId('hm:notify:notifyNews').setStyle(ButtonStyle.Secondary).setLabel('Ankündigungen'), 'announce'),
        )],
      }),
    },
    {
      key: 'suggest',
      channelKey: 'marketOverview',
      build: () => card({
        icon: 'platform',
        title: 'Prognose vorschlagen',
        intro: 'Du hast eine Idee für eine neue Prognose? Reiche sie hier ein. Die Prognoseverwaltung prüft jeden Vorschlag und meldet sich per Direktnachricht.',
        logo: false,
        blocks: [{
          heading: 'Ein guter Vorschlag hat',
          body: 'eine eindeutige, überprüfbare Frage,\nklar abgegrenzte Ergebnisse (z. B. Ja / Nein),\neine nachvollziehbare Entscheidungsquelle.',
        }],
        footer: null,
        actions: [new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId('hm:suggest:open').setStyle(ButtonStyle.Success).setLabel('Prognose vorschlagen'), 'check'),
        )],
      }),
    },
    {
      key: 'tickets',
      channelKey: 'support',
      build: ({ channelIds = {}, supportOpen = true }) => card({
        size: 'lg',
        icon: 'support',
        title: 'Kundenservice',
        intro: 'Du hast eine Frage oder ein Problem? Wähle unten dein Anliegen.\nEs wird ein privater Channel erstellt, den nur du und das zuständige Team sehen.',
        blocks: [
          { heading: 'Anliegen', icon: 'info', body: TICKET_TYPES.map((t) => `${emojis.icon(t.key)}**${t.label}**\n${t.description}`).join('\n') },
          ...(channelIds.waitingRoom ? [{
            heading: 'Sprach-Support',
            icon: supportOpen ? 'open' : 'closed',
            body: supportOpen
              ? `**Geöffnet.** Komm in <#${channelIds.waitingRoom}>, wir holen dich ab.`
              : '**Gerade geschlossen.** Wähle unten dein Anliegen, wir melden uns schriftlich.',
          }] : []),
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
    {
      key: 'supportControl',
      channelKey: 'supportControl',
      build: ({ channelIds = {}, supportOpen = true }) => card({
        icon: 'support',
        title: 'Support-Warteraum',
        intro: supportOpen
          ? `**Geöffnet.** Mitglieder können ${channelIds.waitingRoom ? `<#${channelIds.waitingRoom}>` : 'den Warteraum'} betreten, wer wartet, wird in #moderation gemeldet.`
          : `**Geschlossen.** ${channelIds.waitingRoom ? `<#${channelIds.waitingRoom}>` : 'Der Warteraum'} ist sichtbar, kann aber nicht betreten werden.`,
        accent: supportOpen ? theme.colors.success : theme.colors.neutral,
        logo: false,
        blocks: [{ body: 'Öffne den Warteraum, sobald jemand vom Team Zeit hat, und schließe ihn, wenn niemand mehr betreuen kann.' }],
        footer: null,
        actions: [new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId('hm:supportvoice:open').setStyle(ButtonStyle.Success).setLabel('Öffnen').setDisabled(supportOpen), 'open'),
          withEmoji(new ButtonBuilder().setCustomId('hm:supportvoice:close').setStyle(ButtonStyle.Danger).setLabel('Schließen').setDisabled(!supportOpen), 'closed'),
        )],
      }),
    },
  ];
}

const buildArgs = (guild, g, env) => ({ guild, env, roleIds: g.roles, channelIds: g.channels, supportOpen: g.supportVoice.open });

/** Aktualisiert einzelne, bereits veröffentlichte Panels (z. B. nach Öffnen/Schließen des Warteraums). */
async function refreshPanels(guild, keys, { store, env }) {
  const g = store.guild(guild.id);
  for (const def of panelDefinitions().filter((d) => keys.includes(d.key))) {
    const ref = g.panels[def.key];
    const channel = ref && guild.channels.cache.get(ref.channelId);
    if (!channel?.isTextBased()) continue;
    const msg = await upsert(channel, ref, def.build(buildArgs(guild, g, env)));
    g.panels[def.key] = { channelId: channel.id, messageId: msg.id };
  }
  store.save();
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
    // Ist ein Panel in einen anderen Channel umgezogen, wird die alte Bot-Nachricht entfernt.
    const old = g.panels[key];
    if (old && old.channelId !== channel.id) {
      const oldChannel = guild.channels.cache.get(old.channelId);
      const oldMsg = oldChannel?.isTextBased() ? await oldChannel.messages.fetch(old.messageId).catch(() => null) : null;
      if (oldMsg && oldMsg.author?.id === guild.client?.user?.id) await oldMsg.delete().catch(() => {});
    }
    const msg = await upsert(channel, ref, payload);
    (ref && msg.id === ref.messageId ? result.updated : result.created).push(key);
    g.panels[key] = { channelId: channel.id, messageId: msg.id };
    if (LEGACY_PANELS[key]) delete g.panels[LEGACY_PANELS[key]];
  };

  for (const def of panelDefinitions()) {
    try {
      await publish(def.key, g.channels[def.channelKey], def.build(buildArgs(guild, g, env)));
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

module.exports = { publishPanels, panelDefinitions, refreshPanels };

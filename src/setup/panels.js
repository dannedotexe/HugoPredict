'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { TICKET_TYPES, APPLICATION_POSITIONS } = require('../config/serverLayout');
const { LEGACY_PANELS } = require('../config/legacyLayout');
const { sections } = require('../config/docs');
const { truncate } = require('../lib/embeds');
const { emojis, withEmoji } = require('../lib/emojis');
const { card, upsert } = require('../lib/ui');
const theme = require('../config/theme');

function panelDefinitions() {
  return [
    {
      key: 'howto',
      channelKey: 'howto',
      build: ({ env, channelIds = {} }) => {
        const ref = (key, fallback) => (channelIds[key] ? `<#${channelIds[key]}>` : fallback);
        const buttons = [];
        if (env.websiteUrl) buttons.push(withEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Zur Website').setURL(env.websiteUrl), 'external'));
        return card({
          size: 'lg',
          icon: 'logo',
          title: 'So funktioniert HugoPredict',
          intro: `Bei **${theme.brand}** sagst du voraus, was passiert – auf **HugoSMP** und darüber hinaus, mit virtuellen ${env.currency} und ganz ohne Echtgeld.`,
          blocks: [
            {
              heading: 'Eine Prognose',
              icon: 'platform',
              body: 'Jede Prognose ist eine Frage zu einem Ereignis – rund um HugoSMP, Minecraft, Streams, Sport und mehr. Zum Beispiel:\n**„Gewinnt Team Nord das Event am Samstag?“**\nJa **62 %** · Nein **38 %**\nDie Prozente zeigen, wie wahrscheinlich die Community das Ergebnis findet.',
            },
            {
              heading: 'So tippst du',
              icon: 'open',
              body: 'Du setzt auf **Ja** oder **Nein**. Liegst du richtig, gewinnst du – und zwar umso mehr, je weniger andere daran geglaubt haben. Liegst du falsch, ist dein Einsatz weg.',
            },
            {
              heading: `Virtuelle ${env.currency}`,
              icon: 'coin',
              body: `${env.currency} sind reines Spielgeld. Man kann sie nicht mit Echtgeld kaufen und nicht in Echtgeld auszahlen.`,
            },
            {
              heading: 'Los geht’s',
              icon: 'check',
              body: [
                `1. Regeln in ${ref('docs', '#regeln')} akzeptieren`,
                `2. In ${ref('pings', '#pings')} auswählen, worüber du informiert wirst`,
                `3. Prognosen in ${ref('marketOverview', '#prognosen')} ansehen oder selbst eine vorschlagen`,
                `Fragen? Wir helfen dir in ${ref('support', '#support')}.`,
              ].join('\n'),
            },
          ],
          footer: `Die Website ist im Aufbau – Neuigkeiten gibt es zuerst in ${ref('announcements', '#ankündigungen')}`,
          actions: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
        });
      },
    },
    {
      key: 'verify',
      channelKey: 'verify',
      build: ({ channelIds = {} }) => card({
        icon: 'verified',
        title: 'Konto verknüpfen',
        intro: 'Verbinde dein Discord-Konto mit deinem Minecraft-Konto auf **HugoSMP**. Dauert keine Minute.',
        blocks: [
          {
            heading: 'So geht’s',
            icon: 'info',
            body: [
              '1. Unten auf **Verknüpfen** tippen',
              '2. Du bekommst einen Befehl wie `/msg HugoPredict KE2KM`',
              '3. Den Befehl auf HugoSMP im Chat abschicken',
              '4. Fertig – du wirst automatisch verifiziert',
            ].join('\n'),
          },
          {
            heading: 'Was du davon hast',
            icon: 'check',
            body: `Die Rolle Verifiziert, dein Minecraft-Name als Server-Name und Kontoabfragen wie \`/balance\`.${channelIds.docs ? ` Vorher bitte die Regeln in <#${channelIds.docs}> akzeptieren.` : ''}`,
          },
          { heading: 'Sicherheit', icon: 'lock', body: 'Schick nur einen Befehl ab, den du selbst hier bekommen hast – niemals einen, den dir jemand anderes gibt.' },
        ],
        footer: null,
        actions: [new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId('hm:verify:start').setStyle(ButtonStyle.Success).setLabel('Verknüpfen'), 'link'),
        )],
      }),
    },
    {
      key: 'docs',
      channelKey: 'docs',
      build: ({ env, channelIds = {} }) => {
        // Channel-Namen im Text werden zu anklickbaren Verweisen, sofern eingerichtet.
        const link = (text) => text
          .replace(/#ankündigungen/g, channelIds.announcements ? `<#${channelIds.announcements}>` : '#ankündigungen')
          .replace(/#support/g, channelIds.support ? `<#${channelIds.support}>` : '#support')
          .replace(/#verifizieren/g, channelIds.verify ? `<#${channelIds.verify}>` : '#verifizieren');
        const blocks = sections({ currency: env.currency, websiteUrl: env.websiteUrl }).map((s) => ({ heading: s.title, icon: s.icon, body: link(s.body) }));
        const buttons = [
          withEmoji(new ButtonBuilder().setCustomId('hm:rules:accept').setStyle(ButtonStyle.Success).setLabel('Regeln akzeptieren'), 'check'),
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
      key: 'apply',
      channelKey: 'apply',
      build: ({ channelIds = {} }) => card({
        icon: 'member',
        title: 'Team-Bewerbung',
        intro: 'Du willst HugoPredict mit aufbauen? Wähle unten die Stelle, die zu dir passt, und füll das kurze Formular aus.',
        blocks: [
          { heading: 'Offene Stellen', icon: 'info', body: APPLICATION_POSITIONS.map((p) => `**${p.label}**\n${p.description}`).join('\n') },
          { heading: 'Gut zu wissen', icon: 'lock', body: `Bewerben kannst du dich, nachdem du die Regeln${channelIds.docs ? ` in <#${channelIds.docs}>` : ''} akzeptiert hast.\nPro Person ist eine Bewerbung gleichzeitig möglich, die Antwort kommt per Direktnachricht.` },
        ],
        footer: 'Bewerbungen sieht nur die Serverleitung',
        actions: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('hm:apply:select')
            .setPlaceholder('Stelle auswählen …')
            .addOptions(APPLICATION_POSITIONS.map((p) => withEmoji(
              new StringSelectMenuOptionBuilder().setLabel(p.label).setValue(p.key).setDescription(truncate(p.description, 100)),
              p.icon,
            ))),
        )],
      }),
    },
    {
      key: 'minecraftPanel',
      channelKey: 'minecraftPanel',
      build: () => card({
        icon: 'bot',
        title: 'Minecraft-Bot',
        intro: 'Befehle laufen über den Bot-Account auf HugoSMP. Antworten siehst nur du, jede Aktion steht im Prüfprotokoll.',
        blocks: [
          { heading: 'So geht’s', icon: 'info', body: '**Befehl ausführen:** beliebiger Befehl, z. B. `/money log`\n**/pay:** Geld vom Bot an einen Spieler, mit Bestätigung\n**Kontostand:** führt `/balance` aus\n**Status & Einstellungen:** Verbindung, Kontostand-Prüfung, Auszahlungen, Join-Befehle' },
          { heading: 'Zugriff', icon: 'lock', body: 'Nutzen kann das Panel, wer diesen Channel sieht. Wer Zugriff bekommt, legst du in den Channel-Berechtigungen fest.' },
        ],
        footer: null,
        actions: [new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId('hm:panel:cmd').setStyle(ButtonStyle.Primary).setLabel('Befehl ausführen'), 'platform'),
          withEmoji(new ButtonBuilder().setCustomId('hm:panel:pay').setStyle(ButtonStyle.Success).setLabel('/pay'), 'coin'),
          withEmoji(new ButtonBuilder().setCustomId('hm:panel:balance').setStyle(ButtonStyle.Secondary).setLabel('Kontostand'), 'balance'),
          withEmoji(new ButtonBuilder().setCustomId('hm:panel:refresh').setStyle(ButtonStyle.Secondary).setLabel('Status & Einstellungen'), 'info'),
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
        blocks: [
          { heading: 'Support-Gespräche', body: 'Setz dich in einen Support-Raum und wähle „Nächsten holen“: Platz 1 der Warteschlange landet bei dir. Mit „Gespräch beenden“ trennst du die Person wieder.' },
          { heading: 'Warteraum', body: 'Öffne ihn, sobald jemand vom Team Zeit hat, und schließe ihn, wenn niemand mehr Zeit hat. „Warteraum leeren“ wirft alle Wartenden hinaus, das Team bleibt.' },
        ],
        footer: null,
        actions: [new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId('hm:supportvoice:next').setStyle(ButtonStyle.Primary).setLabel('Nächsten holen'), 'support'),
          withEmoji(new ButtonBuilder().setCustomId('hm:supportvoice:end').setStyle(ButtonStyle.Secondary).setLabel('Gespräch beenden'), 'check'),
        ), new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId('hm:supportvoice:open').setStyle(ButtonStyle.Success).setLabel('Öffnen').setDisabled(supportOpen), 'open'),
          withEmoji(new ButtonBuilder().setCustomId('hm:supportvoice:close').setStyle(ButtonStyle.Danger).setLabel('Schließen').setDisabled(!supportOpen), 'closed'),
          withEmoji(new ButtonBuilder().setCustomId('hm:supportvoice:empty').setStyle(ButtonStyle.Secondary).setLabel('Warteraum leeren'), 'error'),
        )],
      }),
    },
  ];
}

// --- Vorlage im Forum #vorschläge ------------------------------------------

const IDEAS_TEMPLATE_TITLE = '📌 Vorlage: So schreibst du einen guten Vorschlag';

function ideasTemplateText(channelIds = {}) {
  const prognosen = channelIds.marketOverview ? `<#${channelIds.marketOverview}>` : '#prognosen';
  return [
    '## So schreibst du einen guten Vorschlag',
    'Erstelle für **jede Idee einen eigenen Beitrag**, gib ihm einen kurzen, klaren Titel und wähle einen Bereich: 🏠 Server, 🤖 Bot, 🌐 Website oder ⛏️ Minecraft.',
    'Schau vorher kurz, ob es den Vorschlag schon gibt. Dann stimm dort lieber mit 👍 ab.',
    '',
    '**Vorlage zum Kopieren**',
    '```',
    'Was ist die Idee?',
    '…',
    '',
    'Warum hilft das?',
    '…',
    '',
    'Wie könnte es umgesetzt werden? (optional)',
    '…',
    '```',
    '**Status** – setzt das Team: 🔍 In Prüfung · ✅ Angenommen · ❌ Abgelehnt · 🎉 Umgesetzt',
    `-# Neue Prognosen bitte über „Prognose vorschlagen“ in ${prognosen}.`,
  ].join('\n');
}

/**
 * Angepinnter, gesperrter Vorlage-Beitrag im Forum. Wird bearbeitet statt neu
 * erstellt. Anpinnen und Sperren brauchen „Threads verwalten“ – fehlt das, bleibt
 * der Beitrag trotzdem stehen und es gibt einen Hinweis.
 */
async function publishIdeasTemplate(guild, g) {
  const forum = g.channels.ideas && guild.channels.cache.get(g.channels.ideas);
  if (!forum || forum.type !== ChannelType.GuildForum) return null;
  const content = ideasTemplateText(g.channels);
  const ref = g.panels.ideasTemplate;
  let thread = ref?.channelId === forum.id ? await forum.threads.fetch(ref.threadId).catch(() => null) : null;
  let created = false;
  if (thread) {
    if (thread.archived) await thread.setArchived(false).catch(() => {});
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) await starter.edit({ content, allowedMentions: { parse: [] } });
  } else {
    thread = await forum.threads.create({ name: IDEAS_TEMPLATE_TITLE, message: { content, allowedMentions: { parse: [] } }, reason: 'HugoPredict: Vorlage für Vorschläge' });
    g.panels.ideasTemplate = { channelId: forum.id, threadId: thread.id };
    created = true;
  }
  let warning = null;
  try {
    if (!thread.flags?.has?.('Pinned')) await thread.pin('HugoPredict: Vorlage oben halten');
    if (!thread.locked) await thread.setLocked(true, 'HugoPredict: Vorlage ohne Antworten');
  } catch {
    warning = 'Vorlage in #vorschläge: Zum Anpinnen braucht die Bot-Rolle „Threads verwalten“.';
  }
  return { created, warning };
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
  if (statusService.buildPublicPayload && g.channels.publicStatus) {
    try {
      await publish('publicStatus', g.channels.publicStatus, await statusService.buildPublicPayload());
    } catch (err) {
      result.errors.push(`publicStatus: ${err.message}`);
    }
  }
  try {
    const template = await publishIdeasTemplate(guild, g);
    if (template) (template.created ? result.created : result.updated).push('ideasTemplate');
    if (template?.warning) result.errors.push(template.warning);
  } catch (err) {
    result.errors.push(`ideasTemplate: ${err.message}`);
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

module.exports = { publishPanels, panelDefinitions, refreshPanels, publishIdeasTemplate, ideasTemplateText };

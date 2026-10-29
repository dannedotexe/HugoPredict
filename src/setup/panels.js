'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { TICKET_TYPES } = require('../config/serverLayout');
const { embeds } = require('../lib/embeds');

const channelLink = (guildId, channelId) => (channelId ? `https://discord.com/channels/${guildId}/${channelId}` : null);

function linkButton(label, url) {
  return url ? new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url) : null;
}

function row(...buttons) {
  const list = buttons.filter(Boolean);
  return list.length ? new ActionRowBuilder().addComponents(list) : null;
}

/** Liefert alle Panels als { key, channelKey, build(ctx) }. */
function panelDefinitions() {
  return [
    {
      key: 'welcome',
      channelKey: 'welcome',
      build: ({ guild, env, ids }) => ({
        embeds: [
          embeds.brand()
            .setTitle('Willkommen bei HugoSMP Market')
            .setDescription([
              'Die Prognoseplattform für den Minecraft-Server **HugoSMP**.',
              'Handle auf den Ausgang von Ereignissen, verfolge Live-Märkte und messe dich mit anderen Tradern.',
              '',
              '**So startest du**',
              `1. Lies und akzeptiere die Regeln in <#${ids.rules ?? '0'}>.`,
              `2. Verknüpfe deinen Minecraft-Account in <#${ids.verification ?? '0'}>.`,
              '3. Nutze `/help` für eine Übersicht aller Befehle.',
            ].join('\n'))
            .addFields(
              { name: 'Website', value: env.websiteUrl || 'Wird in Kürze bekannt gegeben', inline: true },
              { name: 'Support', value: ids.ticketCreate ? `<#${ids.ticketCreate}>` : '—', inline: true },
            ),
        ],
        components: [row(
          linkButton('Zur Website', env.websiteUrl),
          linkButton('Regeln', channelLink(guild.id, ids.rules)),
          linkButton('Verifizieren', channelLink(guild.id, ids.verification)),
        )].filter(Boolean),
      }),
    },
    {
      key: 'rules',
      channelKey: 'rules',
      build: () => ({
        embeds: [
          embeds.info('Serverregeln', [
            '**1. Respekt** – Kein Hass, keine Beleidigungen, keine Diskriminierung.',
            '**2. Keine Manipulation** – Absprachen zur Marktmanipulation, Multi-Accounts und Ausnutzen von Fehlern sind verboten.',
            '**3. Kein Betrug** – Keine Fake-Trades, Fake-Screenshots oder Identitätstäuschung.',
            '**4. Privatsphäre** – Teile keine Kontodaten oder privaten Informationen anderer.',
            '**5. Kein Spam & keine Werbung** – Auch nicht per Direktnachricht.',
            '**6. Fehler melden** – Bugs und Probleme gehören in ein Ticket, nicht in den Chat.',
            '**7. Entscheidungen** – Marktentscheidungen trifft ausschließlich das Market-Team anhand der angegebenen Quelle.',
            '**8. Discord-Richtlinien** – Es gelten die Nutzungsbedingungen und Community-Richtlinien von Discord.',
            '',
            'Verstöße können zu Verwarnungen, Ausschluss vom Handel oder einem Bann führen.',
          ].join('\n')),
        ],
        components: [row(new ButtonBuilder().setCustomId('hm:rules:accept').setStyle(ButtonStyle.Success).setLabel('Regeln akzeptieren'))],
      }),
    },
    {
      key: 'website',
      channelKey: 'website',
      build: ({ env }) => ({
        embeds: [
          embeds.brand()
            .setTitle('HugoSMP Market')
            .setDescription(env.websiteUrl
              ? `Alle Märkte, dein Portfolio und dein Guthaben findest du auf der Website:\n${env.websiteUrl}`
              : 'Der Link zur Website wird hier veröffentlicht, sobald die Plattform freigeschaltet ist.'),
        ],
        components: [row(linkButton('Website öffnen', env.websiteUrl))].filter(Boolean),
      }),
    },
    {
      key: 'verification',
      channelKey: 'verification',
      build: () => ({
        embeds: [
          embeds.info('Account-Verifizierung', [
            'Verknüpfe deinen Minecraft-Account mit HugoSMP Market, um Zugriff auf Trading-Funktionen zu erhalten.',
            '',
            '**Ablauf**',
            '1. Klicke auf **Verifizierung starten** und gib deinen Minecraft-Namen ein.',
            '2. Folge den angezeigten Anweisungen, um den Code zu bestätigen.',
            '3. Klicke auf **Status prüfen**. Nach erfolgreicher Prüfung erhältst du die Rolle **Verified**.',
            '',
            'Deine Daten werden nur zur Kontoverknüpfung verwendet. Gib deinen Code niemals an andere weiter.',
          ].join('\n')),
        ],
        components: [row(
          new ButtonBuilder().setCustomId('hm:verify:start').setStyle(ButtonStyle.Success).setLabel('Verifizierung starten'),
          new ButtonBuilder().setCustomId('hm:verify:check').setStyle(ButtonStyle.Secondary).setLabel('Status prüfen'),
        )],
      }),
    },
    {
      key: 'tickets',
      channelKey: 'ticketCreate',
      build: () => {
        const buttons = TICKET_TYPES.map((t, i) =>
          new ButtonBuilder().setCustomId(`hm:ticket:open:${t.key}`).setLabel(t.label)
            .setStyle(i === 0 ? ButtonStyle.Primary : t.key === 'fraud' ? ButtonStyle.Danger : ButtonStyle.Secondary));
        return {
          embeds: [
            embeds.info('Support-Ticket erstellen', [
              'Wähle die passende Kategorie. Es wird ein privater Channel erstellt, den nur du und das zuständige Team sehen.',
              '',
              ...TICKET_TYPES.map((t) => `**${t.label}** – ${t.description}`),
              '',
              'Das Team wird dich niemals nach deinem Passwort fragen.',
            ].join('\n')),
          ],
          components: [row(...buttons.slice(0, 5))],
        };
      },
    },
    {
      key: 'transactionIssues',
      channelKey: 'transactionIssues',
      build: () => ({
        embeds: [embeds.warning('Probleme mit Transaktionen', 'Bitte poste keine Kontodaten öffentlich. Öffne für Probleme mit Guthaben, Trades oder Auszahlungen ein privates Ticket – das Team prüft den Fall anhand der Website-Daten.')],
        components: [row(new ButtonBuilder().setCustomId('hm:ticket:open:balance').setStyle(ButtonStyle.Primary).setLabel('Ticket zu Guthaben/Transaktion'))],
      }),
    },
    {
      key: 'fraudReports',
      channelKey: 'fraudReports',
      build: () => ({
        embeds: [embeds.error('Betrugsverdacht melden', 'Verdacht auf Betrug, Manipulation oder Multi-Accounts? Melde ihn vertraulich per Ticket. Beschuldige niemanden öffentlich.')],
        components: [row(new ButtonBuilder().setCustomId('hm:ticket:open:fraud').setStyle(ButtonStyle.Danger).setLabel('Vertraulich melden'))],
      }),
    },
    {
      key: 'suggestions',
      channelKey: 'marketSuggestions',
      build: ({ ids }) => ({
        embeds: [
          embeds.info('Markt vorschlagen', [
            'Du hast eine Idee für einen neuen Markt? Reiche sie hier ein.',
            '',
            '**Ein guter Vorschlag hat**',
            '• eine eindeutige, überprüfbare Frage,',
            '• klar abgegrenzte Ergebnisse (z. B. Ja / Nein),',
            '• eine nachvollziehbare Entscheidungsquelle.',
            '',
            `Die Community stimmt in ${ids.communityVotes ? `<#${ids.communityVotes}>` : 'den Community-Votes'} ab. Über die Aufnahme entscheidet das Market-Team.`,
          ].join('\n')),
        ],
        components: [row(new ButtonBuilder().setCustomId('hm:suggest:open').setStyle(ButtonStyle.Success).setLabel('Markt vorschlagen'))],
      }),
    },
    {
      key: 'faq',
      channelKey: 'faq',
      build: ({ env, ids }) => ({
        embeds: [
          embeds.info('Häufige Fragen').addFields(
            { name: 'Wie verknüpfe ich meinen Account?', value: `In ${ids.verification ? `<#${ids.verification}>` : 'der Account-Verifizierung'} oder mit \`/verify\`.`, inline: false },
            { name: 'Wer sieht mein Guthaben?', value: 'Nur du. `/balance`, `/portfolio` und `/history` antworten ausschließlich privat.', inline: false },
            { name: `Woher kommen die ${env.currency}?`, value: 'Alle Kontostände werden von der Website verwaltet. Der Discord-Bot zeigt sie nur an und kann sie nicht verändern.', inline: false },
            { name: 'Wer entscheidet Märkte?', value: 'Das Market-Team anhand der beim Markt angegebenen Entscheidungsquelle.', inline: false },
            { name: 'Ich habe ein Problem.', value: ids.ticketCreate ? `Öffne ein Ticket in <#${ids.ticketCreate}>.` : 'Öffne ein Support-Ticket.', inline: false },
          ),
        ],
        components: [],
      }),
    },
  ];
}

/**
 * Veröffentlicht alle Panels. Bereits vorhandene Panel-Nachrichten werden
 * bearbeitet, damit keine Duplikate entstehen.
 */
async function publishPanels(guild, { store, env, statusService }) {
  const g = store.guild(guild.id);
  const result = { created: [], updated: [], errors: [] };

  const publish = async (key, channelId, payload) => {
    const channel = channelId && (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)));
    if (!channel?.isTextBased()) {
      result.errors.push(`${key}: Channel fehlt – zuerst /setup-server ausführen.`);
      return;
    }
    const stored = g.panels[key];
    if (stored?.channelId === channel.id) {
      const msg = await channel.messages.fetch(stored.messageId).catch(() => null);
      if (msg) {
        await msg.edit(payload);
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

  // Status-Panel wird vom Status-Service gepflegt.
  try {
    await publish('status', g.channels.status, { embeds: [await statusService.buildEmbed()] });
  } catch (err) {
    result.errors.push(`status: ${err.message}`);
  }

  store.flush();
  return result;
}

module.exports = { publishPanels, panelDefinitions };

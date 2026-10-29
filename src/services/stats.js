'use strict';

const { discordTime } = require('../lib/embeds');
const { card, upsert } = require('../lib/ui');

const DAY = 24 * 60 * 60_000;
const nf = new Intl.NumberFormat('de-DE');
const num = (v) => (Number.isFinite(v) ? nf.format(v) : '—');

/** Reine Funktion: baut die Statistik-Karte aus bereits ermittelten Zahlen. */
function statsCard(s) {
  const row = (pairs) => pairs.map(([label, v]) => `**${num(v)}** ${label}`).join('  ·  ');
  return card({
    title: 'Serverstatistik',
    icon: 'roles',
    intro: 'Aktuelle Kennzahlen der Community.',
    blocks: [
      { heading: 'Community', body: `${row([['Mitglieder', s.members], ['online', s.online]])}\n${row([['neu in 7 Tagen', s.joined7d]])}` },
      { heading: 'Rollen', body: row([['Mitglied', s.memberRole], ['Verifiziert', s.verified]]) },
      { heading: 'Betrieb', body: `${row([['offene Anfragen', s.openTickets], ['Vorschläge in Prüfung', s.openSuggestions]])}\n${row([['Moderationsfälle (7 Tage)', s.cases7d]])}` },
      s.membersIntent ? null : { heading: 'Hinweis', icon: 'info', body: 'Für Rollen- und Beitrittszahlen im Developer Portal unter Bot den „Server Members Intent“ aktivieren.' },
    ],
    footer: `Wird stündlich aktualisiert · Stand ${discordTime(new Date(), 't')}`,
  });
}

async function collectStats(guild, { store, ctx, membersIntent, client, now = Date.now() }) {
  const g = store.guild(guild.id);
  const s = {
    members: guild.memberCount,
    membersIntent,
    openTickets: Object.values(g.tickets).filter((t) => t.status === 'open').length,
    openSuggestions: Object.values(g.suggestions).filter((x) => x.status === 'open').length,
    cases7d: (g.moderation?.cases ?? []).filter((c) => now - Date.parse(c.at) < 7 * DAY).length,
  };
  try {
    const counted = await client.guilds.fetch({ guild: guild.id, withCounts: true, force: true });
    s.online = counted.approximatePresenceCount ?? null;
    s.members = counted.approximateMemberCount ?? s.members;
  } catch {
    s.online = null;
  }
  if (membersIntent) {
    const members = await guild.members.fetch();
    const has = (key) => {
      const id = ctx.roleId(guild.id, key);
      return id ? members.filter((m) => m.roles.cache.has(id)).size : null;
    };
    s.memberRole = has('member');
    s.verified = has('verified');
    s.joined7d = members.filter((m) => m.joinedTimestamp && now - m.joinedTimestamp < 7 * DAY).size;
    s.members = members.size;
  }
  return s;
}

function createStatsService({ store, ctx, logger, membersIntent }) {
  async function updateGuild(client, guild) {
    const g = store.guild(guild.id);
    const channel = await ctx.channel(guild, 'system');
    if (!channel?.isTextBased()) return;
    const payload = statsCard(await collectStats(guild, { store, ctx, membersIntent, client }));
    const ref = g.panels.stats;
    const msg = await upsert(channel, ref, payload);
    if (msg.id !== ref?.messageId) {
      g.panels.stats = { channelId: channel.id, messageId: msg.id };
      store.save();
    }
  }

  async function tick(client) {
    for (const guild of client.guilds.cache.values()) {
      if (store.guild(guild.id).layoutVersion !== 2) continue;
      await updateGuild(client, guild).catch((err) => logger.warn('Statistik:', err.message));
    }
  }

  return { tick, updateGuild };
}

module.exports = { createStatsService, statsCard, collectStats };

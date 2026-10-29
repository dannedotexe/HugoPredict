'use strict';

const { embeds } = require('../lib/embeds');
const { emojis } = require('../lib/emojis');
const theme = require('../config/theme');

const DAY = 24 * 60 * 60_000;
const nf = new Intl.NumberFormat('de-DE');
const num = (v) => (Number.isFinite(v) ? nf.format(v) : '—');

/** Reine Funktion: baut das Statistik-Embed aus bereits ermittelten Zahlen. */
function statsEmbed(s) {
  const e = embeds.brand()
    .setDescription(`${emojis.icon('roles')}**Serverstatistik**`)
    .addFields(
      { name: 'Mitglieder', value: num(s.members), inline: true },
      { name: 'Online (ca.)', value: num(s.online), inline: true },
      { name: 'Neu (7 Tage)', value: num(s.joined7d), inline: true },
      { name: 'Rolle Mitglied', value: num(s.memberRole), inline: true },
      { name: 'Verifiziert', value: num(s.verified), inline: true },
      { name: '​', value: '​', inline: true },
      { name: 'Offene Anfragen', value: num(s.openTickets), inline: true },
      { name: 'Vorschläge in Prüfung', value: num(s.openSuggestions), inline: true },
      { name: 'Moderationsfälle (7 Tage)', value: num(s.cases7d), inline: true },
    )
    .setFooter({ text: `${theme.brand} · Wird stündlich aktualisiert` });
  if (!s.membersIntent) {
    e.addFields({ name: 'Hinweis', value: 'Für Rollen- und Beitrittszahlen im Developer Portal unter Bot den „Server Members Intent“ aktivieren.', inline: false });
  }
  return e;
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
    const payload = { embeds: [statsEmbed(await collectStats(guild, { store, ctx, membersIntent, client }))] };
    const ref = g.panels.stats;
    const msg = ref?.channelId === channel.id ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
    if (msg) await msg.edit(payload);
    else {
      const sent = await channel.send(payload);
      g.panels.stats = { channelId: channel.id, messageId: sent.id };
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

module.exports = { createStatsService, statsEmbed, collectStats };

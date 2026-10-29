'use strict';

const { ChannelType } = require('discord.js');
const { ARCHIVE_CATEGORY } = require('../config/serverLayout');
const { buildPlan } = require('./setupServer');

const REASON = 'HugoPredict-Aufräumen';

/*
 * Endgültiges Aufräumen nach der Migration – nur auf ausdrücklichen Befehl
 * (/aufräumen) und nach Bestätigung. Gelöscht wird ausschließlich:
 *  - alles in der Kategorie ARCHIV und die Kategorie selbst,
 *  - LEERE Kategorien der früheren Struktur,
 *  - optional veraltete Rollen der früheren Struktur.
 * Elemente der aktuellen Struktur werden nie gelöscht.
 */
function planCleanup(guild, store, { includeRoles = false } = {}) {
  const g = store.guild(guild.id);
  const plan = buildPlan(guild, store);
  const protectedIds = new Set([
    ...plan.categories.map((c) => c.channel?.id),
    ...plan.channels.map((c) => c.channel?.id),
    ...plan.roles.map((r) => r.role?.id),
  ].filter(Boolean));
  const children = (id) => guild.channels.cache.filter((c) => c.parentId === id);

  const archive = guild.channels.cache.get(g.categories.archive)
    ?? guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === ARCHIVE_CATEGORY.name);
  const archiveChannels = archive ? [...children(archive.id).values()].filter((c) => !protectedIds.has(c.id)) : [];
  const openTickets = new Set(Object.keys(g.tickets ?? {}));

  const categories = [];
  const keptCategories = [];
  for (const o of plan.obsolete.filter((x) => x.kind === 'category')) {
    const rest = children(o.id);
    if (rest.size === 0) categories.push(o.object);
    else keptCategories.push(`${o.name} (${rest.size} Channel${rest.size === 1 ? '' : 's'})`);
  }
  if (archive && !protectedIds.has(archive.id)) categories.push(archive);

  const me = guild.members.me;
  const roles = includeRoles
    ? plan.obsolete.filter((x) => x.kind === 'role' && x.object.position < me.roles.highest.position).map((x) => x.object)
    : [];
  const leftoverChannels = plan.obsolete.filter((x) => x.kind === 'channel' && x.object.parentId !== archive?.id).map((x) => `#${x.name}`);

  return {
    channels: archiveChannels.filter((c) => !openTickets.has(c.id)),
    categories: categories.filter((c) => !protectedIds.has(c.id)),
    roles: roles.filter((r) => !protectedIds.has(r.id)),
    keptCategories,
    leftoverChannels,
    skippedTickets: archiveChannels.filter((c) => openTickets.has(c.id)).map((c) => `#${c.name}`),
  };
}

async function runCleanup(guild, store, plan, { logger } = {}) {
  const g = store.guild(guild.id);
  const result = { deleted: [], errors: [] };
  const forget = (id) => {
    for (const map of [g.channels, g.categories, g.roles]) {
      for (const [k, v] of Object.entries(map)) if (v === id) delete map[k];
    }
  };

  for (const ch of plan.channels) {
    try {
      await ch.delete(REASON);
      forget(ch.id);
      result.deleted.push(`#${ch.name}`);
    } catch (err) {
      result.errors.push(`#${ch.name}: ${err.message}`);
    }
  }
  for (const cat of plan.categories) {
    // Sicherheitsprüfung: nur wirklich leere Kategorien löschen
    if (guild.channels.cache.some((c) => c.parentId === cat.id)) {
      result.errors.push(`Kategorie ${cat.name}: nicht leer, nicht gelöscht.`);
      continue;
    }
    try {
      await cat.delete(REASON);
      forget(cat.id);
      result.deleted.push(`Kategorie ${cat.name}`);
    } catch (err) {
      result.errors.push(`Kategorie ${cat.name}: ${err.message}`);
    }
  }
  for (const role of plan.roles) {
    try {
      await role.delete(REASON);
      forget(role.id);
      result.deleted.push(`Rolle ${role.name}`);
    } catch (err) {
      result.errors.push(`Rolle ${role.name}: ${err.message}`);
    }
  }
  store.flush();
  logger?.info(`Aufräumen in ${guild.name}: ${result.deleted.length} gelöscht, ${result.errors.length} Fehler.`);
  return result;
}

module.exports = { planCleanup, runCleanup };

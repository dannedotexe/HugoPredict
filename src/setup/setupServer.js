'use strict';

const { ChannelType, OverwriteType, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { ROLES, CATEGORIES, REQUIRED_BOT_PERMISSIONS } = require('../config/serverLayout');

const permNames = (bits) => new PermissionsBitField(bits).toArray();

function missingBotPermissions(me) {
  return REQUIRED_BOT_PERMISSIONS.filter((p) => !me.permissions.has(p));
}

function findRole(guild, stored, name) {
  return (stored && guild.roles.cache.get(stored)) || guild.roles.cache.find((r) => r.name === name) || null;
}

function findChannel(guild, stored, name, type, parentId) {
  const byId = stored && guild.channels.cache.get(stored);
  if (byId && byId.type === type) return byId;
  const lower = name.toLowerCase();
  const candidates = guild.channels.cache.filter((c) => c.type === type && c.name.toLowerCase() === lower);
  return candidates.find((c) => c.parentId === parentId) ?? candidates.first() ?? null;
}

/**
 * Übersetzt die deklarativen Overwrites aus serverLayout.js in discord.js-Format.
 * Mehrfachnennungen desselben Ziels werden zusammengeführt (allow gewinnt).
 */
function resolveOverwrites(spec, { guild, me, roleIds }) {
  const merged = new Map();
  const unresolved = new Set();
  for (const { target, allow, deny } of spec) {
    let id;
    let type = OverwriteType.Role;
    if (target === 'everyone') id = guild.roles.everyone.id;
    else if (target === 'bot') {
      id = me.id;
      type = OverwriteType.Member;
    } else id = roleIds[target];
    if (!id) {
      unresolved.add(target);
      continue;
    }
    const entry = merged.get(id) ?? { id, type, allow: 0n, deny: 0n };
    for (const p of allow) entry.allow |= p;
    for (const p of deny) entry.deny |= p;
    merged.set(id, entry);
  }
  const overwrites = [...merged.values()].map((e) => ({ ...e, deny: e.deny & ~e.allow }));
  return { overwrites, unresolved: [...unresolved] };
}

/** Vorschau für die Bestätigung – verändert nichts. */
function planSetup(guild, store) {
  const g = store.guild(guild.id);
  const me = guild.members.me;
  const plan = { rolesNew: [], rolesExisting: [], categoriesNew: [], categoriesExisting: [], channelsNew: [], channelsExisting: [] };

  for (const r of ROLES) (findRole(guild, g.roles[r.key], r.name) ? plan.rolesExisting : plan.rolesNew).push(r.name);
  for (const c of CATEGORIES) {
    const cat = findChannel(guild, g.categories[c.key], c.name, ChannelType.GuildCategory, null);
    (cat ? plan.categoriesExisting : plan.categoriesNew).push(c.name);
    for (const ch of c.channels) {
      (findChannel(guild, g.channels[ch.key], ch.name, ch.type, cat?.id ?? null) ? plan.channelsExisting : plan.channelsNew).push(ch.name);
    }
  }
  plan.missingPermissions = permNames(missingBotPermissions(me));
  return plan;
}

/**
 * Richtet Rollen, Kategorien und Channels ein. Idempotent: Vorhandenes wird
 * erkannt und nicht dupliziert. Mit syncPermissions werden auch bestehende
 * Objekte auf das Layout zurückgesetzt (Rechte, Farben).
 */
async function runSetup(guild, store, { syncPermissions = false, logger } = {}) {
  const result = { created: [], updated: [], existing: [], warnings: [], errors: [] };
  const g = store.guild(guild.id);
  const me = guild.members.me ?? (await guild.members.fetchMe());

  const missing = missingBotPermissions(me);
  if (missing.length) {
    result.errors.push(`Dem Bot fehlen Berechtigungen: ${permNames(missing).join(', ')}. Bitte in den Servereinstellungen ergänzen.`);
    return result;
  }

  await guild.roles.fetch();
  await guild.channels.fetch();
  const botIsAdmin = me.permissions.has(PermissionFlagsBits.Administrator);

  // ---- Rollen ------------------------------------------------------------
  for (const def of ROLES) {
    const desired = def.permissions.reduce((a, p) => a | p, 0n);
    // Discord erlaubt nur Rechte zu vergeben, die der Bot selbst besitzt.
    const grantable = botIsAdmin ? desired : desired & me.permissions.bitfield;
    const notGrantable = desired & ~grantable;
    try {
      let role = findRole(guild, g.roles[def.key], def.name);
      if (!role) {
        role = await guild.roles.create({
          name: def.name, color: def.color, hoist: def.hoist, mentionable: def.mentionable,
          permissions: grantable, reason: 'HugoSMP Market Setup',
        });
        result.created.push(`Rolle ${def.name}`);
      } else if (role.managed || role.position >= me.roles.highest.position) {
        result.existing.push(`Rolle ${def.name}`);
        if (syncPermissions) result.warnings.push(`${def.name} liegt über der Bot-Rolle und wurde nicht angepasst.`);
      } else if (syncPermissions) {
        await role.edit({ color: def.color, hoist: def.hoist, mentionable: def.mentionable, permissions: grantable, reason: 'HugoSMP Market Setup (Sync)' });
        result.updated.push(`Rolle ${def.name}`);
      } else {
        result.existing.push(`Rolle ${def.name}`);
      }
      g.roles[def.key] = role.id;
      if (notGrantable) {
        result.warnings.push(`${def.name}: Bitte manuell ergänzen (Bot darf nicht vergeben): ${permNames(notGrantable).join(', ')}.`);
      }
    } catch (err) {
      result.errors.push(`Rolle ${def.name}: ${err.message}`);
    }
  }
  store.save();

  // Reihenfolge herstellen (nur Rollen unterhalb der Bot-Rolle sind verschiebbar).
  try {
    const top = me.roles.highest.position;
    const manageable = ROLES.map((r) => guild.roles.cache.get(g.roles[r.key])).filter((r) => r && !r.managed && r.position < top);
    const ordered = manageable.every((r, i) => i === 0 || manageable[i - 1].position > r.position);
    if (!ordered && manageable.length) {
      await guild.roles.setPositions(manageable.map((role, i) => ({ role: role.id, position: Math.max(1, top - 1 - i) })));
      result.updated.push('Rollen-Reihenfolge');
    }
    if (manageable.length < ROLES.length) {
      result.warnings.push('Nicht alle Rollen liegen unter der Bot-Rolle – deren Position wurde nicht verändert.');
    }
  } catch (err) {
    result.warnings.push(`Rollen-Reihenfolge konnte nicht gesetzt werden: ${err.message}`);
  }

  // Bot erhält die 🤖 Bots-Rolle
  const botsRole = guild.roles.cache.get(g.roles.bots);
  if (botsRole && !me.roles.cache.has(botsRole.id) && botsRole.position < me.roles.highest.position) {
    await me.roles.add(botsRole, 'HugoSMP Market Setup').catch((err) => result.warnings.push(`Bots-Rolle: ${err.message}`));
  }

  // ---- Kategorien & Channels --------------------------------------------
  const ctx = { guild, me, roleIds: g.roles };
  const overwritesFor = (spec, label) => {
    const { overwrites, unresolved } = resolveOverwrites(spec, ctx);
    if (unresolved.length) result.warnings.push(`${label}: Rollen fehlen für Rechte (${unresolved.join(', ')}).`);
    return overwrites;
  };

  for (const cat of CATEGORIES) {
    let category;
    try {
      category = findChannel(guild, g.categories[cat.key], cat.name, ChannelType.GuildCategory, null);
      const overwrites = overwritesFor(cat.permissions, cat.name);
      if (!category) {
        category = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: 'HugoSMP Market Setup' });
        result.created.push(`Kategorie ${cat.name}`);
      } else if (syncPermissions) {
        await category.permissionOverwrites.set(overwrites, 'HugoSMP Market Setup (Sync)');
        result.updated.push(`Kategorie ${cat.name}`);
      } else {
        result.existing.push(`Kategorie ${cat.name}`);
      }
      g.categories[cat.key] = category.id;
    } catch (err) {
      result.errors.push(`Kategorie ${cat.name}: ${err.message}`);
      continue;
    }

    for (const def of cat.channels) {
      try {
        let ch = findChannel(guild, g.channels[def.key], def.name, def.type, category.id);
        const overwrites = overwritesFor(def.permissions, def.name);
        if (!ch) {
          ch = await guild.channels.create({
            name: def.name,
            type: def.type,
            parent: category.id,
            topic: def.type === ChannelType.GuildText ? def.topic : undefined,
            rateLimitPerUser: def.rateLimitPerUser,
            permissionOverwrites: overwrites,
            reason: 'HugoSMP Market Setup',
          });
          result.created.push(`#${def.name}`);
        } else if (syncPermissions) {
          await ch.permissionOverwrites.set(overwrites, 'HugoSMP Market Setup (Sync)');
          if (def.type === ChannelType.GuildText && !ch.topic && def.topic) await ch.setTopic(def.topic);
          result.updated.push(`#${def.name}`);
        } else {
          result.existing.push(`#${def.name}`);
        }
        g.channels[def.key] = ch.id;
      } catch (err) {
        result.errors.push(`#${def.name}: ${err.message}`);
      }
    }
    store.save();
  }

  g.setupCompletedAt = new Date().toISOString();
  store.flush();
  logger?.info(`Setup in ${guild.name}: ${result.created.length} erstellt, ${result.updated.length} aktualisiert, ${result.errors.length} Fehler.`);
  return result;
}

module.exports = { planSetup, runSetup, resolveOverwrites, missingBotPermissions };

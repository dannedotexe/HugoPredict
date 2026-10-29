'use strict';

const { ChannelType, OverwriteType, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { ROLES, CATEGORIES, ARCHIVE_CATEGORY, REQUIRED_BOT_PERMISSIONS, NICKNAME_LOCKED_ROLES } = require('../config/serverLayout');
const { LEGACY_CATEGORIES, LEGACY_ROLES } = require('../config/legacyLayout');
const { emojis } = require('../lib/emojis');
const fs = require('node:fs');

const permNames = (bits) => new PermissionsBitField(bits).toArray();
const REASON = 'HugoPredict-Einrichtung';

function missingBotPermissions(me) {
  return REQUIRED_BOT_PERMISSIONS.filter((p) => !me.permissions.has(p));
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

const legacyCategory = (key) => LEGACY_CATEGORIES.find((c) => c.key === key);
const legacyChannel = (key) => LEGACY_CATEGORIES.flatMap((c) => c.channels).find(([k]) => k === key);

/**
 * Ordnet jedem Element des neuen Layouts ein bestehendes Discord-Objekt zu.
 * Reihenfolge: gespeicherte ID → aktueller Name → gespeicherte ID eines
 * Vorgänger-Schlüssels → Name eines Vorgängers. Jedes Objekt wird höchstens
 * einmal zugeordnet, damit nie zwei Einträge denselben Channel belegen.
 * Verändert nichts.
 */
function buildPlan(guild, store) {
  const g = store.guild(guild.id);
  const used = new Set();
  const take = (obj) => {
    if (!obj || used.has(obj.id)) return null;
    used.add(obj.id);
    return obj;
  };
  const byId = (cache, id, pred = () => true) => (id && cache.get(id) && pred(cache.get(id)) ? cache.get(id) : null);
  const byName = (cache, name, pred = () => true) => cache.find((x) => !used.has(x.id) && pred(x) && x.name.toLowerCase() === name.toLowerCase()) ?? null;

  const plan = { roles: [], categories: [], channels: [], obsolete: [] };

  // Rollen
  for (const def of ROLES) {
    const roleCache = guild.roles.cache;
    const notManaged = (r) => !r.managed;
    let role = take(byId(roleCache, g.roles[def.key], notManaged)) ?? take(byName(roleCache, def.name, notManaged));
    let from = null;
    if (!role) {
      for (const legacyName of def.legacyNames ?? []) {
        role = take(byName(roleCache, legacyName, notManaged));
        if (role) break;
      }
    }
    if (role && role.name !== def.name) from = role.name;
    plan.roles.push({ def, role, action: !role ? 'create' : from ? 'rename' : 'ok', from });
  }

  // Kategorien und Channels
  const chCache = guild.channels.cache;
  for (const cat of CATEGORIES) {
    const isCat = (c) => c.type === ChannelType.GuildCategory;
    let category = take(byId(chCache, g.categories[cat.key], isCat)) ?? take(byName(chCache, cat.name, isCat));
    for (const lk of cat.legacy ?? []) {
      if (category) break;
      category = take(byId(chCache, g.categories[lk], isCat)) ?? take(byName(chCache, legacyCategory(lk)?.name ?? '\0', isCat));
    }
    const catFrom = category && category.name !== cat.name ? category.name : null;
    plan.categories.push({ def: cat, channel: category, action: !category ? 'create' : catFrom ? 'rename' : 'ok', from: catFrom });

    for (const def of cat.channels) {
      const sameType = (c) => c.type === def.type;
      let ch = take(byId(chCache, g.channels[def.key], sameType)) ?? take(byName(chCache, def.name, sameType));
      for (const lk of def.legacy ?? []) {
        if (ch) break;
        ch = take(byId(chCache, g.channels[lk], sameType)) ?? take(byName(chCache, legacyChannel(lk)?.[1] ?? '\0', sameType));
      }
      const renamed = ch && ch.name !== def.name;
      const moved = ch && category && ch.parentId !== category.id;
      plan.channels.push({
        def, category: cat, channel: ch,
        action: !ch ? 'create' : renamed || moved ? 'migrate' : 'ok',
        from: ch && (renamed || moved) ? ch.name : null,
      });
    }
  }

  // Veraltete Objekte der früheren Struktur (werden nur gemeldet bzw. archiviert)
  for (const lc of LEGACY_CATEGORIES) {
    for (const [key, name, type] of lc.channels) {
      const ch = byId(chCache, g.channels[key], (c) => c.type === type) ?? byName(chCache, name, (c) => c.type === type);
      if (ch && !used.has(ch.id)) {
        used.add(ch.id);
        plan.obsolete.push({ kind: 'channel', key, id: ch.id, name: ch.name, object: ch });
      }
    }
    const isCat = (c) => c.type === ChannelType.GuildCategory;
    const cat = byId(chCache, g.categories[lc.key], isCat) ?? byName(chCache, lc.name, isCat);
    if (cat && !used.has(cat.id)) {
      used.add(cat.id);
      plan.obsolete.push({ kind: 'category', key: lc.key, id: cat.id, name: cat.name, object: cat });
    }
  }
  for (const [key, name] of LEGACY_ROLES) {
    const role = byId(guild.roles.cache, g.roles[key]) ?? byName(guild.roles.cache, name);
    if (role && !used.has(role.id) && !role.managed) {
      used.add(role.id);
      plan.obsolete.push({ kind: 'role', key, id: role.id, name: role.name, object: role });
    }
  }
  return plan;
}

/** Vorschau für die Bestätigung – verändert nichts. */
function planSetup(guild, store) {
  const plan = buildPlan(guild, store);
  const count = (list, action) => list.filter((x) => x.action === action).length;
  return {
    rolesNew: count(plan.roles, 'create'),
    rolesRenamed: plan.roles.filter((x) => x.action === 'rename').map((x) => `${x.from} → ${x.def.name}`),
    categoriesNew: count(plan.categories, 'create'),
    categoriesRenamed: plan.categories.filter((x) => x.action === 'rename').map((x) => `${x.from} → ${x.def.name}`),
    channelsNew: plan.channels.filter((x) => x.action === 'create').map((x) => `#${x.def.name}`),
    channelsMigrated: plan.channels.filter((x) => x.action === 'migrate').map((x) => `#${x.from} → #${x.def.name}`),
    unchanged: count(plan.roles, 'ok') + count(plan.categories, 'ok') + count(plan.channels, 'ok'),
    obsolete: plan.obsolete.map((o) => `${o.kind === 'role' ? '@' : o.kind === 'category' ? '' : '#'}${o.name}`),
    obsoleteChannels: plan.obsolete.filter((o) => o.kind === 'channel').length,
    missingPermissions: permNames(missingBotPermissions(guild.members.me)),
  };
}

/**
 * Richtet Rollen, Kategorien und Channels ein bzw. migriert die frühere
 * Struktur. Idempotent. Gelöscht wird nichts: Veraltetes wird gemeldet und
 * nur mit archiveObsolete in die versteckte Kategorie „ARCHIV“ verschoben.
 */
async function runSetup(guild, store, { syncPermissions = false, archiveObsolete = false, logger } = {}) {
  const result = { created: [], updated: [], existing: [], warnings: [], errors: [], obsolete: [], archived: [] };
  const g = store.guild(guild.id);
  const me = guild.members.me ?? (await guild.members.fetchMe());

  const missing = missingBotPermissions(me);
  if (missing.length) {
    result.errors.push(`Dem Bot fehlen Berechtigungen: ${permNames(missing).join(', ')}. Bitte in den Servereinstellungen ergänzen.`);
    return result;
  }

  await guild.roles.fetch();
  await guild.channels.fetch();
  const plan = buildPlan(guild, store);
  const botIsAdmin = me.permissions.has(PermissionFlagsBits.Administrator);

  // ---- Rollen ------------------------------------------------------------
  for (const { def, role: found, action, from } of plan.roles) {
    const desired = def.permissions.reduce((a, p) => a | p, 0n);
    const grantable = botIsAdmin ? desired : desired & me.permissions.bitfield;
    const notGrantable = desired & ~grantable;
    const props = { name: def.name, color: def.color, hoist: def.hoist, mentionable: def.mentionable, permissions: grantable };
    try {
      let role = found;
      if (action === 'create') {
        role = await guild.roles.create({ ...props, reason: REASON });
        result.created.push(`Rolle ${def.name}`);
      } else if (role.position >= me.roles.highest.position) {
        result.existing.push(`Rolle ${role.name}`);
        if (action === 'rename' || syncPermissions) {
          result.warnings.push(`Rolle „${role.name}“ liegt über der Bot-Rolle und konnte nicht angepasst werden.`);
        }
      } else if (action === 'rename' || syncPermissions) {
        await role.edit({ ...props, reason: `${REASON} (Migration)` });
        result.updated.push(action === 'rename' ? `Rolle ${from} → ${def.name}` : `Rolle ${def.name}`);
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

  // Rollen-Reihenfolge (nur unterhalb der Bot-Rolle möglich)
  try {
    const top = me.roles.highest.position;
    const manageable = ROLES.map((r) => guild.roles.cache.get(g.roles[r.key])).filter((r) => r && !r.managed && r.position < top);
    const ordered = manageable.every((r, i) => i === 0 || manageable[i - 1].position > r.position);
    if (!ordered && manageable.length) {
      await guild.roles.setPositions(manageable.map((role, i) => ({ role: role.id, position: Math.max(1, top - 1 - i) })));
      result.updated.push('Rollen-Reihenfolge');
    }
    if (manageable.length < ROLES.length) result.warnings.push('Nicht alle Rollen liegen unter der Bot-Rolle – deren Position wurde nicht verändert.');
  } catch (err) {
    result.warnings.push(`Rollen-Reihenfolge konnte nicht gesetzt werden: ${err.message}`);
  }

  // Rollen-Icons (nur mit Server-Boost Stufe 2; vorhandene Icons bleiben unangetastet)
  if (guild.features?.includes('ROLE_ICONS')) {
    for (const def of ROLES) {
      const role = guild.roles.cache.get(g.roles[def.key]);
      const file = def.icon && emojis.filePath(def.icon);
      if (!role || role.icon || !file || !fs.existsSync(file) || role.position >= me.roles.highest.position) continue;
      try {
        await role.setIcon(fs.readFileSync(file), REASON);
        result.updated.push(`Rollen-Icon ${def.name}`);
      } catch (err) {
        result.warnings.push(`Rollen-Icon ${def.name}: ${err.message}`);
      }
    }
  }

  const botRole = guild.roles.cache.get(g.roles.bots);
  if (botRole && !me.roles.cache.has(botRole.id) && botRole.position < me.roles.highest.position) {
    await me.roles.add(botRole, REASON).catch((err) => result.warnings.push(`Bot-Rolle: ${err.message}`));
  }

  // ---- Kategorien & Channels --------------------------------------------
  const ctx = { guild, me, roleIds: g.roles };
  const overwritesFor = (spec, label) => {
    const { overwrites, unresolved } = resolveOverwrites(spec, ctx);
    if (unresolved.length) result.warnings.push(`${label}: Rollen fehlen für Rechte (${unresolved.join(', ')}).`);
    return overwrites;
  };

  const categoryIds = {};
  for (const { def, channel: found, action, from } of plan.categories) {
    try {
      const overwrites = overwritesFor(def.permissions, def.name);
      let category = found;
      if (action === 'create') {
        category = await guild.channels.create({ name: def.name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: REASON });
        result.created.push(`Kategorie ${def.name}`);
      } else if (action === 'rename' || syncPermissions) {
        await category.edit({ name: def.name, permissionOverwrites: overwrites, reason: `${REASON} (Migration)` });
        result.updated.push(action === 'rename' ? `Kategorie ${from} → ${def.name}` : `Kategorie ${def.name}`);
      } else {
        result.existing.push(`Kategorie ${def.name}`);
      }
      g.categories[def.key] = category.id;
      for (const lk of def.legacy ?? []) if (lk !== def.key) delete g.categories[lk];
      categoryIds[def.key] = category.id;
    } catch (err) {
      result.errors.push(`Kategorie ${def.name}: ${err.message}`);
    }
  }

  for (const { def, category, channel: found, action, from } of plan.channels) {
    const parent = categoryIds[category.key];
    if (!parent) continue;
    try {
      const overwrites = overwritesFor(def.permissions, def.name);
      let ch = found;
      if (action === 'create') {
        ch = await guild.channels.create({
          name: def.name, type: def.type, parent, topic: def.topic, rateLimitPerUser: def.rateLimitPerUser,
          permissionOverwrites: overwrites, reason: REASON,
        });
        result.created.push(`#${def.name}`);
      } else if (action === 'migrate' || syncPermissions) {
        // Umbenennen, verschieben und Rechte setzen – Nachrichten bleiben erhalten.
        await ch.edit({
          name: def.name, parent, lockPermissions: false, topic: def.topic,
          rateLimitPerUser: def.rateLimitPerUser ?? 0, permissionOverwrites: overwrites, reason: `${REASON} (Migration)`,
        });
        result.updated.push(action === 'migrate' ? `#${from} → #${def.name}` : `#${def.name}`);
      } else {
        result.existing.push(`#${def.name}`);
      }
      g.channels[def.key] = ch.id;
      for (const lk of def.legacy ?? []) if (lk !== def.key) delete g.channels[lk];
    } catch (err) {
      result.errors.push(`#${def.name}: ${err.message}`);
    }
  }
  store.save();

  // Reihenfolge: neue Kategorien oben, Channels in Layout-Reihenfolge
  try {
    const positions = [];
    CATEGORIES.forEach((cat, i) => {
      if (categoryIds[cat.key]) positions.push({ channel: categoryIds[cat.key], position: i });
      cat.channels.forEach((def, j) => {
        if (g.channels[def.key]) positions.push({ channel: g.channels[def.key], position: j });
      });
    });
    if (positions.length) await guild.channels.setPositions(positions);
  } catch (err) {
    result.warnings.push(`Reihenfolge der Channels konnte nicht gesetzt werden: ${err.message}`);
  }

  // ---- Veraltete Struktur ------------------------------------------------
  let archiveId = null;
  for (const o of plan.obsolete) {
    const label = o.kind === 'role' ? `Rolle ${o.name}` : o.kind === 'category' ? `Kategorie ${o.name}` : `#${o.name}`;
    if (!archiveObsolete || o.kind !== 'channel') {
      result.obsolete.push(label);
      continue;
    }
    try {
      if (!archiveId) {
        const existing = guild.channels.cache.get(g.categories.archive)
          ?? guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === ARCHIVE_CATEGORY.name);
        const overwrites = overwritesFor(ARCHIVE_CATEGORY.permissions, ARCHIVE_CATEGORY.name);
        const archive = existing ?? (await guild.channels.create({ name: ARCHIVE_CATEGORY.name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: REASON }));
        if (!existing) result.created.push(`Kategorie ${ARCHIVE_CATEGORY.name}`);
        archiveId = archive.id;
        g.categories.archive = archive.id;
      }
      await o.object.edit({
        parent: archiveId,
        lockPermissions: false,
        permissionOverwrites: overwritesFor(ARCHIVE_CATEGORY.permissions, o.name),
        reason: `${REASON} (archiviert)`,
      });
      result.archived.push(label);
    } catch (err) {
      result.errors.push(`Archivieren von ${label}: ${err.message}`);
    }
  }

  g.setupCompletedAt = new Date().toISOString();
  g.layoutVersion = 2;
  store.flush();
  logger?.info(`Setup in ${guild.name}: ${result.created.length} erstellt, ${result.updated.length} aktualisiert, ${result.archived.length} archiviert, ${result.errors.length} Fehler.`);
  return result;
}

/**
 * Legt ausschließlich FEHLENDE Channels des Layouts an (z. B. nach einer
 * Erweiterung). Bestehende Channels, Kategorien und Rollen bleiben unverändert.
 */
async function ensureMissingChannels(guild, store) {
  const g = store.guild(guild.id);
  const me = guild.members.me;
  const created = [];
  const errors = [];
  const plan = buildPlan(guild, store);
  for (const { def, category, action } of plan.channels) {
    if (action !== 'create') continue;
    const parent = g.categories[category.key] && guild.channels.cache.get(g.categories[category.key]);
    if (!parent) continue;
    try {
      const { overwrites } = resolveOverwrites(def.permissions, { guild, me, roleIds: g.roles });
      const ch = await guild.channels.create({
        name: def.name, type: def.type, parent: parent.id, topic: def.topic,
        rateLimitPerUser: def.rateLimitPerUser, permissionOverwrites: overwrites, reason: REASON,
      });
      // An die Layout-Position innerhalb der Kategorie setzen
      await ch.setPosition(category.channels.findIndex((c) => c.key === def.key)).catch(() => {});
      g.channels[def.key] = ch.id;
      created.push(`#${def.name}`);
    } catch (err) {
      errors.push(`#${def.name}: ${err.message}`);
    }
  }
  if (created.length) store.save();
  return { created, errors };
}

/**
 * Legt ausschließlich FEHLENDE Rollen des Layouts an (z. B. neue
 * Benachrichtigungs-Rollen). Bestehende Rollen bleiben unverändert.
 */
async function ensureMissingRoles(guild, store) {
  const g = store.guild(guild.id);
  const created = [];
  const errors = [];
  for (const { def, action } of buildPlan(guild, store).roles) {
    // Optionale Rollen (Entwickler, Moderator, Bot) werden nicht neu angelegt,
    // wenn sie auf dem Server bewusst entfernt wurden.
    if (action !== 'create' || def.optional) continue;
    try {
      const role = await guild.roles.create({
        name: def.name, color: def.color, hoist: def.hoist, mentionable: def.mentionable, permissions: [], reason: REASON,
      });
      g.roles[def.key] = role.id;
      created.push(def.name);
    } catch (err) {
      errors.push(`Rolle ${def.name}: ${err.message}`);
    }
  }
  if (created.length) store.save();
  return { created, errors };
}

/**
 * Benennt Layout-Channels mit einem früheren Namen (previousNames) um.
 * Ändert ausschließlich den Namen – keine Rechte, Kategorien oder Nachrichten.
 */
async function syncChannelNames(guild, store) {
  const g = store.guild(guild.id);
  const renamed = [];
  const warnings = [];
  for (const def of CATEGORIES.flatMap((c) => c.channels)) {
    const ch = guild.channels.cache.get(g.channels[def.key]);
    if (!ch || ch.name === def.name || !(def.previousNames ?? []).includes(ch.name)) continue;
    const from = ch.name;
    try {
      await ch.setName(def.name, REASON);
      renamed.push(`#${from} → #${def.name}`);
    } catch (err) {
      warnings.push(`#${from}: ${err.message}`);
    }
  }
  return { renamed, warnings };
}

/**
 * Benennt Rollen mit einem früheren Namen (legacyNames) in den aktuellen Namen um.
 * Ändert ausschließlich den Namen – keine Rechte, Farben oder Mitglieder.
 */
async function syncRoleNames(guild, store) {
  const g = store.guild(guild.id);
  const me = guild.members.me;
  const renamed = [];
  const warnings = [];
  for (const def of ROLES) {
    const role = guild.roles.cache.get(g.roles[def.key]);
    if (!role || role.name === def.name || !(def.legacyNames ?? []).includes(role.name)) continue;
    if (role.position >= me.roles.highest.position) {
      warnings.push(`Rolle „${role.name}“ liegt über der Bot-Rolle und wurde nicht umbenannt.`);
      continue;
    }
    const from = role.name;
    try {
      await role.setName(def.name, REASON);
      renamed.push(`${from} → ${def.name}`);
    } catch (err) {
      warnings.push(`Rolle „${from}“: ${err.message}`);
    }
  }
  return { renamed, warnings };
}

/**
 * Entzieht @everyone und den Community-Rollen das Recht „Nickname ändern“.
 * Teamrollen behalten ihre Rechte; Moderatoren können Namen weiterhin ändern.
 */
async function lockNicknames(guild, store) {
  const g = store.guild(guild.id);
  const me = guild.members.me;
  const changed = [];
  const warnings = [];
  const targets = [guild.roles.everyone, ...NICKNAME_LOCKED_ROLES.map((k) => guild.roles.cache.get(g.roles[k]))];
  for (const role of targets) {
    if (!role?.permissions.has(PermissionFlagsBits.ChangeNickname, false)) continue;
    if (role.id !== guild.roles.everyone.id && role.position >= me.roles.highest.position) {
      warnings.push(`Rolle „${role.name}“ liegt über der Bot-Rolle – „Nickname ändern“ bitte manuell entfernen.`);
      continue;
    }
    try {
      await role.setPermissions(role.permissions.remove(PermissionFlagsBits.ChangeNickname), REASON);
      changed.push(role.name);
    } catch (err) {
      warnings.push(`Rolle „${role.name}“: ${err.message}`);
    }
  }
  return { changed, warnings };
}

module.exports = { planSetup, runSetup, buildPlan, resolveOverwrites, missingBotPermissions, syncRoleNames, syncChannelNames, ensureMissingChannels, ensureMissingRoles, lockNicknames };

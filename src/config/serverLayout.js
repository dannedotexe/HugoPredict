'use strict';

const { ChannelType, PermissionFlagsBits: P } = require('discord.js');

/*
 * Zentrale, deklarative Beschreibung der Serverstruktur.
 * Das Setup (src/setup/setupServer.js) liest ausschließlich diese Datei.
 * Schlüssel (key) sind stabil und werden im Store auf Discord-IDs abgebildet.
 * `legacy` nennt Schlüssel der früheren Struktur: Solche Channels/Kategorien
 * werden beim Setup umbenannt und verschoben statt neu angelegt.
 */

// ---------------------------------------------------------------------------
// Rollen – Reihenfolge = Hierarchie (oben = höchste Rolle)
// ---------------------------------------------------------------------------

const ROLES = [
  {
    key: 'owner',
    name: 'Inhaber',
    legacyNames: ['👑 Owner'],
    color: 0x10b981,
    hoist: true,
    mentionable: false,
    // Bewusst OHNE Administrator: Dieses Recht ist ausschließlich der Rolle
    // „Administrator“ vorbehalten. Der Server-Eigentümer hat ohnehin alle Rechte.
    permissions: [
      P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageWebhooks, P.ManageGuildExpressions,
      P.ManageEvents, P.ViewAuditLog, P.ViewGuildInsights, P.KickMembers, P.BanMembers,
      P.ModerateMembers, P.ManageMessages, P.ManageThreads, P.ManageNicknames, P.MentionEveryone,
    ],
  },
  { key: 'admin', name: 'Administrator', legacyNames: ['🛡️ Administrator'], color: 0x0f9f74, hoist: true, mentionable: false, permissions: [P.Administrator] },
  {
    key: 'developer',
    name: 'Entwickler',
    legacyNames: ['🛠️ Developer'],
    color: 0x64748b,
    hoist: true,
    mentionable: false,
    // Technische Rechte, aber kein Zugriff auf das Prüfprotokoll.
    permissions: [P.ManageWebhooks, P.ViewAuditLog],
  },
  {
    key: 'marketMod',
    name: 'Marktverwaltung',
    legacyNames: ['⚖️ Market Moderator'],
    color: 0x34d399,
    hoist: true,
    mentionable: true,
    // Verwaltung der Marktübersicht über Channel-Rechte, keine Guthaben-Funktionen.
    permissions: [],
  },
  {
    key: 'moderator',
    name: 'Moderator',
    legacyNames: ['🔨 Moderator'],
    color: 0x94a3b8,
    hoist: true,
    mentionable: true,
    permissions: [P.KickMembers, P.ModerateMembers, P.ManageMessages, P.ManageThreads, P.ManageNicknames, P.ViewAuditLog],
  },
  { key: 'support', name: 'Kundenservice', legacyNames: ['🎫 Support'], color: 0x6ee7b7, hoist: true, mentionable: true, permissions: [] },
  { key: 'verified', name: 'Verifiziert', legacyNames: ['⛏️ Verified'], color: 0xa7b4c2, hoist: false, mentionable: false, permissions: [] },
  { key: 'member', name: 'Mitglied', legacyNames: ['👤 Member'], color: 0x6b7280, hoist: false, mentionable: false, permissions: [] },
  {
    key: 'bots',
    name: 'Bot',
    legacyNames: ['🤖 Bots'],
    color: 0x4b5563,
    hoist: false,
    mentionable: false,
    permissions: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory],
  },
];

// Rollengruppen
const STAFF = ['owner', 'admin', 'developer', 'marketMod', 'moderator', 'support'];
const LEADERSHIP = ['owner', 'admin'];
const MEMBER_TIER = ['member', 'verified'];

// Rollen, die privilegierte Bot-Aktionen ausführen dürfen
const PRIVILEGES = {
  setup: ['owner', 'admin'],
  announce: ['owner', 'admin'],
  marketDecision: ['owner', 'admin', 'marketMod'],
  ticketStaff: ['owner', 'admin', 'moderator', 'support'],
};

// Rollen, die der Bot selbst vergeben darf (alle anderen vergeben nur Menschen)
const SELF_ASSIGNABLE_VIA_BOT = ['member', 'verified'];

// ---------------------------------------------------------------------------
// Berechtigungs-Bausteine
// ---------------------------------------------------------------------------

const READ = [P.ViewChannel, P.ReadMessageHistory];
const WRITE = [P.SendMessages, P.SendMessagesInThreads, P.AddReactions, P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis];
const NO_WRITE = [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads, P.AddReactions];
// Rechte, die der Bot in jedem seiner Channels braucht (als Member-Overwrite)
const BOT_TEXT = [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ManageMessages, P.AddReactions];

function ow(target, allow = [], deny = []) {
  return { target, allow, deny };
}
const each = (keys, allow, deny) => keys.map((k) => ow(k, allow, deny));

const profiles = {
  /** Für alle sichtbar, nur lesen. Schreiben dürfen nur `writers`. */
  publicRead: ({ writers = LEADERSHIP, managers = [] } = {}) => [
    ow('everyone', READ, NO_WRITE),
    ...each(managers, [...READ, P.ManageMessages]),
    ...each(writers, [...READ, ...WRITE]),
    ow('bot', BOT_TEXT),
  ],
  /** Ab „Mitglied“ sichtbar und beschreibbar. */
  memberChat: () => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(MEMBER_TIER, [...READ, ...WRITE, P.CreatePublicThreads]),
    ...each(STAFF, [...READ, ...WRITE]),
    ow('bot', BOT_TEXT),
  ],
  /** Interner Channel: nur die angegebenen Rollen. */
  staff: (roles, { readOnly = false } = {}) => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(roles, readOnly ? READ : [...READ, ...WRITE], readOnly ? NO_WRITE : []),
    ow('bot', BOT_TEXT),
  ],
  /** Archiv für veraltete Channels: nur Leitung, nur lesen. */
  archive: () => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(LEADERSHIP, READ, NO_WRITE),
    ow('bot', [...BOT_TEXT, P.ManageChannels]),
  ],
};

// ---------------------------------------------------------------------------
// Kategorien & Channels
// ---------------------------------------------------------------------------

const T = ChannelType.GuildText;

const CATEGORIES = [
  {
    key: 'info',
    name: 'INFORMATIONEN',
    legacy: ['startHere'],
    permissions: profiles.publicRead(),
    channels: [
      {
        key: 'announcements', name: 'ankündigungen', type: T, legacy: ['announcements'],
        topic: 'Offizielle Mitteilungen des HugoPredict-Teams.',
        permissions: profiles.publicRead(),
      },
      {
        key: 'marketOverview', name: 'marktübersicht', type: T, legacy: ['liveMarkets'],
        topic: 'Neue, pausierte und entschiedene Märkte. Wird automatisch aktualisiert.',
        permissions: profiles.publicRead({ managers: ['marketMod'] }),
      },
      {
        key: 'docs', name: 'dokumentation', type: T, legacy: ['welcome'],
        topic: 'Plattform, virtuelle HC, Gebühren und Marktregeln.',
        permissions: profiles.publicRead(),
      },
    ],
  },
  {
    key: 'community',
    name: 'COMMUNITY',
    legacy: ['community'],
    permissions: profiles.memberChat(),
    channels: [
      { key: 'discussions', name: 'diskussionen', type: T, legacy: ['general'], topic: 'Sachlicher Austausch rund um Plattform und Märkte.', permissions: profiles.memberChat() },
      { key: 'analyses', name: 'marktanalysen', type: T, legacy: ['analyses'], topic: 'Fundierte Analysen zu einzelnen Märkten. Keine Anlageberatung.', permissions: profiles.memberChat(), rateLimitPerUser: 30 },
    ],
  },
  {
    key: 'service',
    name: 'KUNDENSERVICE',
    legacy: ['support'],
    permissions: profiles.publicRead({ writers: [...LEADERSHIP, 'support'] }),
    channels: [
      { key: 'support', name: 'support', type: T, legacy: ['ticketCreate'], topic: 'Private Anfragen an den Kundenservice. Tickets sind nur für dich und das Team sichtbar.', permissions: profiles.publicRead() },
    ],
  },
  {
    key: 'internal',
    name: 'INTERN · PRIVAT',
    legacy: ['team'],
    permissions: profiles.staff(STAFF),
    channels: [
      { key: 'operations', name: 'betrieb', type: T, legacy: ['marketDecisions'], topic: 'Marktbetrieb: Vorschläge prüfen und Entscheidungen vorbereiten.', permissions: profiles.staff(['marketMod', ...LEADERSHIP]) },
      { key: 'audit', name: 'prüfprotokoll', type: T, legacy: ['modLogs'], topic: 'Administrative Eingriffe, Transaktionen und Sicherheitsereignisse.', permissions: profiles.staff(LEADERSHIP, { readOnly: true }) },
      { key: 'system', name: 'systemmeldungen', type: T, legacy: ['botLogs'], topic: 'Systemstatus und technische Meldungen.', permissions: profiles.staff(['developer', ...LEADERSHIP], { readOnly: true }) },
      { key: 'moderation', name: 'moderation', type: T, legacy: ['ticketLogs'], topic: 'Moderation und Ticket-Protokolle.', permissions: profiles.staff(['moderator', 'support', ...LEADERSHIP]) },
      { key: 'team', name: 'team', type: T, legacy: ['teamChat'], topic: 'Internes Team.', permissions: profiles.staff(STAFF) },
    ],
  },
];

// Archiv (wird nur auf ausdrücklichen Wunsch beim Setup angelegt)
const ARCHIVE_CATEGORY = { key: 'archive', name: 'ARCHIV', permissions: profiles.archive() };

// Welche Protokolle landen in welchem Channel
const LOG_ROUTES = {
  system: 'system', // Fehler, API-Störungen
  audit: 'audit', // Setup, Panels, Ankündigungen, Daily, Verifizierung, verweigerte Zugriffe
  tickets: 'moderation', // Ticket-Eröffnung, -Übernahme, -Abschluss mit Transkript
  operations: 'operations', // Marktvorschläge und Entscheidungen
};

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

const TICKET_TYPES = [
  { key: 'general', label: 'Allgemeine Anfrage', description: 'Fragen zur Plattform oder zu deinem Konto', roles: ['support', 'moderator'] },
  { key: 'balance', label: 'Guthaben und Transaktionen', description: 'Abweichungen bei Guthaben, Trades oder Gutschriften', roles: ['support', 'admin'] },
  { key: 'bug', label: 'Technisches Problem', description: 'Fehler auf der Website oder im Bot', roles: ['support', 'developer'] },
  { key: 'fraud', label: 'Meldung oder Betrugsverdacht', description: 'Vertrauliche Meldung von Regelverstößen', roles: ['moderator', 'admin'] },
  { key: 'other', label: 'Sonstiges', description: 'Alle weiteren Anliegen', roles: ['support'] },
];

// Rechte, die der Bot für /setup-server mindestens benötigt. Discord erlaubt
// in Overwrites nur Rechte, die der Bot selbst besitzt.
const REQUIRED_BOT_PERMISSIONS = [
  P.ManageRoles, P.ManageChannels, P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles,
  P.ReadMessageHistory, P.ManageMessages, P.AddReactions, P.UseExternalEmojis, P.SendMessagesInThreads,
  P.CreatePublicThreads, P.CreatePrivateThreads,
];

function allChannels() {
  return CATEGORIES.flatMap((c) => c.channels.map((ch) => ({ ...ch, category: c.key })));
}

module.exports = {
  ROLES,
  CATEGORIES,
  ARCHIVE_CATEGORY,
  STAFF,
  LEADERSHIP,
  MEMBER_TIER,
  PRIVILEGES,
  SELF_ASSIGNABLE_VIA_BOT,
  TICKET_TYPES,
  LOG_ROUTES,
  REQUIRED_BOT_PERMISSIONS,
  BOT_TEXT,
  allChannels,
};

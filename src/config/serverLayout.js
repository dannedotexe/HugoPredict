'use strict';

const { ChannelType, ForumLayoutType, SortOrderType, PermissionFlagsBits: P } = require('discord.js');

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
    name: '| Inhaber',
    description: 'Vollzugriff auf Server, Bot und Plattform',
    icon: 'owner',
    legacyNames: ['👑 Owner', 'Inhaber'],
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
  { key: 'admin', name: '| Administrator', description: 'Serververwaltung, Benutzer und Moderation', icon: 'admin', legacyNames: ['🛡️ Administrator', 'Administrator'], color: 0x0f9f74, hoist: true, mentionable: false, permissions: [P.Administrator] },
  {
    key: 'developer',
    name: '| Entwickler',
    description: 'Technik, Bot, Website und Systemwartung',
    icon: 'developer',
    legacyNames: ['🛠️ Developer', 'Entwickler'],
    optional: true,
    color: 0x64748b,
    hoist: true,
    mentionable: false,
    // Technische Rechte, aber kein Zugriff auf das Prüfprotokoll.
    permissions: [P.ManageWebhooks, P.ViewAuditLog],
  },
  {
    key: 'marketMod',
    name: '| Prognoseverwaltung',
    description: 'Prognosen prüfen, verwalten und Ergebnisse bearbeiten',
    icon: 'marketmod',
    legacyNames: ['⚖️ Market Moderator', 'Marktverwaltung', 'Prognoseverwaltung'],
    color: 0x34d399,
    hoist: true,
    mentionable: true,
    // Verwaltung der Prognosen über Channel-Rechte, keine Guthaben-Funktionen.
    permissions: [],
  },
  {
    key: 'moderator',
    name: '| Moderator',
    description: 'Regeln durchsetzen und Diskussionen moderieren',
    icon: 'moderator',
    legacyNames: ['🔨 Moderator', 'Moderator'],
    optional: true,
    color: 0x94a3b8,
    hoist: true,
    mentionable: true,
    permissions: [P.KickMembers, P.ModerateMembers, P.ManageMessages, P.ManageThreads, P.ManageNicknames, P.ViewAuditLog],
  },
  { key: 'support', name: '| Supporter', description: 'Tickets bearbeiten und Nutzern helfen', icon: 'support', legacyNames: ['🎫 Support', 'Kundenservice', 'Support'], color: 0x6ee7b7, hoist: true, mentionable: true, permissions: [] },
  { key: 'verified', name: '| Verifiziert', description: 'Minecraft-Konto erfolgreich verknüpft', icon: 'verified', legacyNames: ['⛏️ Verified', 'Verifiziert'], color: 0xa7b4c2, hoist: false, mentionable: false, permissions: [] },
  { key: 'member', name: '| Mitglied', description: 'Standardrolle für Community-Mitglieder', icon: 'member', legacyNames: ['👤 Member', 'Mitglied'], color: 0x6b7280, hoist: false, mentionable: false, permissions: [] },
  // Benachrichtigungs-Rollen: freiwillig per Button in #regeln, nur der Bot pingt sie.
  { key: 'notifyMarkets', name: 'ping:Neue Prognosen', legacyNames: ['Neue Märkte', 'Neue Prognosen'], description: 'Benachrichtigung bei neuen Prognosen', icon: 'open', notify: true, color: 0x4b5563, hoist: false, mentionable: false, permissions: [] },
  { key: 'notifyNews', name: 'ping:Ankündigungen', legacyNames: ['Ankündigungen'], description: 'Benachrichtigung bei Ankündigungen', icon: 'announce', notify: true, color: 0x4b5563, hoist: false, mentionable: false, permissions: [] },
  // Für andere Bots (z. B. Disboard): wird beim Beitritt automatisch vergeben.
  {
    key: 'otherBots',
    name: '| Bots',
    description: 'Rolle für andere Bots auf dem Server',
    icon: 'bot',
    color: 0x99aab5,
    hoist: true,
    mentionable: false,
    permissions: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.AddReactions, P.UseExternalEmojis],
  },
  {
    key: 'bots',
    name: '| Hugo Predict',
    description: 'Technische Rolle für den Discord-Bot',
    icon: 'bot',
    legacyNames: ['🤖 Bots', 'Bot', 'HugoPredict Bot'],
    optional: true,
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
  moderate: ['owner', 'admin', 'moderator'],
  ban: ['owner', 'admin'],
  applications: ['owner', 'admin'],
};

// Stellen für Team-Bewerbungen (#bewerben). `role` wird bei Annahme vergeben.
const APPLICATION_POSITIONS = [
  { key: 'support', label: 'Supporter', role: 'support', icon: 'support', description: 'Tickets bearbeiten und im Sprach-Support helfen' },
  { key: 'marketMod', label: 'Prognoseverwaltung', role: 'marketMod', icon: 'marketmod', description: 'Prognosen prüfen, anlegen und entscheiden' },
];

// Rollen, die der Bot selbst vergeben darf (alle anderen vergeben nur Menschen)
const SELF_ASSIGNABLE_VIA_BOT = ['member', 'verified', 'notifyMarkets', 'notifyNews'];
// Community-Rollen ohne „Nickname ändern“ (zusätzlich zu @everyone)
const NICKNAME_LOCKED_ROLES = ['member', 'verified', 'notifyMarkets', 'notifyNews'];

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
  /**
   * Sprachkanal ab „Mitglied“. Verbinden und Sprechen kommen aus den
   * Grundrechten von @everyone, hier wird nur die Sichtbarkeit gesteuert.
   */
  memberVoice: () => [
    ow('everyone', [], [P.ViewChannel]),
    ...each([...MEMBER_TIER, ...STAFF], READ),
    ow('bot', BOT_TEXT),
  ],
  /** Support-Warteraum: alle dürfen rein und warten (ohne zu sprechen), das Team verschiebt sie. */
  waitingRoom: () => [
    // Chat im Warteraum nur für das Team, damit die Warteschlange sichtbar bleibt.
    ow('everyone', [P.ViewChannel, P.Connect], [P.Speak, P.Stream, P.SendMessages, P.AddReactions]),
    ...each(PRIVILEGES.ticketStaff, [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.MoveMembers, P.SendMessages, P.AddReactions]),
    ow('bot', BOT_TEXT),
  ],
  /** Support-Raum: selbst betreten kann nur das Team, Nutzer werden hineingezogen. */
  supportRoom: () => [
    ow('everyone', [P.ViewChannel], [P.Connect]),
    ...each(PRIVILEGES.ticketStaff, [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.MoveMembers]),
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

// Höchstzahl Wartender im Support-Warteraum (das Team zählt nicht mit)
const WAITING_ROOM_LIMIT = 5;
const T = ChannelType.GuildText;
const V = ChannelType.GuildVoice;
const F = ChannelType.GuildForum;
// Channel-Namen: Emoji + Strich + Name, z. B. „📜┃regeln“. Frühere Schreibweisen
// (mit Strich ohne Emoji bzw. ganz ohne) werden von /aktualisieren umbenannt.
const SEPARATOR = '┃';
const ICONS = {
  willkommen: '👋', 'so-gehts': '📖', verifizieren: '✅', status: '📶', bewerben: '📝', bewerbungen: '📨', ankündigungen: '📢', prognosen: '📈', regeln: '📜', pings: '🔔',
  diskussionen: '💬', analysen: '📊', medien: '📸', vorschläge: '💡', 'Voice 1': '🔊', 'Voice 2': '🔊', 'Voice 3': '🔊', support: '🎫', 'support-steuerung': '📋', 'support-warteraum': '⏳', 'Support Raum 1': '🛠️', 'Support Raum 2': '🛠️',
  betrieb: '🔧', 'minecraft-panel': '🎮', prüfprotokoll: '🧾', systemmeldungen: '📡', moderation: '🔨', team: '👥',
};
const named = (plain, ...older) => ({
  name: `${ICONS[plain] ?? ''}${SEPARATOR}${plain}`,
  previousNames: [`${SEPARATOR}${plain}`, plain, ...older],
});

const CATEGORIES = [
  {
    key: 'info',
    name: 'INFORMATIONEN',
    legacy: ['startHere'],
    permissions: profiles.publicRead(),
    channels: [
      {
        key: 'greeting', ...named('willkommen'), type: T,
        topic: 'Begrüßung neuer Mitglieder.',
        permissions: profiles.publicRead(),
      },
      {
        key: 'howto', ...named('so-gehts'), type: T,
        topic: 'Was ist HugoPredict und wie funktioniert es? Hier in einer Minute erklärt.',
        permissions: profiles.publicRead(),
      },
      {
        key: 'announcements', ...named('ankündigungen'), type: T, legacy: ['announcements'],
        topic: 'Offizielle Mitteilungen des HugoPredict-Teams.',
        permissions: profiles.publicRead(),
      },
      {
        key: 'marketOverview', ...named('prognosen', '📈┃marktübersicht', '┃marktübersicht', 'marktübersicht'), type: T, legacy: ['liveMarkets'],
        topic: 'Neue, pausierte und entschiedene Prognosen. Wird automatisch aktualisiert.',
        permissions: profiles.publicRead({ managers: ['marketMod'] }),
      },
      {
        key: 'docs', ...named('regeln', 'dokumentation'), type: T, legacy: ['welcome'],
        topic: 'Plattform, Ingame-Geld, Gebühren und Prognoseregeln.',
        permissions: profiles.publicRead(),
      },
      {
        key: 'verify', ...named('verifizieren'), type: T,
        topic: 'Minecraft-Konto verknüpfen: Befehl holen, im Spiel abschicken, fertig.',
        permissions: profiles.publicRead(),
      },
      {
        key: 'pings', ...named('pings'), type: T,
        topic: 'Wähle, worüber du per Ping informiert wirst.',
        permissions: profiles.publicRead(),
      },
      {
        key: 'publicStatus', ...named('status'), type: T,
        topic: 'Läuft alles? Hier siehst du den aktuellen Status von Website und Bots.',
        permissions: profiles.publicRead(),
      },
      {
        key: 'apply', ...named('bewerben'), type: T,
        topic: 'Bewirb dich für das HugoPredict-Team.',
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
      { key: 'discussions', ...named('diskussionen'), type: T, legacy: ['general'], topic: 'Sachlicher Austausch rund um Plattform und Prognosen.', permissions: profiles.memberChat() },
      { key: 'analyses', ...named('analysen', '📊┃marktanalysen', '┃marktanalysen', 'marktanalysen'), type: T, legacy: ['analyses'], topic: 'Fundierte Analysen zu einzelnen Prognosen. Keine Anlageberatung.', permissions: profiles.memberChat(), rateLimitPerUser: 30 },
      { key: 'media', ...named('medien'), type: T, topic: 'Bilder, Screenshots und Clips rund um HugoSMP, Minecraft und die Prognosen. Bitte nur eigene Inhalte.', permissions: profiles.memberChat(), rateLimitPerUser: 30 },
      {
        key: 'ideas',
        ...named('vorschläge'),
        type: F,
        // Forum: ein Beitrag pro Vorschlag, Abstimmung per 👍, Status-Tags setzt nur das Team.
        topic: 'Ein Beitrag pro Vorschlag: kurzer Titel, Idee und warum sie hilft. Bitte vorher suchen, ob es den Vorschlag schon gibt, und mit 👍 abstimmen. Neue Prognosen bitte über „Prognose vorschlagen“ in #prognosen.',
        permissions: profiles.memberChat(),
        rateLimitPerUser: 300,
        forum: {
          availableTags: [
            { name: 'Server', emoji: { id: null, name: '🏠' } },
            { name: 'Bot', emoji: { id: null, name: '🤖' } },
            { name: 'Website', emoji: { id: null, name: '🌐' } },
            { name: 'Minecraft', emoji: { id: null, name: '⛏️' } },
            { name: 'In Prüfung', emoji: { id: null, name: '🔍' }, moderated: true },
            { name: 'Angenommen', emoji: { id: null, name: '✅' }, moderated: true },
            { name: 'Abgelehnt', emoji: { id: null, name: '❌' }, moderated: true },
            { name: 'Umgesetzt', emoji: { id: null, name: '🎉' }, moderated: true },
          ],
          defaultReactionEmoji: { id: null, name: '👍' },
          defaultForumLayout: ForumLayoutType.ListView,
          defaultSortOrder: SortOrderType.LatestActivity,
        },
      },
      { key: 'voice', ...named('Voice 1', '🔊┃voice-1', '🔊┃talk', '┃talk', 'talk'), type: V, permissions: profiles.memberVoice() },
      { key: 'voice2', ...named('Voice 2', '🔊┃voice-2'), type: V, permissions: profiles.memberVoice() },
      { key: 'voice3', ...named('Voice 3', '🔊┃voice-3'), type: V, permissions: profiles.memberVoice() },
    ],
  },
  {
    key: 'service',
    name: 'KUNDENSERVICE',
    legacy: ['support'],
    permissions: profiles.publicRead({ writers: [...LEADERSHIP, 'support'] }),
    channels: [
      { key: 'support', ...named('support'), type: T, legacy: ['ticketCreate'], topic: 'Private Anfragen an den Kundenservice. Tickets sind nur für dich und das Team sichtbar.', permissions: profiles.publicRead() },
      { key: 'supportControl', ...named('support-steuerung'), type: T, topic: 'Support-Warteraum öffnen und schließen. Nur für das Team.', permissions: profiles.staff(PRIVILEGES.ticketStaff) },
      { key: 'waitingRoom', ...named('support-warteraum', '⏳┃warteraum', '┃warteraum', 'warteraum'), type: V, userLimit: WAITING_ROOM_LIMIT, permissions: profiles.waitingRoom() },
      { key: 'supportRoom1', ...named('Support Raum 1', '🎧┃support-1', '┃support-1', 'support-1'), type: V, permissions: profiles.supportRoom() },
      { key: 'supportRoom2', ...named('Support Raum 2', '🎧┃support-2', '┃support-2', 'support-2'), type: V, permissions: profiles.supportRoom() },
    ],
  },
  {
    key: 'internal',
    name: 'INTERN · PRIVAT',
    legacy: ['team'],
    permissions: profiles.staff(STAFF),
    channels: [
      { key: 'operations', ...named('betrieb'), type: T, legacy: ['marketDecisions'], topic: 'Prognosebetrieb: Vorschläge prüfen und Entscheidungen vorbereiten.', permissions: profiles.staff(['marketMod', ...LEADERSHIP]) },
      { key: 'minecraftPanel', ...named('minecraft-panel'), type: T, topic: 'Befehle über den Minecraft-Bot ausführen (/pay, /balance …). Wer diesen Channel sieht, kann das Panel nutzen.', permissions: profiles.staff(LEADERSHIP) },
      { key: 'audit', ...named('prüfprotokoll'), type: T, legacy: ['modLogs'], topic: 'Administrative Eingriffe, Transaktionen und Sicherheitsereignisse.', permissions: profiles.staff(LEADERSHIP, { readOnly: true }) },
      { key: 'system', ...named('systemmeldungen'), type: T, legacy: ['botLogs'], topic: 'Systemstatus und technische Meldungen.', permissions: profiles.staff(['developer', ...LEADERSHIP], { readOnly: true }) },
      { key: 'moderation', ...named('moderation'), type: T, legacy: ['ticketLogs'], topic: 'Moderation und Ticket-Protokolle.', permissions: profiles.staff(['moderator', 'support', ...LEADERSHIP]) },
      { key: 'applications', ...named('bewerbungen'), type: T, topic: 'Eingegangene Team-Bewerbungen. Nur Inhaber und Administrator.', permissions: profiles.staff(LEADERSHIP) },
      { key: 'team', ...named('team'), type: T, legacy: ['teamChat'], topic: 'Internes Team.', permissions: profiles.staff(STAFF) },
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
  operations: 'operations', // Prognosevorschläge und Entscheidungen
  moderation: 'moderation', // Moderationsfälle (Verwarnung, Timeout, Kick, Bann)
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

// Rechte, die der Bot für die Einrichtung mindestens benötigt. Discord erlaubt
// in Overwrites nur Rechte, die der Bot selbst besitzt.
const REQUIRED_BOT_PERMISSIONS = [
  P.ManageRoles, P.ManageChannels, P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles,
  P.ReadMessageHistory, P.ManageMessages, P.AddReactions, P.UseExternalEmojis, P.SendMessagesInThreads,
  P.CreatePublicThreads, P.CreatePrivateThreads,
  // Support-Sprachkanäle (Warteraum und Support-Räume)
  P.Connect, P.Speak, P.Stream, P.MoveMembers,
];

// Damit der Bot die (nicht frei erwähnbaren) Benachrichtigungs-Rollen pingen darf.
const NOTIFY_BOT_PERMISSION = P.MentionEveryone;

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
  NICKNAME_LOCKED_ROLES,
  APPLICATION_POSITIONS,
  WAITING_ROOM_LIMIT,
  TICKET_TYPES,
  LOG_ROUTES,
  REQUIRED_BOT_PERMISSIONS,
  NOTIFY_BOT_PERMISSION,
  BOT_TEXT,
  allChannels,
};

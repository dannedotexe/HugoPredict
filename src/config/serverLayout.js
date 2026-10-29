'use strict';

const { ChannelType, PermissionFlagsBits: P } = require('discord.js');

/*
 * Zentrale, deklarative Beschreibung der Serverstruktur.
 * Das Setup (src/setup/setupServer.js) liest ausschließlich diese Datei.
 * Schlüssel (key) sind stabil und werden im Store auf Discord-IDs abgebildet –
 * Namen dürfen also später angepasst werden, ohne dass Verweise brechen.
 */

// ---------------------------------------------------------------------------
// Rollen – Reihenfolge = Hierarchie (oben = höchste Rolle)
// ---------------------------------------------------------------------------

const ROLES = [
  {
    key: 'owner',
    name: '👑 Owner',
    color: 0xe5c07b,
    hoist: true,
    mentionable: false,
    // Bewusst OHNE Administrator: Das Administrator-Recht ist ausschließlich
    // der Rolle "🛡️ Administrator" vorbehalten. Der Server-Eigentümer hat
    // ohnehin uneingeschränkte Rechte.
    permissions: [
      P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageWebhooks, P.ManageGuildExpressions,
      P.ManageEvents, P.ViewAuditLog, P.ViewGuildInsights, P.KickMembers, P.BanMembers,
      P.ModerateMembers, P.ManageMessages, P.ManageThreads, P.ManageNicknames, P.MentionEveryone,
      P.MuteMembers, P.DeafenMembers, P.MoveMembers,
    ],
  },
  { key: 'admin', name: '🛡️ Administrator', color: 0xc0392b, hoist: true, mentionable: false, permissions: [P.Administrator] },
  {
    key: 'developer',
    name: '🛠️ Developer',
    color: 0x3b82f6,
    hoist: true,
    mentionable: false,
    // Technische Rechte (Webhooks, Audit-Log), aber keine Wirtschafts-Logs (siehe Channels).
    permissions: [P.ManageWebhooks, P.ViewAuditLog],
  },
  {
    key: 'marketMod',
    name: '⚖️ Market Moderator',
    color: 0x8b5cf6,
    hoist: true,
    mentionable: true,
    // Marktverwaltung erfolgt über Channel-Rechte in MARKETS und Bot-Buttons –
    // kein Zugriff auf Guthaben-Funktionen.
    permissions: [],
  },
  {
    key: 'moderator',
    name: '🔨 Moderator',
    color: 0xe67e22,
    hoist: true,
    mentionable: true,
    permissions: [
      P.KickMembers, P.ModerateMembers, P.ManageMessages, P.ManageThreads, P.ManageNicknames,
      P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.ViewAuditLog,
    ],
  },
  { key: 'support', name: '🎫 Support', color: 0x14b8a6, hoist: true, mentionable: true, permissions: [] },
  { key: 'diamondTrader', name: '💎 Diamond Trader', color: 0x67e8f9, hoist: true, mentionable: false, permissions: [] },
  { key: 'trader', name: '📈 Trader', color: 0x10b981, hoist: true, mentionable: false, permissions: [] },
  { key: 'verified', name: '⛏️ Verified', color: 0x6ee7b7, hoist: false, mentionable: false, permissions: [] },
  { key: 'member', name: '👤 Member', color: 0x9ca3af, hoist: false, mentionable: false, permissions: [] },
  {
    key: 'bots',
    name: '🤖 Bots',
    color: 0x4b5563,
    hoist: true,
    mentionable: false,
    // Für weitere Bots: nur das Nötigste.
    permissions: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.AddReactions],
  },
];

// Rollengruppen
const STAFF = ['owner', 'admin', 'developer', 'marketMod', 'moderator', 'support'];
const LEADERSHIP = ['owner', 'admin'];
const MEMBER_TIER = ['member', 'verified', 'trader', 'diamondTrader'];
const VERIFIED_TIER = ['verified', 'trader', 'diamondTrader'];

// Rollen, die privilegierte Bot-Aktionen ausführen dürfen
const PRIVILEGES = {
  setup: ['owner', 'admin'],
  marketDecision: ['owner', 'admin', 'marketMod'],
  ticketStaff: ['owner', 'admin', 'moderator', 'support'],
};

// Rollen, die der Bot selbst vergeben darf (alles andere vergeben nur Menschen)
const SELF_ASSIGNABLE_VIA_BOT = ['member', 'verified'];

// ---------------------------------------------------------------------------
// Berechtigungs-Bausteine
// ---------------------------------------------------------------------------

const READ = [P.ViewChannel, P.ReadMessageHistory];
const WRITE = [P.SendMessages, P.SendMessagesInThreads, P.AddReactions, P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis];
const NO_WRITE = [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads, P.AddReactions];
const VOICE = [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD];
// Rechte, die der Bot in jedem seiner Channels braucht (als Member-Overwrite)
const BOT_TEXT = [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ManageMessages, P.AddReactions];
const BOT_VOICE = [P.ViewChannel, P.Connect];

/** Überschreibungen als { target, allow, deny }; target = 'everyone' | 'bot' | Rollen-Key */
function ow(target, allow = [], deny = []) {
  return { target, allow, deny };
}

const each = (keys, allow, deny) => keys.map((k) => ow(k, allow, deny));

const profiles = {
  /** Für alle sichtbar, nur lesen (auch für nicht verifizierte Nutzer). */
  info: ({ writers = LEADERSHIP } = {}) => [
    ow('everyone', READ, NO_WRITE),
    ...each(writers, [...READ, ...WRITE]),
    ow('bot', BOT_TEXT),
  ],
  /** Nur ab Member sichtbar, nur lesen. */
  memberRead: ({ writers = LEADERSHIP } = {}) => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(MEMBER_TIER, READ, NO_WRITE),
    ...each(STAFF, READ),
    ...each(writers, [...READ, ...WRITE]),
    ow('bot', BOT_TEXT),
  ],
  /** Ab Member sichtbar und beschreibbar. */
  memberChat: () => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(MEMBER_TIER, [...READ, ...WRITE, P.CreatePublicThreads]),
    ...each(STAFF, [...READ, ...WRITE]),
    ow('bot', BOT_TEXT),
  ],
  /** Ab Verified sichtbar, nur lesen. */
  verifiedRead: ({ writers = LEADERSHIP } = {}) => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(VERIFIED_TIER, READ, NO_WRITE),
    ...each(STAFF, READ),
    ...each(writers, [...READ, ...WRITE]),
    ow('bot', BOT_TEXT),
  ],
  /**
   * Command-Channel: Verified-Nutzer dürfen Slash-Commands nutzen (Antworten sind
   * ephemer), aber keine normalen Nachrichten schreiben – private Daten bleiben privat.
   */
  verifiedCommands: () => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(VERIFIED_TIER, [...READ, P.UseApplicationCommands], NO_WRITE),
    ...each(STAFF, READ),
    ow('bot', BOT_TEXT),
  ],
  /** Bot-Feed für Märkte: Market Moderatoren dürfen dort moderieren. */
  marketFeed: () => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(MEMBER_TIER, READ, NO_WRITE),
    ...each(STAFF, READ),
    ...each(['marketMod', ...LEADERSHIP], [...READ, ...WRITE, P.ManageMessages]),
    ow('bot', BOT_TEXT),
  ],
  voice: () => [
    ow('everyone', [], [P.ViewChannel, P.Connect]),
    ...each(MEMBER_TIER, VOICE),
    ...each(STAFF, VOICE),
    ow('bot', BOT_VOICE),
  ],
  /** Team-Channel: nur die angegebenen Rollen. */
  staff: (roles, { readOnly = false } = {}) => [
    ow('everyone', [], [P.ViewChannel]),
    ...each(roles, readOnly ? READ : [...READ, ...WRITE], readOnly ? NO_WRITE : []),
    ow('bot', BOT_TEXT),
  ],
  /** Kategorie für Tickets: komplett privat, Rechte werden pro Ticket vergeben. */
  hidden: () => [ow('everyone', [], [P.ViewChannel]), ow('bot', [...BOT_TEXT, P.ManageChannels])],
};

// ---------------------------------------------------------------------------
// Kategorien & Channels
// ---------------------------------------------------------------------------

const T = ChannelType.GuildText;
const V = ChannelType.GuildVoice;

const CATEGORIES = [
  {
    key: 'startHere',
    name: '📌 START HERE',
    permissions: profiles.info(),
    channels: [
      { key: 'welcome', name: '👋・willkommen', type: T, topic: 'Willkommen bei HugoSMP Market – der Prognoseplattform für HugoSMP.', permissions: profiles.info() },
      { key: 'rules', name: '📜・regeln', type: T, topic: 'Serverregeln. Mit dem Akzeptieren erhältst du Zugriff auf die Community.', permissions: profiles.info() },
      { key: 'announcements', name: '📢・ankündigungen', type: T, topic: 'Offizielle Ankündigungen des HugoSMP-Market-Teams.', permissions: profiles.info() },
      { key: 'status', name: '🟢・status', type: T, topic: 'Live-Status von Bot und Website-Anbindung.', permissions: profiles.info() },
      { key: 'website', name: '🔗・website', type: T, topic: 'Offizielle Links zur Plattform.', permissions: profiles.info() },
      { key: 'verification', name: '🔐・account-verifizierung', type: T, topic: 'Verknüpfe deinen Minecraft-Account mit HugoSMP Market.', permissions: profiles.info() },
    ],
  },
  {
    key: 'markets',
    name: '📊 MARKETS',
    permissions: profiles.memberRead(),
    channels: [
      { key: 'liveMarkets', name: '📈・live-markets', type: T, topic: 'Automatisch aktualisierte Live-Märkte.', permissions: profiles.marketFeed() },
      { key: 'topMarkets', name: '🔥・top-markets', type: T, topic: 'Die Märkte mit dem höchsten Handelsvolumen.', permissions: profiles.marketFeed() },
      { key: 'newMarkets', name: '🆕・neue-märkte', type: T, topic: 'Neu eröffnete Märkte.', permissions: profiles.marketFeed() },
      { key: 'closingSoon', name: '⏳・bald-entschieden', type: T, topic: 'Märkte, deren Handel bald endet.', permissions: profiles.marketFeed() },
      { key: 'resolvedMarkets', name: '✅・entschiedene-märkte', type: T, topic: 'Entschiedene Märkte und ihr Ergebnis.', permissions: profiles.marketFeed() },
      { key: 'rejectedMarkets', name: '❌・abgelehnte-märkte', type: T, topic: 'Abgelehnte Märkte und Vorschläge mit Begründung.', permissions: profiles.marketFeed() },
      { key: 'marketSuggestions', name: '💡・markt-vorschläge', type: T, topic: 'Reiche hier über den Button einen neuen Markt ein.', permissions: profiles.marketFeed() },
      { key: 'communityVotes', name: '🗳️・community-votes', type: T, topic: 'Stimme über eingereichte Marktvorschläge ab.', permissions: profiles.marketFeed() },
    ],
  },
  {
    key: 'trading',
    name: '💹 TRADING',
    permissions: profiles.memberRead(),
    channels: [
      { key: 'balance', name: '💳・guthaben', type: T, topic: 'Nutze /balance – die Antwort sieht nur du.', permissions: profiles.verifiedCommands() },
      { key: 'portfolio', name: '📂・portfolio', type: T, topic: 'Nutze /portfolio – die Antwort sieht nur du.', permissions: profiles.verifiedCommands() },
      { key: 'transactions', name: '🔄・transaktionen', type: T, topic: 'Nutze /history – die Antwort sieht nur du.', permissions: profiles.verifiedCommands() },
      { key: 'priceMovements', name: '📉・preisbewegungen', type: T, topic: 'Deutliche Preisbewegungen in laufenden Märkten.', permissions: profiles.marketFeed() },
      { key: 'traderLeaderboard', name: '🏆・trader-leaderboard', type: T, topic: 'Automatische Trader-Rangliste.', permissions: profiles.memberRead() },
      { key: 'payouts', name: '💸・auszahlungen', type: T, topic: 'Informationen zu Auszahlungen.', permissions: profiles.verifiedRead() },
      { key: 'dailyRewards', name: '🎁・daily-rewards', type: T, topic: 'Nutze /daily für deinen täglichen Bonus.', permissions: profiles.verifiedCommands() },
      { key: 'fees', name: '🧾・gebühren', type: T, topic: 'Übersicht über Handelsgebühren.', permissions: profiles.memberRead() },
    ],
  },
  {
    key: 'hugosmp',
    name: '⛏️ HUGOSMP',
    permissions: profiles.memberRead(),
    channels: [
      { key: 'hugoNews', name: '📢・hugo-news', type: T, topic: 'Neuigkeiten vom HugoSMP-Server.', permissions: profiles.memberRead({ writers: [...LEADERSHIP, 'moderator'] }) },
      { key: 'serverEvents', name: '⚔️・server-events', type: T, topic: 'Anstehende Events auf HugoSMP.', permissions: profiles.memberRead({ writers: [...LEADERSHIP, 'moderator', 'marketMod'] }) },
      { key: 'itemPrices', name: '💎・item-preise', type: T, topic: 'Austausch über Item-Preise auf HugoSMP.', permissions: profiles.memberChat() },
      { key: 'factions', name: '🏰・fraktionen', type: T, topic: 'Fraktionen, Bündnisse und Konflikte.', permissions: profiles.memberChat() },
      { key: 'playerPredictions', name: '👥・spieler-prognosen', type: T, topic: 'Prognosen zu Spielern.', permissions: profiles.memberChat() },
      { key: 'communityPredictions', name: '🎯・community-prognosen', type: T, topic: 'Eure Prognosen für HugoSMP.', permissions: profiles.memberChat() },
    ],
  },
  {
    key: 'community',
    name: '💬 COMMUNITY',
    permissions: profiles.memberChat(),
    channels: [
      { key: 'general', name: '💬・allgemeiner-chat', type: T, topic: 'Allgemeiner Austausch.', permissions: profiles.memberChat() },
      { key: 'tradingTalk', name: '📈・trading-talk', type: T, topic: 'Strategien und Märkte diskutieren. Keine Finanzberatung.', permissions: profiles.memberChat() },
      { key: 'analyses', name: '🧠・analysen', type: T, topic: 'Ausführliche Marktanalysen.', permissions: profiles.memberChat(), rateLimitPerUser: 30 },
      { key: 'tradeFlex', name: '📸・trade-flex', type: T, topic: 'Zeig deine besten Trades.', permissions: profiles.memberChat(), rateLimitPerUser: 30 },
      { key: 'memes', name: '😂・memes', type: T, topic: 'Memes rund um HugoSMP und Trading.', permissions: profiles.memberChat(), rateLimitPerUser: 10 },
      { key: 'lfg', name: '🤝・suche-mitspieler', type: T, topic: 'Mitspieler für HugoSMP finden.', permissions: profiles.memberChat(), rateLimitPerUser: 60 },
      { key: 'feedback', name: '💡・ideen-und-feedback', type: T, topic: 'Ideen und Feedback zur Plattform.', permissions: profiles.memberChat(), rateLimitPerUser: 60 },
    ],
  },
  {
    key: 'support',
    name: '🛟 SUPPORT',
    permissions: profiles.info({ writers: [...LEADERSHIP, 'support'] }),
    channels: [
      { key: 'faq', name: '❓・faq', type: T, topic: 'Häufige Fragen.', permissions: profiles.info({ writers: [...LEADERSHIP, 'support'] }) },
      { key: 'ticketCreate', name: '🎫・ticket-erstellen', type: T, topic: 'Öffne hier ein privates Support-Ticket.', permissions: profiles.info() },
      { key: 'bugReports', name: '🐛・bug-reports', type: T, topic: 'Öffentliche Bug-Meldungen. Keine Kontodaten posten!', permissions: profiles.memberChat(), rateLimitPerUser: 60 },
      { key: 'transactionIssues', name: '⚠️・probleme-mit-transaktionen', type: T, topic: 'Transaktionsprobleme bitte ausschließlich per privatem Ticket melden.', permissions: profiles.info({ writers: [...LEADERSHIP, 'support'] }) },
      { key: 'fraudReports', name: '🚨・betrugs-meldungen', type: T, topic: 'Betrugsverdacht bitte ausschließlich per privatem Ticket melden.', permissions: profiles.info({ writers: [...LEADERSHIP, 'moderator'] }) },
    ],
  },
  {
    key: 'rankings',
    name: '🏅 RANKINGS',
    permissions: profiles.memberRead(),
    channels: [
      { key: 'weeklyTop', name: '🥇・wöchentliche-top-trader', type: T, topic: 'Die besten Trader der Woche.', permissions: profiles.memberRead() },
      { key: 'allTime', name: '👑・all-time-leaderboard', type: T, topic: 'Die besten Trader aller Zeiten.', permissions: profiles.memberRead() },
      { key: 'accuracy', name: '🎯・höchste-trefferquote', type: T, topic: 'Die höchste Trefferquote.', permissions: profiles.memberRead() },
      { key: 'biggestWins', name: '💰・größte-gewinne', type: T, topic: 'Die größten Einzelgewinne.', permissions: profiles.memberRead() },
    ],
  },
  {
    key: 'voice',
    name: '🔊 VOICE',
    permissions: profiles.voice(),
    channels: [
      { key: 'voiceLobby', name: '🔊・Lobby', type: V, permissions: profiles.voice() },
      { key: 'voiceTrading', name: '📈・Trading-Talk', type: V, permissions: profiles.voice() },
      { key: 'voiceHugo', name: '🎮・HugoSMP', type: V, permissions: profiles.voice() },
    ],
  },
  {
    key: 'team',
    name: '🔒 TEAM INTERN',
    permissions: profiles.staff(STAFF),
    channels: [
      { key: 'teamChat', name: '💬・team-chat', type: T, topic: 'Interner Team-Chat.', permissions: profiles.staff(STAFF) },
      { key: 'teamTasks', name: '📋・team-aufgaben', type: T, topic: 'Aufgaben und Zuständigkeiten.', permissions: profiles.staff(STAFF) },
      { key: 'testChannel', name: '🧪・test-channel', type: T, topic: 'Tests für Bot und Integrationen.', permissions: profiles.staff(['developer', ...LEADERSHIP]) },
      { key: 'botLogs', name: '🛠️・bot-logs', type: T, topic: 'Technische Bot-Logs.', permissions: profiles.staff(['developer', ...LEADERSHIP], { readOnly: true }) },
      { key: 'economyLogs', name: '📊・wirtschafts-logs', type: T, topic: 'Wirtschaftsrelevante Ereignisse (nur Leitung).', permissions: profiles.staff(LEADERSHIP, { readOnly: true }) },
      { key: 'transactionLogs', name: '💸・transaktions-logs', type: T, topic: 'Über den Bot ausgelöste Transaktionen (nur Leitung).', permissions: profiles.staff(LEADERSHIP, { readOnly: true }) },
      { key: 'marketDecisions', name: '⚖️・markt-entscheidungen', type: T, topic: 'Marktvorschläge prüfen, annehmen oder ablehnen.', permissions: profiles.staff(['marketMod', ...LEADERSHIP]) },
      { key: 'securityLogs', name: '🚨・sicherheits-logs', type: T, topic: 'Verweigerte Zugriffe und sicherheitsrelevante Ereignisse.', permissions: profiles.staff(LEADERSHIP, { readOnly: true }) },
      { key: 'ticketLogs', name: '🎫・ticket-logs', type: T, topic: 'Ticket-Verläufe und Abschlussprotokolle.', permissions: profiles.staff(['support', 'moderator', ...LEADERSHIP], { readOnly: true }) },
      { key: 'modLogs', name: '📝・moderations-logs', type: T, topic: 'Administrative Eingriffe und Moderationsaktionen.', permissions: profiles.staff(['moderator', ...LEADERSHIP], { readOnly: true }) },
      { key: 'leadership', name: '👑・leitung', type: T, topic: 'Leitungsebene.', permissions: profiles.staff(LEADERSHIP) },
    ],
  },
  {
    // Zusätzliche, private Kategorie für Ticket-Channels.
    key: 'tickets',
    name: '🎫 TICKETS',
    permissions: profiles.hidden(),
    channels: [],
  },
];

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

const TICKET_TYPES = [
  { key: 'general', label: 'Allgemeiner Support', description: 'Fragen zur Plattform oder zum Discord', roles: ['support', 'moderator'] },
  { key: 'balance', label: 'Guthaben & Transaktionen', description: 'Probleme mit Guthaben, Trades oder Auszahlungen', roles: ['support', 'admin'] },
  { key: 'bug', label: 'Bug melden', description: 'Fehler auf der Website oder im Bot', roles: ['support', 'developer'] },
  { key: 'fraud', label: 'Betrugsverdacht', description: 'Verdacht auf Betrug oder Manipulation', roles: ['moderator', 'admin'] },
  { key: 'other', label: 'Sonstiges', description: 'Alles andere', roles: ['support'] },
];

// Permissions, die der Bot für /setup-server mindestens benötigt.
// Discord erlaubt in Channel-Überschreibungen nur Rechte, die der Bot selbst besitzt –
// deshalb tauchen hier auch Voice- und Thread-Rechte auf.
const REQUIRED_BOT_PERMISSIONS = [
  P.ManageRoles, P.ManageChannels, P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles,
  P.ReadMessageHistory, P.ManageMessages, P.AddReactions, P.UseExternalEmojis, P.SendMessagesInThreads,
  P.CreatePublicThreads, P.CreatePrivateThreads, P.UseApplicationCommands,
  P.Connect, P.Speak, P.Stream, P.UseVAD,
];

function allChannels() {
  return CATEGORIES.flatMap((c) => c.channels.map((ch) => ({ ...ch, category: c.key })));
}

module.exports = {
  ROLES,
  CATEGORIES,
  STAFF,
  LEADERSHIP,
  MEMBER_TIER,
  VERIFIED_TIER,
  PRIVILEGES,
  SELF_ASSIGNABLE_VIA_BOT,
  TICKET_TYPES,
  REQUIRED_BOT_PERMISSIONS,
  BOT_TEXT,
  allChannels,
};

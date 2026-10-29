'use strict';

/*
 * Frühere Serverstruktur (bis zur Umstellung auf das deutsche Minimal-Layout).
 * Wird nur gelesen, um bestehende Channels/Rollen beim Setup zu erkennen,
 * umzubenennen (siehe `legacy` in serverLayout.js) oder als veraltet zu melden.
 * Es wird nie automatisch etwas gelöscht.
 */

// [key, name, type] – type: 0 = Text, 2 = Voice
const LEGACY_CATEGORIES = [
  { key: 'startHere', name: '📌 START HERE', channels: [
    ['welcome', '👋・willkommen', 0],
    ['rules', '📜・regeln', 0],
    ['announcements', '📢・ankündigungen', 0],
    ['status', '🟢・status', 0],
    ['website', '🔗・website', 0],
    ['verification', '🔐・account-verifizierung', 0],
  ] },
  { key: 'markets', name: '📊 MARKETS', channels: [
    ['liveMarkets', '📈・live-markets', 0],
    ['topMarkets', '🔥・top-markets', 0],
    ['newMarkets', '🆕・neue-märkte', 0],
    ['closingSoon', '⏳・bald-entschieden', 0],
    ['resolvedMarkets', '✅・entschiedene-märkte', 0],
    ['rejectedMarkets', '❌・abgelehnte-märkte', 0],
    ['marketSuggestions', '💡・markt-vorschläge', 0],
    ['communityVotes', '🗳️・community-votes', 0],
  ] },
  { key: 'trading', name: '💹 TRADING', channels: [
    ['balance', '💳・guthaben', 0],
    ['portfolio', '📂・portfolio', 0],
    ['transactions', '🔄・transaktionen', 0],
    ['priceMovements', '📉・preisbewegungen', 0],
    ['traderLeaderboard', '🏆・trader-leaderboard', 0],
    ['payouts', '💸・auszahlungen', 0],
    ['dailyRewards', '🎁・daily-rewards', 0],
    ['fees', '🧾・gebühren', 0],
  ] },
  { key: 'hugosmp', name: '⛏️ HUGOSMP', channels: [
    ['hugoNews', '📢・hugo-news', 0],
    ['serverEvents', '⚔️・server-events', 0],
    ['itemPrices', '💎・item-preise', 0],
    ['factions', '🏰・fraktionen', 0],
    ['playerPredictions', '👥・spieler-prognosen', 0],
    ['communityPredictions', '🎯・community-prognosen', 0],
  ] },
  { key: 'community', name: '💬 COMMUNITY', channels: [
    ['general', '💬・allgemeiner-chat', 0],
    ['tradingTalk', '📈・trading-talk', 0],
    ['analyses', '🧠・analysen', 0],
    ['tradeFlex', '📸・trade-flex', 0],
    ['memes', '😂・memes', 0],
    ['lfg', '🤝・suche-mitspieler', 0],
    ['feedback', '💡・ideen-und-feedback', 0],
  ] },
  { key: 'support', name: '🛟 SUPPORT', channels: [
    ['faq', '❓・faq', 0],
    ['ticketCreate', '🎫・ticket-erstellen', 0],
    ['bugReports', '🐛・bug-reports', 0],
    ['transactionIssues', '⚠️・probleme-mit-transaktionen', 0],
    ['fraudReports', '🚨・betrugs-meldungen', 0],
  ] },
  { key: 'rankings', name: '🏅 RANKINGS', channels: [
    ['weeklyTop', '🥇・wöchentliche-top-trader', 0],
    ['allTime', '👑・all-time-leaderboard', 0],
    ['accuracy', '🎯・höchste-trefferquote', 0],
    ['biggestWins', '💰・größte-gewinne', 0],
  ] },
  { key: 'voice', name: '🔊 VOICE', channels: [
    ['voiceLobby', '🔊・Lobby', 2],
    ['voiceTrading', '📈・Trading-Talk', 2],
    ['voiceHugo', '🎮・HugoSMP', 2],
  ] },
  { key: 'team', name: '🔒 TEAM INTERN', channels: [
    ['teamChat', '💬・team-chat', 0],
    ['teamTasks', '📋・team-aufgaben', 0],
    ['testChannel', '🧪・test-channel', 0],
    ['botLogs', '🛠️・bot-logs', 0],
    ['economyLogs', '📊・wirtschafts-logs', 0],
    ['transactionLogs', '💸・transaktions-logs', 0],
    ['marketDecisions', '⚖️・markt-entscheidungen', 0],
    ['securityLogs', '🚨・sicherheits-logs', 0],
    ['ticketLogs', '🎫・ticket-logs', 0],
    ['modLogs', '📝・moderations-logs', 0],
    ['leadership', '👑・leitung', 0],
  ] },
  { key: 'tickets', name: '🎫 TICKETS', channels: [
  ] },
];

const LEGACY_ROLES = [
  ['owner', '👑 Owner'],
  ['admin', '🛡️ Administrator'],
  ['developer', '🛠️ Developer'],
  ['marketMod', '⚖️ Market Moderator'],
  ['moderator', '🔨 Moderator'],
  ['support', '🎫 Support'],
  ['diamondTrader', '💎 Diamond Trader'],
  ['trader', '📈 Trader'],
  ['verified', '⛏️ Verified'],
  ['member', '👤 Member'],
  ['bots', '🤖 Bots'],
];

// Panel-Schlüssel der alten Struktur, deren Nachricht im neuen Layout weiterverwendet wird
const LEGACY_PANELS = { docs: 'welcome' };

module.exports = { LEGACY_CATEGORIES, LEGACY_ROLES, LEGACY_PANELS };

// Creates demo markets so the site isn't empty. Run with: npm run seed
import './env.js';
import { db } from './db.js';
import { createMarket } from './services.js';

if (db.prepare('SELECT COUNT(*) n FROM markets').get().n > 0) {
  console.log('Es gibt schon Märkte – nichts zu tun.');
  process.exit(0);
}

const inDays = (d) => new Date(Date.now() + d * 86400e3).toISOString();

const demo = [
  { title: 'Wer gewinnt den nächsten großen Clan Fight?', category: 'clan', emoji: '⚔️', closesAt: inDays(7),
    description: 'Wird aufgelöst, sobald der Clan Fight vorbei ist. Gewinner ist der Clan, der laut Server-Ansage gewinnt. (Clan-Namen im Admin-Panel anpassen.)',
    outcomes: ['Clan A', 'Clan B', 'Clan C', 'Unentschieden'] },
  { title: 'Gewinnt Clan A den Fight gegen Clan B am Wochenende?', category: 'clan', emoji: '🛡️', closesAt: inDays(3),
    description: 'Ja, wenn Clan A den angekündigten Fight gewinnt. Fällt der Fight aus, wird der Markt storniert.', outcomes: ['Ja', 'Nein'] },
  { title: 'Was wird die nächste PvP-Meta auf Hugo SMP?', category: 'meta', emoji: '🗡️', closesAt: inDays(30),
    description: 'Die Waffe/Kampfart, die beim nächsten großen Event am häufigsten genutzt wird.',
    outcomes: ['Mace', 'Crystal PvP', 'Schwert + Schild', 'Axt', 'Speer'] },
  { title: 'Wird Netherite vor dem nächsten Reset generft?', category: 'meta', emoji: '💎', closesAt: inDays(45),
    description: 'Ja, wenn die Admins offiziell einen Nerf ankündigen.', outcomes: ['Ja', 'Nein'] },
  { title: 'Kommt bis Ende des Jahres ein neues Hugo SMP Event?', category: 'server', emoji: '🏰', closesAt: inDays(60),
    description: 'Ja, wenn bis 31.12. ein offizielles Event startet.', outcomes: ['Ja', 'Nein'] },
  { title: 'Schneit es an Heiligabend 2026 in Berlin?', category: 'irl', emoji: '❄️', closesAt: inDays(55),
    description: 'Ja, wenn der DWD für Berlin am 24.12.2026 Schneefall meldet.', outcomes: ['Ja', 'Nein'] },
  { title: 'Wer wird Deutscher Meister 2026/27?', category: 'irl', emoji: '⚽', closesAt: inDays(200),
    description: 'Fußball-Bundesliga, Saison 2026/27.', outcomes: ['Bayern', 'Dortmund', 'Leverkusen', 'Leipzig', 'Andere'] },
];

for (const m of demo) createMarket(m);
console.log(`${demo.length} Demo-Märkte erstellt.`);

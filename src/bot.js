import mineflayer from 'mineflayer';
import * as svc from './services.js';

export const botState = {
  enabled: false,
  online: false,
  username: process.env.MC_USERNAME || 'HugoPredict',
  lastError: null,
};

// Payment confirmations of common economy plugins. Anchored with ^ so that player chat
// ("<Name> 500 has been received from ...") or whispers can't fake a deposit.
const DEFAULT_PATTERNS = [
  String.raw`^\$?(?<amount>[\d.,]+[kKmM]?)\$? has been received from (?<player>\w{3,16})\.?$`,
  String.raw`^(?<player>\w{3,16}) has paid you \$?(?<amount>[\d.,]+[kKmM]?)\$?\.?$`,
  String.raw`^You have received \$?(?<amount>[\d.,]+[kKmM]?)\$? from (?<player>\w{3,16})\.?$`,
  String.raw`^Du hast \$?(?<amount>[\d.,]+[kKmM]?)\$? von (?<player>\w{3,16}) erhalten\.?$`,
  String.raw`^(?<player>\w{3,16}) hat dir \$?(?<amount>[\d.,]+[kKmM]?)\$? (?:gezahlt|überwiesen|gesendet)\.?$`,
];

export function parseAmount(text) {
  const m = String(text).replace(/[,\s$]/g, '').match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!m) return NaN;
  const mult = !m[2] ? 1 : /k/i.test(m[2]) ? 1e3 : 1e6;
  return parseFloat(m[1]) * mult;
}

export function matchDeposit(message, patterns) {
  for (const re of patterns) {
    const m = message.match(re);
    if (m?.groups?.player && m.groups.amount) return { player: m.groups.player, amount: parseAmount(m.groups.amount) };
  }
  return null;
}

export function startBot() {
  // With the external bot connected, this one would pay out withdrawals without team approval.
  if (process.env.HUGO_API_KEY) {
    botState.enabled = true;
    if (process.env.BOT_ENABLED === 'true') console.warn('BOT_ENABLED wird ignoriert: HUGO_API_KEY ist gesetzt, der externe Minecraft-Bot übernimmt.');
    return;
  }
  if (process.env.BOT_ENABLED !== 'true') {
    console.log('Bot deaktiviert (BOT_ENABLED=false) – Einzahlungen laufen nur über Admin-Gutschriften.');
    return;
  }
  botState.enabled = true;
  const patterns = (process.env.DEPOSIT_PATTERNS ? process.env.DEPOSIT_PATTERNS.split('||') : DEFAULT_PATTERNS)
    .map((p) => new RegExp(p.trim(), 'i'));
  const payCommand = process.env.PAY_COMMAND || '/pay {player} {amount}';
  let bot;
  let timer;
  let stopped = false;

  const whisper = (player, text) => {
    try { bot.whisper(player, text); } catch { /* bot may be disconnecting */ }
  };

  function processWithdrawal() {
    const w = svc.nextWithdrawal();
    if (!w || !botState.online) return;
    try {
      svc.markWithdrawal(w.id, 'processing');
      bot.chat(payCommand.replace('{player}', w.mc_name).replace('{amount}', String(w.amount)));
      svc.markWithdrawal(w.id, 'done');
      console.log(`[bot] Auszahlung #${w.id}: ${w.amount} an ${w.mc_name}`);
      setTimeout(() => whisper(w.mc_name, `HugoPredict: ${w.amount} wurden dir ausgezahlt.`), 1500);
    } catch (err) {
      svc.markWithdrawal(w.id, 'failed', err.message);
    }
  }

  function connect() {
    bot = mineflayer.createBot({
      host: process.env.MC_HOST,
      port: Number(process.env.MC_PORT || 25565),
      username: botState.username,
      auth: process.env.MC_AUTH || 'microsoft',
      version: process.env.MC_VERSION || false,
    });

    bot.once('spawn', () => {
      botState.online = true;
      botState.username = bot.username;
      botState.lastError = null;
      console.log(`[bot] Online als ${bot.username}`);
      if (process.env.MC_JOIN_COMMAND) setTimeout(() => bot.chat(process.env.MC_JOIN_COMMAND), 2000);
      // One withdrawal every 4s keeps us under typical anti-spam limits.
      timer = setInterval(processWithdrawal, 4000);
    });

    bot.on('messagestr', (message, position) => {
      const clean = message.replace(/§./g, '').trim();
      if (process.env.LOG_CHAT === 'true') console.log(`[chat:${position}] ${clean}`);
      if (position === 'chat') return; // signed player chat – never a payment confirmation
      const dep = matchDeposit(clean, patterns);
      if (!dep || dep.player.toLowerCase() === bot.username.toLowerCase()) return;
      try {
        const res = svc.recordDeposit(dep.player, dep.amount, clean);
        if (!res) return;
        console.log(`[bot] Einzahlung: ${res.amount} von ${dep.player}${res.credited ? '' : ' (noch nicht verknüpft)'}`);
        whisper(dep.player, res.credited
          ? `HugoPredict: ${res.amount} gutgeschrieben!`
          : `HugoPredict: ${res.amount} erhalten. Verknüpfe deinen Account auf der Website, dann wird es gutgeschrieben.`);
      } catch (err) {
        console.error('[bot] Einzahlung fehlgeschlagen', err);
      }
    });

    bot.on('whisper', (player, message) => {
      const m = message.trim().match(/^(?:verify|link|verifizieren)\s+([A-F0-9]{6})$/i);
      if (!m) return;
      try {
        const res = svc.completeLink(player, m[1]);
        whisper(player, `HugoPredict: Verknüpft mit ${res.username}!${res.claimed ? ` ${res.claimed} gutgeschrieben.` : ''}`);
      } catch (err) {
        whisper(player, `HugoPredict: ${err instanceof svc.AppError ? err.message : 'Fehler beim Verknüpfen'}`);
      }
    });

    bot.on('kicked', (reason) => {
      botState.lastError = `Gekickt: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`;
      console.warn('[bot]', botState.lastError);
    });
    bot.on('error', (err) => {
      botState.lastError = err.message;
      console.warn('[bot] Fehler:', err.message);
    });
    bot.on('end', () => {
      botState.online = false;
      clearInterval(timer);
      if (stopped) return;
      console.log('[bot] Verbindung getrennt, neuer Versuch in 30s');
      setTimeout(connect, 30000);
    });
  }

  connect();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      bot?.quit();
    },
  };
}

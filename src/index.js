'use strict';

// Konfiguration zuerst laden, damit .env-Werte (z. B. BRAND_NAME) überall verfügbar sind.
let env;
try {
  const config = require('./config/env');
  config.assertDiscordEnv();
  env = config.env;
} catch (err) {
  console.error(`Konfigurationsfehler: ${err.message}`);
  process.exit(1);
}

const { Client, Events } = require('discord.js');
const { createLogger } = require('./lib/logger');
const { Store } = require('./lib/store');
const { HugoApi } = require('./lib/hugoApi');
const { RateLimiter, LockSet, LIMITS } = require('./lib/rateLimit');
const { createGuildContext } = require('./lib/guildContext');
const { embeds, formatRetry } = require('./lib/embeds');
const { replyPrivate } = require('./lib/respond');
const { emojis } = require('./lib/emojis');
const { loadCommands, loadInteractionHandlers } = require('./registry');
const { createStatusService } = require('./services/status');
const { createMarketFeed } = require('./services/marketFeed');
const { createStatsService } = require('./services/stats');
const { createWelcomeService } = require('./services/welcome');
const { resolveIntents, membersIntentAllowed } = require('./lib/intents');

const logger = createLogger(env.logLevel);
const store = new Store(env.dataDir);
const api = new HugoApi({ baseUrl: env.apiUrl, apiKey: env.apiKey, timeoutMs: env.apiTimeoutMs, logger });
const limiter = new RateLimiter();
const locks = new LockSet();
const ctx = createGuildContext({ store, logger });
const commands = loadCommands();
const handlers = loadInteractionHandlers();

// Der Client wird in main() erstellt, sobald feststeht, welche Intents freigegeben sind.
let client;

const status = createStatusService({ api, store, env, logger });
const marketFeed = createMarketFeed({ api, store, env, ctx, logger, statusService: status });

const denyLog = new Map();

const deps = {
  env, api, store, ctx, logger, limiter, locks,
  services: {
    status,
    marketFeed,
    runFeedsNow: () => {
      marketFeed.tick(client).catch((err) => logger.error('Prognosen:', err));
      status.tick(client).catch((err) => logger.error('Status:', err));
    },
  },

  /** Rate-Limit prüfen. Antwortet selbst und gibt false zurück, wenn überschritten. */
  checkRate(interaction, key) {
    const res = limiter.hit(`${key}:${interaction.user.id}`, LIMITS[key] ?? LIMITS.default);
    if (res.ok) return true;
    replyPrivate(interaction, { embeds: [embeds.warning('Zu viele Anfragen', `Bitte warte ${formatRetry(res.retryAfterMs)}.`)] }).catch(() => {});
    return false;
  },

  /** Verweigert eine Aktion und protokolliert den Versuch (gedrosselt). */
  async deny(interaction, action) {
    const key = `${interaction.user.id}:${action}`;
    if (interaction.guild && Date.now() - (denyLog.get(key) ?? 0) > 5 * 60_000) {
      denyLog.set(key, Date.now());
      await ctx.audit(interaction.guild, 'audit', {
        title: 'Zugriff verweigert',
        fields: [
          { name: 'Nutzer', value: `<@${interaction.user.id}> (${interaction.user.id})` },
          { name: 'Aktion', value: action },
          { name: 'Channel', value: interaction.channelId ? `<#${interaction.channelId}>` : '—' },
        ],
      });
    }
    return replyPrivate(interaction, { embeds: [embeds.error('Keine Berechtigung', 'Du darfst diese Aktion nicht ausführen.')] });
  },
};

async function handleCommand(interaction) {
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;
  if (!interaction.inCachedGuild()) {
    return replyPrivate(interaction, { embeds: [embeds.error('Nur auf dem Server', 'Dieser Befehl ist nur auf dem HugoPredict-Server verfügbar.')] });
  }
  if (cmd.privilege && !ctx.can(interaction.member, cmd.privilege)) return deps.deny(interaction, `/${interaction.commandName}`);
  if (!deps.checkRate(interaction, cmd.rateLimit ?? 'default')) return;
  await cmd.execute(interaction, deps);
}

async function handleComponent(interaction) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'hm') return; // z. B. Bestätigungs-Buttons mit eigenem Collector
  const handler = handlers.get(parts[1]);
  if (!handler) return;
  if (!interaction.inCachedGuild()) return;
  await handler.handle(interaction, deps, parts.slice(2));
}

/** Registriert alle Event-Handler am Client. */
function wire({ stats, welcome, membersIntent }) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) await handleCommand(interaction);
      else if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) await handleComponent(interaction);
    } catch (err) {
      logger.error(`Interaktion ${interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.customId} fehlgeschlagen:`, err);
      if (interaction.guild) {
        ctx.audit(interaction.guild, 'system', {
          title: 'Unerwarteter Fehler',
          description: `\`${String(err?.message ?? err).slice(0, 1000)}\``,
          fields: [{ name: 'Nutzer', value: `<@${interaction.user.id}>` }],
        });
      }
      if (interaction.isRepliable()) {
        replyPrivate(interaction, { embeds: [embeds.error('Unerwarteter Fehler', 'Bei der Verarbeitung ist ein Fehler aufgetreten. Das Team wurde informiert.')] }).catch(() => {});
      }
    }
  });

  // Manuell gelöschte Ticket-Channels freigeben, damit das Ticket-Limit nicht blockiert.
  client.on(Events.ChannelDelete, (channel) => {
    if (!channel.guild) return;
    const g = store.guild(channel.guild.id);
    const ticket = g.tickets[channel.id];
    if (!ticket) return;
    delete g.tickets[channel.id];
    store.save();
    if (ticket.status === 'open') {
      ctx.audit(channel.guild, 'tickets', { title: `Anfrage #${ticket.number} manuell entfernt`, description: 'Der Channel wurde ohne Abschluss über den Bot gelöscht. Es liegt kein Transkript vor.' });
    }
  });

  // Begrüßung neuer Mitglieder per Direktnachricht (nur mit „Server Members Intent“)
  if (membersIntent) client.on(Events.GuildMemberAdd, (member) => welcome.onMemberAdd(member).catch((err) => logger.warn('Begrüßung:', err.message)));

  client.once(Events.ClientReady, async (c) => {
    if (!membersIntent) logger.warn('„Server Members Intent“ nicht freigegeben – Begrüßung und Teile der Statistik sind deaktiviert.');
    logger.info(`Eingeloggt als ${c.user.tag} auf ${c.guilds.cache.size} Server(n).`);
    if (!api.configured) logger.warn('Website-API nicht konfiguriert (HUGO_API_URL/HUGO_API_KEY) – Konto- und Prognosefunktionen sind deaktiviert.');
    if (env.guildId && !c.guilds.cache.has(env.guildId)) logger.warn(`Bot ist nicht auf dem Server DISCORD_GUILD_ID=${env.guildId}.`);

    // Custom-Emojis zuerst bereitstellen, damit Panels und Embeds sie nutzen können.
    await emojis.sync(c, logger);

    const every = (ms, fn, name) => {
      const run = () => fn(c).catch((err) => logger.error(`${name}:`, err));
      run();
      intervals.push(setInterval(run, ms));
    };
    every(5 * 60_000, status.tick, 'Status');
    every(env.marketFeedIntervalSeconds * 1000, marketFeed.tick, 'Prognosen');
    every(60 * 60_000, stats.tick, 'Statistik');
    // Wird der „Server Members Intent“ später freigeschaltet, startet der Bot neu, um ihn zu nutzen.
    // pm2 bzw. systemd starten den Prozess automatisch wieder.
    if (!membersIntent) {
      intervals.push(setInterval(async () => {
        if (await membersIntentAllowed(env.discordToken)) {
          logger.info('„Server Members Intent“ wurde freigeschaltet – Neustart, um ihn zu aktivieren.');
          shutdown('Intent-Freigabe', 1);
        }
      }, 10 * 60_000));
    }
    intervals.push(setInterval(() => limiter.sweep(), 10 * 60_000));
  });

  client.on(Events.Error, (err) => logger.error('Discord-Client:', err));
}

const intervals = [];
process.on('unhandledRejection', (err) => logger.error('Unbehandelte Promise-Ablehnung:', err));

function shutdown(signal, code = 0) {
  logger.info(`${signal} empfangen – fahre herunter.`);
  intervals.forEach(clearInterval);
  try {
    store.flush();
  } catch (err) {
    logger.error('Store konnte nicht gespeichert werden:', err);
  }
  (client ? client.destroy() : Promise.resolve()).finally(() => process.exit(code));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  const { intents, members: membersIntent } = await resolveIntents(env.discordToken);
  client = new Client({ intents });
  deps.membersIntent = membersIntent;
  const stats = createStatsService({ store, ctx, logger, membersIntent });
  const welcome = createWelcomeService({ store, env, logger, ctx });
  deps.services.stats = stats;
  wire({ stats, welcome, membersIntent });
  await client.login(env.discordToken);
}

main().catch((err) => {
  logger.error('Login fehlgeschlagen – prüfe DISCORD_TOKEN:', err.message);
  process.exit(1);
});

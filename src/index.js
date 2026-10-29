'use strict';

const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');
const { env, assertDiscordEnv } = require('./config/env');
const { createLogger } = require('./lib/logger');
const { Store } = require('./lib/store');
const { HugoApi } = require('./lib/hugoApi');
const { RateLimiter, LockSet, LIMITS } = require('./lib/rateLimit');
const { createGuildContext } = require('./lib/guildContext');
const { embeds, formatRetry } = require('./lib/embeds');
const { replyPrivate } = require('./lib/respond');
const { loadCommands, loadInteractionHandlers } = require('./registry');
const { createStatusService } = require('./services/status');
const { createMarketFeed } = require('./services/marketFeed');
const { createLeaderboards } = require('./services/leaderboards');

assertDiscordEnv();

const logger = createLogger(env.logLevel);
const store = new Store(env.dataDir);
const api = new HugoApi({ baseUrl: env.apiUrl, apiKey: env.apiKey, timeoutMs: env.apiTimeoutMs, logger });
const limiter = new RateLimiter();
const locks = new LockSet();
const ctx = createGuildContext({ store, logger });
const commands = loadCommands();
const handlers = loadInteractionHandlers();

const intents = [GatewayIntentBits.Guilds];
// Privilegierter Intent nur, wenn Begrüßungen beim Beitritt aktiviert sind.
if (env.welcomeOnJoin) intents.push(GatewayIntentBits.GuildMembers);
const client = new Client({ intents, partials: [Partials.GuildMember] });

const status = createStatusService({ api, store, env, logger });
const marketFeed = createMarketFeed({ api, store, env, ctx, logger, statusService: status });
const leaderboards = createLeaderboards({ api, store, env, ctx, logger });

const denyLog = new Map();

const deps = {
  env, api, store, ctx, logger, limiter, locks,
  services: {
    status,
    marketFeed,
    leaderboards,
    runFeedsNow: () => {
      marketFeed.tick(client).catch((err) => logger.error('Markt-Feed:', err));
      leaderboards.tick(client).catch((err) => logger.error('Ranglisten:', err));
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
      await ctx.audit(interaction.guild, 'securityLogs', {
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
    return replyPrivate(interaction, { embeds: [embeds.error('Nur auf dem Server', 'Dieser Befehl funktioniert nur auf dem HugoSMP-Market-Server.')] });
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

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) await handleComponent(interaction);
  } catch (err) {
    logger.error(`Interaktion ${interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.customId} fehlgeschlagen:`, err);
    if (interaction.guild) {
      ctx.audit(interaction.guild, 'botLogs', {
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

client.on(Events.GuildMemberAdd, async (member) => {
  if (!env.welcomeOnJoin) return;
  const channel = await ctx.channel(member.guild, 'welcome');
  if (!channel?.isTextBased()) return;
  const rules = ctx.channelId(member.guild.id, 'rules');
  const verify = ctx.channelId(member.guild.id, 'verification');
  await channel.send({
    content: `<@${member.id}>`,
    embeds: [embeds.brand().setTitle('Willkommen bei HugoSMP Market')
      .setDescription([
        rules ? `Akzeptiere die Regeln in <#${rules}>.` : null,
        verify ? `Verknüpfe danach deinen Minecraft-Account in <#${verify}>.` : null,
        env.websiteUrl ? `Website: ${env.websiteUrl}` : null,
      ].filter(Boolean).join('\n') || 'Schön, dass du da bist.')],
    allowedMentions: { users: [member.id] },
  }).catch((err) => logger.warn('Willkommensnachricht:', err.message));
});

const intervals = [];
client.once(Events.ClientReady, async (c) => {
  logger.info(`Eingeloggt als ${c.user.tag} auf ${c.guilds.cache.size} Server(n).`);
  if (!api.configured) logger.warn('Website-API nicht konfiguriert (HUGO_API_URL/HUGO_API_KEY) – Wirtschafts- und Markt-Funktionen sind deaktiviert.');
  if (env.guildId && !c.guilds.cache.has(env.guildId)) logger.warn(`Bot ist nicht auf dem Server DISCORD_GUILD_ID=${env.guildId}.`);

  const every = (ms, fn, name) => {
    const run = () => fn(c).catch((err) => logger.error(`${name}:`, err));
    run();
    intervals.push(setInterval(run, ms));
  };
  every(5 * 60_000, status.tick, 'Status');
  every(env.marketFeedIntervalSeconds * 1000, marketFeed.tick, 'Markt-Feed');
  every(env.leaderboardIntervalMinutes * 60_000, leaderboards.tick, 'Ranglisten');
  intervals.push(setInterval(() => limiter.sweep(), 10 * 60_000));
});

client.on(Events.Error, (err) => logger.error('Discord-Client:', err));
process.on('unhandledRejection', (err) => logger.error('Unbehandelte Promise-Ablehnung:', err));

function shutdown(signal) {
  logger.info(`${signal} empfangen – fahre herunter.`);
  intervals.forEach(clearInterval);
  try {
    store.flush();
  } catch (err) {
    logger.error('Store konnte nicht gespeichert werden:', err);
  }
  client.destroy().finally(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(env.discordToken).catch((err) => {
  logger.error('Login fehlgeschlagen – prüfe DISCORD_TOKEN:', err.message);
  process.exit(1);
});

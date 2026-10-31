'use strict';

const fs = require('node:fs');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { discordTime, truncate } = require('../lib/embeds');
const { userMessage } = require('../lib/hugoApi');
const { emojis, withEmoji } = require('../lib/emojis');
const { card } = require('../lib/ui');
const theme = require('../config/theme');

/*
 * Admin-Panel im Discord (/panel): Seiten als private Karten. Jede Seite holt
 * ihre Daten frisch – Bot-Daten direkt aus dem Client, Konto-, Wirtschafts- und
 * Marktdaten über die Bot-API der Website. Fehlen Daten, steht ein Hinweis da,
 * es werden keine Zahlen erfunden.
 */

const PAGES = [
  { key: 'dashboard', label: 'Dashboard', icon: 'platform', description: 'Bot, Zahlen und Systemstatus' },
  { key: 'servers', label: 'Server', icon: 'general', description: 'Alle Server mit HugoPredict' },
  { key: 'users', label: 'Nutzer', icon: 'member', description: 'Registrierte Nutzer, Suche' },
  { key: 'economy', label: 'Wirtschaft', icon: 'coin', description: 'Umlauf, Ein- und Auszahlungen' },
  { key: 'markets', label: 'Märkte', icon: 'open', description: 'Aktive und entschiedene Prognosen' },
  { key: 'transactions', label: 'Transaktionen', icon: 'balance', description: 'Letzte Buchungen' },
  { key: 'activity', label: 'Aktivitäten', icon: 'announce', description: 'Ereignisse, Moderation, Fehler' },
  { key: 'bot', label: 'Bot-Verwaltung', icon: 'bot', description: 'Status, Neustart, Logs' },
  { key: 'settings', label: 'Einstellungen', icon: 'info', description: 'Konfiguration im Überblick' },
];
const USERS_PER_PAGE = 8;
const TX_TYPES = [
  ['', 'Alle'], ['deposit', 'Einzahlungen'], ['withdraw', 'Auszahlungen'], ['buy', 'Käufe'],
  ['sell', 'Verkäufe'], ['payout', 'Gewinne'], ['refund', 'Erstattungen'], ['admin', 'Korrekturen'],
];

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? nf.format(n) : '—');
const ok = (state) => emojis.icon(state === true ? 'resolved' : state === false ? 'warning' : 'closed');
const when = (iso) => (iso ? discordTime(new Date(iso), 'R') : '—');

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return [d && `${d} T`, (d || h) && `${h} Std`, `${m % 60} Min`].filter(Boolean).join(' ');
}

/** Holt Website-Daten; bei Fehlern { error } statt Ausnahme. */
async function fromWebsite(api, fn) {
  if (!api.configured) return { error: 'Die Website ist nicht verbunden (HUGO_API_URL/HUGO_API_KEY fehlen).' };
  try {
    return { data: await fn() };
  } catch (err) {
    return { error: userMessage(err) };
  }
}
const unavailable = (error) => ({ heading: 'Keine Daten', icon: 'warning', body: error });

function navRow(current) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('hm:panel:nav').setPlaceholder('Seite wählen …').addOptions(
      PAGES.map((p) => withEmoji(
        new StringSelectMenuOptionBuilder().setLabel(p.label).setValue(p.key).setDescription(p.description).setDefault(p.key === current),
        p.icon,
      )),
    ),
  );
}
const button = (id, label, style = ButtonStyle.Secondary, icon = null, disabled = false) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  return icon ? withEmoji(b, icon) : b;
};
const refresh = (page) => button(`hm:panel:go:${page}`, 'Aktualisieren', ButtonStyle.Secondary, 'check');

function page(key, { intro, blocks, extraRows = [], thumbnailUrl }) {
  const p = PAGES.find((x) => x.key === key);
  return card({
    eyebrow: `${emojis.icon('lock')}Admin-Panel`,
    title: p.label,
    icon: p.icon,
    intro,
    blocks: blocks.filter(Boolean).slice(0, 9),
    logo: false,
    thumbnailUrl,
    accent: theme.colors.primary,
    footer: `Nur für dich sichtbar · Stand ${discordTime(new Date(), 't')}`,
    actions: [navRow(key), ...extraRows],
    ephemeral: true,
  });
}

// --- Seiten -----------------------------------------------------------------

async function dashboard({ client, deps }) {
  const guilds = [...client.guilds.cache.values()];
  const members = guilds.reduce((s, g) => s + (g.memberCount ?? 0), 0);
  const site = await fromWebsite(deps.api, () => deps.api.panelSummary());
  const mc = deps.minecraft;
  const events = deps.activity?.list((e) => e.kind === 'audit').slice(0, 5) ?? [];
  return page('dashboard', {
    thumbnailUrl: client.user.displayAvatarURL({ extension: 'png', size: 128 }),
    intro: `**${client.user.tag}** ist ${client.isReady() ? 'online' : 'offline'}.`,
    blocks: [
      {
        heading: 'Bot', icon: 'bot',
        body: [
          `${ok(client.isReady())}Discord verbunden · Latenz **${client.ws.ping >= 0 ? `${Math.round(client.ws.ping)} ms` : '—'}**`,
          `Uptime **${duration(client.uptime)}**`,
        ].join('\n'),
      },
      {
        heading: 'Zahlen', icon: 'info',
        body: [
          `Server **${num(guilds.length)}** · Mitglieder **${num(members)}**`,
          site.data ? `Registrierte Minecraft-Spieler **${num(site.data.mcPlayers)}** · Konten **${num(site.data.users)}**` : `Spieler: ${site.error}`,
        ].join('\n'),
      },
      {
        heading: 'Systemstatus', icon: 'open',
        body: [
          `${ok(client.isReady())}Discord-Bot`,
          `${ok(deps.api.configured ? !site.error : null)}Website${deps.api.configured ? '' : ' · nicht verbunden'}`,
          `${ok(mc ? mc.state.online : null)}Minecraft-Bot${mc ? (mc.state.online ? ' · auf HugoSMP' : ' · getrennt') : ' · ausgeschaltet'}`,
        ].join('\n'),
      },
      {
        heading: 'Letzte Aktivitäten', icon: 'announce',
        body: events.length ? events.map((e) => `${when(e.at)} · ${truncate(e.title, 80)}`).join('\n') : 'Seit dem letzten Start noch nichts.',
      },
    ],
    extraRows: [new ActionRowBuilder().addComponents(refresh('dashboard'))],
  });
}

async function servers({ client }) {
  const guilds = [...client.guilds.cache.values()].sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0));
  const lines = guilds.slice(0, 15).map((g) => `${ok(g.available !== false)}**${truncate(g.name, 60)}** · ${num(g.memberCount)} Mitglieder · Boost-Stufe ${g.premiumTier ?? 0} · seit ${when(g.joinedTimestamp && new Date(g.joinedTimestamp).toISOString())}\n-# ID ${g.id}`);
  return page('servers', {
    intro: `HugoPredict ist auf **${num(guilds.length)}** Server${guilds.length === 1 ? '' : 'n'} aktiv.`,
    blocks: [{ body: lines.join('\n') || 'Auf keinem Server.', quote: false }, guilds.length > 15 && { text: `-# … und ${guilds.length - 15} weitere` }],
    extraRows: [new ActionRowBuilder().addComponents(refresh('servers'))],
  });
}

async function users({ deps, state }) {
  const res = await fromWebsite(deps.api, () => deps.api.panelUsers({ q: state.q, offset: state.offset, limit: USERS_PER_PAGE }));
  const rows = [];
  let blocks;
  let intro;
  if (res.error) {
    blocks = [unavailable(res.error)];
  } else {
    const { total, users: list } = res.data;
    const pageNo = Math.floor(state.offset / USERS_PER_PAGE) + 1;
    const pages = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
    intro = state.q ? `Suche nach **${truncate(state.q, 40)}**: ${num(total)} Treffer` : `${num(total)} registrierte Nutzer`;
    blocks = [{
      body: list.map((u) => [
        `**${u.mcName ?? u.username}** · ${num(u.balance)} ${deps.env.currency}`,
        `-# ${u.discordId ? `<@${u.discordId}> · ${u.discordName ?? '—'} · \`${u.discordId}\`` : 'Discord nicht verknüpft'} · registriert ${when(u.createdAt)}`,
      ].join('\n')).join('\n') || 'Keine Nutzer gefunden.',
      quote: false,
    }, { text: `-# Seite ${pageNo} von ${pages}` }];
    rows.push(new ActionRowBuilder().addComponents(
      button('hm:panel:users:prev', 'Zurück', ButtonStyle.Secondary, null, state.offset <= 0),
      button('hm:panel:users:next', 'Weiter', ButtonStyle.Secondary, null, state.offset + USERS_PER_PAGE >= total),
      button('hm:panel:search', 'Suchen', ButtonStyle.Primary, 'info'),
      ...(state.q ? [button('hm:panel:users:clear', 'Suche löschen', ButtonStyle.Secondary)] : []),
    ));
  }
  return page('users', { intro, blocks, extraRows: rows });
}

async function economy({ deps }) {
  const [sum, tx] = await Promise.all([
    fromWebsite(deps.api, () => deps.api.panelSummary()),
    fromWebsite(deps.api, () => deps.api.panelTransactions({ limit: 5 })),
  ]);
  if (sum.error) return page('economy', { blocks: [unavailable(sum.error)], extraRows: [new ActionRowBuilder().addComponents(refresh('economy'))] });
  const s = sum.data;
  const c = deps.env.currency;
  const w = s.withdrawals ?? {};
  const wLine = ['pending', 'approved', 'done', 'uncertain', 'failed']
    .filter((k) => w[k]).map((k) => `${{ pending: 'offen', approved: 'freigegeben', done: 'ausgezahlt', uncertain: 'unklar', failed: 'fehlgeschlagen' }[k]} ${num(w[k].count)} (${num(w[k].sum)})`).join(' · ');
  return page('economy', {
    intro: `Gesamtumlauf **${num((s.balances ?? 0) + (s.positionsValue ?? 0))} ${c}**`,
    blocks: [
      { heading: 'Umlauf', icon: 'coin', body: `Guthaben ${num(s.balances)} ${c}\nIn offenen Positionen ${num(s.positionsValue)} ${c}` },
      { heading: 'Handel', icon: 'open', body: `Volumen ${num(s.volume)} ${c} · ${num(s.trades)} Trades · Gebühren ${num(s.fees)} ${c}` },
      { heading: 'Ein- und Auszahlungen', icon: 'balance', body: `Einzahlungen ${num(s.deposits?.count)} · ${num(s.deposits?.sum)} ${c}${s.deposits?.unclaimed ? ` (davon ${num(s.deposits.unclaimed)} ohne Konto)` : ''}\nAuszahlungen: ${wLine || 'keine'}` },
      { heading: 'Top-Spieler nach Guthaben', icon: 'member', body: (s.top ?? []).map((u, i) => `**${i + 1}.** ${u.mcName ?? u.username} · ${num(u.balance)} ${c}`).join('\n') || 'Noch keine Spieler.' },
      { heading: 'Aktuelle Transaktionen', icon: 'info', body: tx.error ? tx.error : tx.data.transactions.map((t) => `${when(t.createdAt)} · ${t.user} · ${t.label} ${t.amount > 0 ? '+' : ''}${num(t.amount)}`).join('\n') || 'Keine.' },
    ],
    extraRows: [new ActionRowBuilder().addComponents(refresh('economy'))],
  });
}

async function markets({ deps }) {
  const res = await fromWebsite(deps.api, () => deps.api.panelMarkets());
  if (res.error) return page('markets', { blocks: [unavailable(res.error)], extraRows: [new ActionRowBuilder().addComponents(refresh('markets'))] });
  const list = res.data.markets;
  const count = (st) => list.filter((m) => m.status === st).length;
  const active = list.filter((m) => m.status === 'open' || m.status === 'closed');
  const done = list.filter((m) => m.status === 'resolved' || m.status === 'cancelled');
  const volume = list.reduce((s, m) => s + (m.volume ?? 0), 0);
  const c = deps.env.currency;
  const prices = (m) => m.outcomes.slice(0, 3).map((o) => `${truncate(o.label, 20)} ${Math.round(o.price * 100)} %`).join(' · ');
  return page('markets', {
    intro: `${num(list.length)} Märkte · Gesamtvolumen **${num(volume)} ${c}**`,
    blocks: [
      { heading: 'Statistik', icon: 'info', body: `Offen ${count('open')} · Handel beendet ${count('closed')} · Entschieden ${count('resolved')} · Storniert ${count('cancelled')}` },
      { heading: 'Aktive Märkte', icon: 'open', body: active.slice(0, 6).map((m) => `**${truncate(m.title, 70)}**${m.status === 'closed' ? ' · Handel beendet' : ''}\n-# ${prices(m)} · Volumen ${num(m.volume)} ${c}`).join('\n') || 'Keine aktiven Märkte.', quote: false },
      { heading: 'Abgeschlossene Märkte', icon: 'resolved', body: done.slice(0, 5).map((m) => `**${truncate(m.title, 70)}**\n-# ${m.status === 'cancelled' ? 'Storniert' : `Ergebnis: ${m.result ?? '—'}`} · Volumen ${num(m.volume)} ${c}`).join('\n') || 'Noch keine.', quote: false },
    ],
    extraRows: [new ActionRowBuilder().addComponents(refresh('markets'))],
  });
}

async function transactions({ deps, state }) {
  const res = await fromWebsite(deps.api, () => deps.api.panelTransactions({ type: state.txType, limit: 15 }));
  const filter = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('hm:panel:txtype').setPlaceholder('Filter').addOptions(
      TX_TYPES.map(([v, l]) => new StringSelectMenuOptionBuilder().setLabel(l).setValue(v || 'all').setDefault((state.txType || '') === v)),
    ),
  );
  return page('transactions', {
    intro: `Letzte Buchungen${state.txType ? ` · ${TX_TYPES.find(([v]) => v === state.txType)?.[1]}` : ''}`,
    blocks: [res.error ? unavailable(res.error) : {
      body: res.data.transactions.map((t) => `${when(t.createdAt)} · **${t.user}** · ${t.label} **${t.amount > 0 ? '+' : ''}${num(t.amount)}** ${deps.env.currency}`).join('\n') || 'Keine Buchungen.',
      quote: false,
    }],
    extraRows: [filter, new ActionRowBuilder().addComponents(refresh('transactions'))],
  });
}

async function activity({ client, deps }) {
  const events = deps.activity?.list((e) => e.kind === 'audit').slice(0, 8) ?? [];
  const problems = deps.activity?.list((e) => e.kind === 'warn' || e.kind === 'error').slice(0, 6) ?? [];
  const cases = [];
  for (const g of client.guilds.cache.values()) for (const c of deps.store.guild(g.id).moderation.cases ?? []) cases.push(c);
  cases.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return page('activity', {
    intro: '-# Ereignisse und Fehler seit dem letzten Bot-Start, Moderation dauerhaft.',
    blocks: [
      { heading: 'Bot-Aktivitäten', icon: 'announce', body: events.map((e) => `${when(e.at)} · ${truncate(e.title, 90)}`).join('\n') || 'Noch nichts.' },
      { heading: 'Moderation', icon: 'moderator', body: cases.slice(0, 5).map((c) => `${when(c.at)} · Fall #${c.number} · ${c.action ?? c.type ?? 'Aktion'}${c.targetId ? ` · <@${c.targetId}>` : ''}`).join('\n') || 'Keine Fälle.' },
      { heading: 'Fehler und Warnungen', icon: 'warning', body: problems.map((e) => `${when(e.at)} · ${e.kind === 'error' ? '**Fehler**' : 'Warnung'} · \`${truncate(e.title, 110)}\``).join('\n') || 'Keine. ' },
    ],
    extraRows: [new ActionRowBuilder().addComponents(refresh('activity'))],
  });
}

async function bot({ client, deps }) {
  const mc = deps.minecraft;
  const mem = Math.round(process.memoryUsage().rss / 1048576);
  return page('bot', {
    thumbnailUrl: client.user.displayAvatarURL({ extension: 'png', size: 128 }),
    intro: `**${client.user.tag}** · Version \`${deps.version ?? 'unbekannt'}\``,
    blocks: [
      { heading: 'Discord-Verbindung', icon: 'bot', body: `${ok(client.isReady())}${client.isReady() ? 'Verbunden' : 'Getrennt'} · Latenz ${client.ws.ping >= 0 ? `${Math.round(client.ws.ping)} ms` : '—'} · Uptime ${duration(client.uptime)}` },
      { heading: 'Minecraft-Verbindung', icon: 'external', body: mc ? `${ok(mc.state.online)}${mc.state.online ? `Auf HugoSMP seit ${when(mc.state.since && new Date(mc.state.since).toISOString())}` : `Getrennt${mc.state.lastError ? ` · ${truncate(mc.state.lastError, 120)}` : ''}`}` : `${ok(null)}Ausgeschaltet (MC_ENABLED)` },
      { heading: 'Prozess', icon: 'info', body: `Speicher ${mem} MB · Node ${process.version} · ${process.env.pm_id !== undefined ? `pm2 (Neustarts: ${process.env.restart_time ?? '—'})` : 'ohne pm2'}` },
      { heading: 'Starten und Stoppen', icon: 'lock', body: 'Ein gestoppter Bot kann keine Befehle mehr empfangen. Darum gibt es hier nur **Neu starten** – pm2 startet HugoPredict sofort wieder. Andere Bots auf dem Server sind nicht betroffen.' },
    ],
    extraRows: [new ActionRowBuilder().addComponents(
      button('hm:panel:restart', 'Neu starten', ButtonStyle.Danger, 'warning'),
      button('hm:panel:logs:out', 'Logs', ButtonStyle.Secondary, 'info'),
      button('hm:panel:logs:err', 'Fehlerprotokoll', ButtonStyle.Secondary, 'error'),
      refresh('bot'),
    )],
  });
}

async function settings({ deps }) {
  const e = deps.env;
  const mc = e.minecraft;
  return page('settings', {
    intro: '-# Nur lesend. Ändern über die .env auf dem Server.',
    blocks: [
      { heading: 'Website', icon: 'external', body: `API ${deps.api.configured ? 'verbunden' : 'nicht verbunden'} · Adresse ${e.websiteUrl || '—'}\nPrognosen-Abgleich alle ${e.marketFeedIntervalSeconds} s · höchstens ${e.marketFeedMaxMarkets} Karten` },
      { heading: 'Minecraft-Bot', icon: 'coin', body: mc.enabled ? `Server ${mc.host}:${mc.port} · Konto ${mc.account ? mc.account.replace(/^(.).*(@.*)$/, '$1…$2') : '—'}\nKontostand-Prüfung ${mc.balanceCheck === false ? 'aus' : 'an'} · Auszahlungen ${mc.payoutsEnabled ? `an (max. ${num(mc.payoutMax)})` : 'aus'}` : 'Ausgeschaltet' },
      { heading: 'Zugriff', icon: 'lock', body: `/panel erlaubt für: ${e.panelAdminIds.map((id) => `<@${id}>`).join(', ') || '—'}` },
      { heading: 'Allgemein', icon: 'info', body: `Währung ${e.currency} · Tickets je Person ${e.maxOpenTicketsPerUser} · Log-Stufe ${e.logLevel}` },
    ],
    extraRows: [new ActionRowBuilder().addComponents(refresh('settings'))],
  });
}

/** Letzte Zeilen aus dem pm2-Log dieses Bots (nur lesen, keine Befehle). */
function readLogTail(kind, { maxBytes = 16_384, lines = 25 } = {}) {
  const file = kind === 'err' ? process.env.pm_err_log_path : process.env.pm_out_log_path;
  if (!file || !fs.existsSync(file)) return null;
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    // eslint-disable-next-line no-control-regex
    return buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(-lines);
  } finally {
    fs.closeSync(fd);
  }
}

async function logs(ctx, kind) {
  const lines = readLogTail(kind);
  let text = lines ? lines.map((l) => truncate(l, 160)).join('\n') : null;
  if (text && text.length > 3000) text = text.slice(-3000);
  return page('bot', {
    intro: kind === 'err' ? 'Fehlerprotokoll (letzte Zeilen)' : 'Logs (letzte Zeilen)',
    blocks: [{ text: lines ? (text ? `\`\`\`\n${text.replace(/```/g, "'''")}\n\`\`\`` : 'Leer.') : 'Kein Log verfügbar – der Bot läuft nicht unter pm2.' }],
    extraRows: [new ActionRowBuilder().addComponents(button('hm:panel:go:bot', 'Zurück zur Bot-Verwaltung', ButtonStyle.Secondary), button(`hm:panel:logs:${kind}`, 'Aktualisieren', ButtonStyle.Secondary, 'check'))],
  });
}

function restartConfirm() {
  return page('bot', {
    intro: '**HugoPredict wirklich neu starten?**\nDer Bot ist für einige Sekunden offline. Andere Bots auf dem Server laufen weiter.',
    blocks: [],
    extraRows: [new ActionRowBuilder().addComponents(
      button('hm:panel:restartok', 'Ja, neu starten', ButtonStyle.Danger, 'warning'),
      button('hm:panel:go:bot', 'Abbrechen', ButtonStyle.Secondary),
    )],
  });
}

const BUILDERS = { dashboard, servers, users, economy, markets, transactions, activity, bot, settings };

async function buildPage(key, ctx) {
  return (BUILDERS[key] ?? dashboard)(ctx);
}

module.exports = { PAGES, buildPage, logs, restartConfirm, readLogTail, duration, USERS_PER_PAGE };

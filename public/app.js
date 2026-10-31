import * as lmsr from '/lmsr.js';

// ---------- Helpers ----------

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const fmt = (n) => nf.format(Number(n) || 0);
// Kurz wie im Spiel: 950 · 1,5k · 10k · 2,3m · 1b (abgerundet, nie zu viel angezeigt)
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
function short(n) {
  const v = Number(n) || 0, a = Math.abs(v);
  for (const [unit, size] of [['t', 1e12], ['b', 1e9], ['m', 1e6], ['k', 1e3]]) {
    if (a >= size) return `${a / size >= 100 ? Math.trunc(v / size) : nf1.format(Math.trunc((v / size) * 10) / 10)}${unit}`;
  }
  return fmt(v);
}
const money = (n) => `${short(n)} $`;
const pct = (p) => (p < 0.005 ? '<1 %' : p > 0.995 ? '>99 %' : `${Math.round(p * 100)} %`);
const cents = (p) => `${Math.max(1, Math.min(99, Math.round(p * 100)))}¢`;
const df = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const date = (t) => df.format(new Date(t));
const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
const ago = (t) => {
  const s = (t - Date.now()) / 1000;
  if (s > -60) return 'gerade eben';
  if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
  if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
};
const head = (name, cls = '') =>
  name
    ? `<img class="head ${cls}" src="https://mc-heads.net/avatar/${encodeURIComponent(name)}/32" width="32" height="32" alt="" loading="lazy">`
    : `<span class="head ${cls}"></span>`;

const CATS = { all: 'Alle', clan: 'Clan Fights', meta: 'Meta', server: 'Server', irl: 'Echte Welt' };
const LEDGER = {
  deposit: 'Einzahlung', withdraw: 'Auszahlung', withdraw_refund: 'Auszahlung zurückgebucht', buy: 'Gekauft', sell: 'Verkauft',
  payout: 'Gewinn', refund: 'Erstattung', admin: 'Admin-Buchung',
};
const STATUS = { open: ['Läuft', 'live'], closed: ['Handel beendet', 'warn'], resolved: ['Entschieden', ''], cancelled: ['Storniert', 'bad'] };

const WITHDRAW_STATUS = { pending: 'Wartet auf Freigabe', approved: 'Freigegeben', processing: 'Wird ausgezahlt', uncertain: 'Unklar, ingame prüfen', done: 'Ausgezahlt', failed: 'Fehlgeschlagen', cancelled: 'Storniert' };

const state = { me: null, status: null, filter: { category: 'all', status: 'open' }, markets: [], search: '' };

async function api(path, body) {
  const res = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Der Server antwortet nicht. Lade die Seite neu.');
  return data;
}

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

// Restzeit statt Datum: „Endet in 2 Tagen“, „Endet heute 20:00“ – knapp (unter 24 h) wird orange
const tf = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
function remaining(t) {
  if (!t) return { text: '', soon: false };
  const ms = t - Date.now();
  if (ms <= 0) return { text: 'Handel beendet', soon: false };
  const d = new Date(t), today = new Date(), tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  let text;
  if (ms < 3600e3) text = `Endet in ${Math.max(1, Math.round(ms / 60e3))} Min.`;
  else if (sameDay(d, today)) text = `Endet heute ${tf.format(d)}`;
  else if (sameDay(d, tomorrow)) text = `Endet morgen ${tf.format(d)}`;
  else if (ms < 7 * 86400e3) text = `Endet in ${Math.ceil(ms / 86400e3)} Tagen`;
  else text = `Endet am ${date(t)}`;
  return { text, soon: ms < 86400e3 };
}
const endsBadge = (t) => { const r = remaining(t); return r.text ? `<span class="ends${r.soon ? ' soon' : ''}">${r.text}</span>` : ''; };

const isBinary = (m) => m.outcomes.length === 2 && /^ja$/i.test(m.outcomes[0].label) && /^nein$/i.test(m.outcomes[1].label);
const sortedOutcomes = (m) => (isBinary(m) ? m.outcomes : [...m.outcomes].sort((a, b) => b.price - a.price));

// ---------- Header ----------

async function refreshMe() {
  const [{ user }, status] = await Promise.all([api('/me'), api('/status')]);
  state.me = user;
  state.status = status;
  renderHeader();
}

function renderHeader() {
  const me = state.me;
  document.getElementById('account').innerHTML = me
    ? `<a href="#/wallet" class="purse" aria-label="Guthaben ${money(me.balance)}"><small>Guthaben</small><b>${money(me.balance)}</b></a>
       <a href="#/wallet" aria-label="Wallet von ${esc(me.mcName || me.username)}">${head(me.mcName || me.username)}</a>
       <button class="btn btn-quiet btn-sm" id="logout">Abmelden</button>`
    : '<a class="btn btn-ja btn-sm" href="#/login">Anmelden</a>';
  document.getElementById('logout')?.addEventListener('click', async () => {
    await api('/logout', {});
    state.me = null;
    renderHeader();
    location.hash = '#/';
  });
  document.getElementById('nav-admin').classList.toggle('hidden', !me?.isAdmin);
  const bs = document.getElementById('bot-status');
  bs.classList.toggle('on', !!state.status?.botOnline);
  bs.textContent = state.status?.botOnline
    ? `Bot ${state.status.botName} ist auf Hugo SMP online`
    : 'Bot offline: Auszahlungen warten, bis er zurück ist';
}

// ---------- Router ----------

const routes = [
  [/^\/?$/, viewMarkets, 'markets'],
  [/^\/market\/(\d+)$/, viewMarket, 'markets'],
  [/^\/portfolio$/, viewPortfolio, 'portfolio'],
  [/^\/wallet$/, viewWallet, 'wallet'],
  [/^\/leaderboard$/, viewLeaderboard, 'leaderboard'],
  [/^\/player\/([^/]+)$/, viewPlayer, 'leaderboard'],
  [/^\/admin$/, viewAdmin, 'admin'],
  [/^\/login$/, viewLogin, ''],
];

const SKELETON = `<div class="skel-page" aria-busy="true" aria-label="Lädt…">
  <div class="skel skel-title"></div><div class="skel skel-line"></div>
  <div class="grid" style="margin-top:20px">${'<div class="skeleton"></div>'.repeat(4)}</div></div>`;

async function router() {
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  for (const [re, view, nav] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('#nav a').forEach((a) => {
      if (a.dataset.route === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      a.classList.toggle('active', a.dataset.route === nav);
    });
    window.scrollTo(0, 0);
    // Lädt eine Seite länger, erscheint ein Platzhalter statt einer leeren Fläche
    const loading = setTimeout(() => { app.innerHTML = SKELETON; }, 150);
    try {
      await view(...m.slice(1), new URLSearchParams(query));
    } catch (err) {
      app.innerHTML = `<div class="panel empty"><p>${esc(err.message)}</p><a class="btn" href="#/">Zu den Prognosen</a></div>`;
    } finally {
      clearTimeout(loading);
    }
    return;
  }
  app.innerHTML = '<div class="panel empty"><h1>Seite nicht gefunden</h1><a class="btn" href="#/">Zu den Märkten</a></div>';
}

function needLogin(what) {
  if (state.me) return false;
  app.innerHTML = `<div class="panel empty"><h1>Melde dich an</h1><p>${what}</p>
    <a class="btn btn-ja" href="#/login">Mit Minecraft anmelden</a></div>`;
  return true;
}

// ---------- Shared pieces ----------

const yesLike = (m, o) => !isBinary(m) || o.id === m.outcomes[0].id;

function chart(m) {
  const W = 720, H = 280, P = { l: 0, r: 92, t: 30, b: 56 };
  const h = m.history;
  const series = isBinary(m) ? [0] : m.outcomes.map((_, i) => i);
  const t0 = h[0].t, t1 = Math.max(h.at(-1).t, t0 + 1);
  const x = (t) => P.l + ((t - t0) / (t1 - t0)) * (W - P.l - P.r);
  const y = (p) => P.t + (1 - p) * (H - P.t - P.b);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => `
    <line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 5"/>
    <text x="${W - 4}" y="${y(g) + 4}" text-anchor="end">${g * 100}&nbsp;%</text>`).join('');
  const lines = series.map((i) => {
    const pts = h.map((pt, k) => {
      const px = x(pt.t).toFixed(1);
      return `${k ? `${px},${y(h[k - 1].p[i]).toFixed(1)} ` : ''}${px},${y(pt.p[i]).toFixed(1)}`;
    }).join(' ');
    const c = isBinary(m) ? 'var(--blue)' : m.outcomes[i].color, last = h.at(-1);
    return `<polyline class="chart-line" pathLength="1" points="${pts}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>
      <circle class="chart-dot" cx="${x(last.t)}" cy="${y(last.p[i])}" r="4" fill="${c}"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf der Wahrscheinlichkeiten seit ${date(t0)}">${grid}${lines}
    <text x="${P.l}" y="${H - 6}">${date(t0)}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">jetzt</text></svg>`;
}

function gauge(p) {
  const color = p >= 0.5 ? 'var(--yes)' : 'var(--no)';
  return `<span class="gauge" role="img" aria-label="${pct(p)} Chance auf Ja">
    <svg viewBox="0 0 60 34" aria-hidden="true">
      <path d="M5 30a25 25 0 0 1 50 0" pathLength="100" fill="none" stroke="var(--line)" stroke-width="5"/>
      <path class="gauge-fill" d="M5 30a25 25 0 0 1 50 0" pathLength="100" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="${(p * 100).toFixed(1)} 100"/>
    </svg><b>${pct(p)}</b><small>Chance</small></span>`;
}

// ---------- Markets ----------

function marketCard(m, i = 0) {
  const bin = isBinary(m);
  const [label, cls] = STATUS[m.status];
  const winner = m.outcomes.find((o) => o.id === m.resolvedOutcomeId);
  let body;
  if (bin) {
    const [ja, nein] = m.outcomes;
    body = m.status === 'open'
      ? `<div class="actions"><a class="btn btn-yes" href="#/market/${m.id}?o=${ja.id}">Auf Ja bieten</a>
          <a class="btn btn-no" href="#/market/${m.id}?o=${nein.id}">Auf Nein bieten</a></div>`
      : winner ? `<p class="result">Ergebnis: <b class="${winner === ja ? 'ja' : 'nein'}">${esc(winner.label)}</b></p>` : '';
  } else {
    const top = sortedOutcomes(m).slice(0, 3);
    body = `${m.status === 'open' ? `<div class="big-pct"><b>${pct(top[0].price)}</b><span>${esc(top[0].label)}</span></div>` : ''}<div class="mini">${top.map((o) => `
        <a class="mini-row" href="#/market/${m.id}?o=${o.id}"><span>${o.id === m.resolvedOutcomeId ? 'Gewonnen: ' : ''}${esc(o.label)}</span><b>${pct(o.price)}</b></a>`).join('')}
        ${m.outcomes.length > 3 ? `<span class="muted more">und ${m.outcomes.length - 3} weitere</span>` : ''}</div>`;
  }
  return `<article class="card${m.status === 'open' ? '' : ' done'}" style="--i:${Math.min(i, 11)}">
    <div class="card-top"><span class="slot" aria-hidden="true">${esc(m.emoji)}</span>
      <h3><a href="#/market/${m.id}">${esc(m.title)}</a></h3>${bin ? gauge(m.outcomes[0].price) : ''}</div>
    ${body}
    <div class="foot-line">
      <span class="bidders">${(m.bidders || []).map((n) => head(n, 'xs')).join('')}${m.bidderCount > 3 ? `<small>+${m.bidderCount - 3}</small>` : ''}<span>${money(m.volume)}</span></span>
      <span>${m.status === 'open' ? endsBadge(m.closesAt) : `<span class="tag ${cls}">${label}</span>`}</span></div>
  </article>`;
}

function renderGrid() {
  const el = document.getElementById('markets');
  if (!el) return;
  const q = state.search.trim().toLowerCase();
  const list = state.markets.filter((m) => !q || m.title.toLowerCase().includes(q));
  el.innerHTML = list.length
    ? list.map(marketCard).join('')
    : `<div class="panel empty" style="grid-column:1/-1"><p>${q ? `Kein Markt passt zu „${esc(state.search)}“.` : 'In dieser Kategorie gibt es gerade keine Märkte.'}</p>
        <button class="btn btn-sm" type="button" id="reset-filter">Alle Märkte zeigen</button></div>`;
  document.getElementById('reset-filter')?.addEventListener('click', () => {
    state.filter = { category: 'all', status: 'open' };
    state.search = '';
    document.getElementById('search').value = '';
    viewMarkets();
  });
}

async function viewMarkets() {
  app.innerHTML = `
    <section class="feature" id="feature" aria-label="Meistgehandelter Markt"><div class="skeleton" style="grid-column:1/-1"></div></section>
    <div class="filters" id="filters" role="toolbar" aria-label="Märkte filtern">
      ${Object.entries(CATS).map(([k, v]) => `<button type="button" data-cat="${k}" aria-pressed="${state.filter.category === k}">${v}</button>`).join('')}
      <span class="gap"></span>
      <button type="button" data-st="open" aria-pressed="${state.filter.status === 'open'}">Laufend</button>
      <button type="button" data-st="done" aria-pressed="${state.filter.status === 'done'}">Entschieden</button>
    </div>
    <div class="grid" id="markets">${'<div class="skeleton"></div>'.repeat(6)}</div>`;

  document.getElementById('filters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cat) state.filter.category = b.dataset.cat;
    if (b.dataset.st) state.filter.status = b.dataset.st;
    viewMarkets();
  });

  const [{ markets }, { markets: open }] = await Promise.all([
    api(`/markets?category=${state.filter.category}&status=${state.filter.status}`),
    api('/markets?status=open'),
  ]);
  state.markets = markets;
  renderGrid();

  const featureEl = document.getElementById('feature');
  // Oben: die vom Admin hervorgehobene Prognose, sonst die mit dem meisten Volumen
  const top = open.find((m) => m.featured) ?? [...open].sort((a, b) => b.volume - a.volume)[0];
  if (!top) { featureEl.remove(); return; }
  const { market: m } = await api(`/markets/${top.id}`);
  const lead = sortedOutcomes(m)[0];
  featureEl.innerHTML = `
    <div class="feature-q">
      <div class="lead"><span class="slot lg" aria-hidden="true">${esc(m.emoji)}</span>
        <div><div class="meta"><span>${CATS[m.category]}</span><span>${money(m.volume)} Volumen</span>${endsBadge(m.closesAt)}</div>
          <h1><a href="#/market/${m.id}">${esc(m.title)}</a></h1></div></div>
      <div class="odds-big"><b class="${yesLike(m, lead) ? 'blue' : ''}">${pct(lead.price)}</b><span class="muted">${isBinary(m) ? 'Chance auf Ja' : `für ${esc(lead.label)}`}</span></div>
      <div class="feature-outcomes">${sortedOutcomes(m).slice(0, 4).map((o, i) => `<a class="btn ${isBinary(m) ? (i ? 'btn-no' : 'btn-yes') : ''}" href="#/market/${m.id}?o=${o.id}">${esc(o.label)} ${cents(o.price)}</a>`).join('')}</div>
    </div>
    <div class="feature-chart">${chart(m)}</div>`;
}

// ---------- Market detail ----------

async function viewMarket(id, query) {
  const { market: m } = await api(`/markets/${id}`);
  const bin = isBinary(m);
  const open = m.status === 'open';
  const byId = Object.fromEntries(m.outcomes.map((o) => [o.id, o]));
  const [label, cls] = STATUS[m.status];
  const lead = sortedOutcomes(m)[0];
  const trade = { side: 'buy', outcomeId: byId[Number(query.get('o'))] ? Number(query.get('o')) : lead.id, amount: '' };

  app.innerHTML = `
    <a href="#/" class="back">Alle Märkte</a>
    <div class="market">
      <div class="stack">
        <section class="detail">
          <div class="market-head"><span class="slot lg" aria-hidden="true">${esc(m.emoji)}</span><div>
            <h1>${esc(m.title)}</h1>
            <div class="meta"><span>${CATS[m.category]}</span><span class="tag ${cls}">${label}</span><span>${money(m.volume)} Volumen</span>
              ${m.closesAt && m.status === 'open' ? endsBadge(m.closesAt) : ''}</div></div>
            <button class="btn btn-sm share" type="button" id="share" aria-label="Prognose teilen">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Teilen</button></div>
          <div class="odds-big"><b class="blue">${pct(lead.price)}</b><span class="muted">${bin ? 'Chance auf Ja' : `für ${esc(lead.label)}`}</span></div>
          ${bin ? '' : `<div class="legend">${m.outcomes.map((o) => `<span style="--c:${o.color}">${esc(o.label)} ${pct(o.price)}</span>`).join('')}</div>`}
          ${chart(m)}
        </section>

        ${bin ? '' : `<section class="panel"><h2>Alle Ausgänge</h2>
          <div class="rows">${sortedOutcomes(m).map((o) => `
            <div class="outcome-row${o.id === m.resolvedOutcomeId ? ' won' : ''}"><span class="outcome-name">${esc(o.label)}</span><b>${pct(o.price)}</b>
              ${open ? `<button class="btn btn-yes btn-sm" type="button" data-o="${o.id}">Kaufen ${cents(o.price)}</button>` : ''}</div>`).join('')}</div>
        </section>`}

        ${m.description ? `<section class="panel"><h2>So wird entschieden</h2><p class="rules">${esc(m.description)}</p></section>` : ''}

        <section class="panel"><h2>Letzte Trades</h2>
          ${m.recent.length ? `<div class="feed">${m.recent.map((t) => `
            <div class="feed-row">${head(t.username, 'sm')}<span><a href="${playerLink(t.username)}" style="text-decoration:none"><b>${esc(t.username)}</b></a> ${t.side === 'buy'
                ? `bot <b>${money(t.amount)}</b> auf <b>${esc(byId[t.outcome_id]?.label)}</b>`
                : `verkaufte <b>${esc(byId[t.outcome_id]?.label)}</b> für <b>${money(t.amount)}</b>`}</span>
              <span class="when">${ago(t.created_at)}</span></div>`).join('')}</div>`
            : '<p class="muted">Noch hat niemand gehandelt. Der erste Trade bewegt den Preis am stärksten.</p>'}
        </section>
      </div>

      <aside class="stack side">
        <section class="trader" id="trade" aria-label="Handeln"></section>
        ${m.positions.length ? `<section class="panel"><h2>Deine Anteile</h2><div class="holdings">
          ${m.positions.map((p) => `<div><b>${esc(byId[p.outcome_id].label)}</b>
            <span>${fmt(p.shares)} Anteile, wert ${money(p.shares * byId[p.outcome_id].price)}</span></div>`).join('')}</div></section>` : ''}
      </aside>
    </div>`;
  document.getElementById('share')?.addEventListener('click', async () => {
    const url = `${location.origin}/m/${m.id}`;
    try {
      if (navigator.share) await navigator.share({ title: m.title, text: `${m.emoji} ${m.title}`, url });
      else { await navigator.clipboard.writeText(url); toast('Link kopiert – in Discord einfügen, dort erscheint eine Vorschau.'); }
    } catch {
      // Teilen abgebrochen
    }
  });

  app.querySelectorAll('.outcome-row [data-o]').forEach((b) => b.addEventListener('click', () => {
    Object.assign(trade, { side: 'buy', outcomeId: Number(b.dataset.o) });
    renderTrade();
    document.getElementById('trade').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  const qs = m.outcomes.map((o) => o.q);
  const fee = state.status?.fee ?? 0;
  const el = document.getElementById('trade');

  function renderTrade() {
    if (!open) {
      const w = byId[m.resolvedOutcomeId];
      el.innerHTML = `<h2>${label}</h2><p class="muted">${
        m.status === 'resolved' ? `Gewonnen hat <b class="ja">${esc(w.label)}</b>. Die Gewinne wurden automatisch gutgeschrieben.`
        : m.status === 'cancelled' ? 'Dieser Markt wurde storniert. Alle Einsätze wurden erstattet.'
        : 'Der Handel ist beendet. Sobald das Ergebnis feststeht, wird der Markt entschieden und ausgezahlt.'}</p>`;
      return;
    }
    const idx = m.outcomes.findIndex((o) => o.id === trade.outcomeId);
    const o = m.outcomes[idx];
    const pos = m.positions.find((p) => p.outcome_id === o.id);
    const buying = trade.side === 'buy';

    el.innerHTML = `
      <div class="seg" role="group" aria-label="Kaufen oder verkaufen">
        <button type="button" data-side="buy" aria-pressed="${buying}">Kaufen</button>
        <button type="button" data-side="sell" aria-pressed="${!buying}">Verkaufen</button></div>
      <div class="pick${bin ? '' : ' pick-many'}" role="group" aria-label="Ausgang wählen">
        ${sortedOutcomes(m).map((x) => `<button type="button" class="${bin ? (x.id === m.outcomes[0].id ? 'p-yes' : 'p-no') : 'p-yes'}" data-pick="${x.id}" aria-pressed="${x.id === o.id}"><span>${esc(x.label)}</span> <b>${cents(x.price)}</b></button>`).join('')}</div>
      <label class="amount" for="amt"><span>${buying ? 'Betrag' : `Anteile (du hast ${fmt(pos?.shares || 0)})`}</span>
        <span class="amount-in"><input id="amt" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(trade.amount)}">${buying ? '<i>$</i>' : ''}</span></label>
      <div class="quick">${(buying ? ['+1', '+20', '+100', 'Max'] : ['25 %', '50 %', 'Alle']).map((q) => `<button type="button" data-q="${q}">${q}</button>`).join('')}</div>
      <dl class="receipt" id="receipt"></dl>
      <p class="why" id="why" role="alert"></p>
      ${state.me
        ? `<button class="btn btn-primary btn-block" id="go" type="button">${buying ? `${esc(o.label)} kaufen` : `${esc(o.label)} verkaufen`}</button>
           <p class="note">Guthaben ${money(state.me.balance)}, Gebühr ${fmt(fee * 100)}&nbsp;%</p>`
        : '<a class="btn btn-primary btn-block" href="#/login">Anmelden, um zu handeln</a>'}`;

    const input = el.querySelector('#amt');
    const update = () => {
      const amt = Number(input.value.replace(',', '.')) || 0;
      let rows = '', why = '';
      trade.amount = input.value;
      if (buying) {
        const out = amt > 0 ? lmsr.sharesForAmount(qs, m.b, idx, amt * (1 - fee)) : 0;
        const after = qs.slice(); after[idx] += out;
        rows = `<div><dt>Durchschnittspreis</dt><dd>${out ? `${fmt((amt / out) * 100)}¢` : cents(o.price)}</dd></div>
          <div><dt>Chance danach</dt><dd>${pct(lmsr.prices(after, m.b)[idx])}</dd></div>
          <div class="win"><dt>Zu gewinnen</dt><dd>${money(out)}</dd></div>`;
        if (state.me && amt > state.me.balance) why = `Du hast nur ${money(state.me.balance)}. Zahl ingame mehr ein.`;
        else if (amt > 0 && amt < 1) why = 'Der Mindesteinsatz ist 1 $.';
      } else {
        const sh = Math.min(amt, pos?.shares || 0);
        const out = sh > 0 ? lmsr.sellValue(qs, m.b, idx, sh) * (1 - fee) : 0;
        rows = `<div class="win"><dt>Du bekommst</dt><dd>${money(out)}</dd></div>`;
        if (amt > (pos?.shares || 0) + 1e-6) why = pos ? `Du hast nur ${fmt(pos.shares)} Anteile.` : `Du hast keine Anteile von ${o.label}.`;
      }
      el.querySelector('#receipt').innerHTML = rows;
      el.querySelector('#why').textContent = why;
      const go = el.querySelector('#go');
      if (go) go.disabled = !(amt > 0) || !!why;
      return amt;
    };
    input.addEventListener('input', update);
    update();

    el.querySelectorAll('[data-side]').forEach((b) => b.onclick = () => { trade.side = b.dataset.side; trade.amount = ''; renderTrade(); });
    el.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { trade.outcomeId = Number(b.dataset.pick); renderTrade(); });
    el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => {
      const q = b.dataset.q, cur = Number(input.value.replace(',', '.')) || 0;
      if (buying) input.value = q === 'Max' ? Math.floor((state.me?.balance || 0) * 100) / 100 : cur + Number(q.slice(1));
      else input.value = Math.floor((pos?.shares || 0) * (q === 'Alle' ? 1 : parseInt(q, 10) / 100) * 100) / 100;
      update();
    });
    el.querySelector('#go')?.addEventListener('click', async (e) => {
      const amt = update();
      e.target.disabled = true;
      e.target.textContent = buying ? 'Wird gekauft…' : 'Wird verkauft…';
      try {
        if (buying) {
          const r = await api(`/markets/${m.id}/buy`, { outcomeId: o.id, amount: amt });
          toast(`Gebot steht: ${money(amt)} auf ${o.label}`);
          confetti();
        } else {
          const r = await api(`/markets/${m.id}/sell`, { outcomeId: o.id, shares: Math.min(amt, pos.shares) });
          toast(`${o.label} verkauft für ${money(r.payout)}`);
        }
        await refreshMe();
        viewMarket(id, new URLSearchParams(`o=${o.id}`));
      } catch (err) {
        toast(err.message, true);
        renderTrade();
      }
    });
  }
  renderTrade();
}

// ---------- Portfolio ----------

async function viewPortfolio() {
  if (needLogin('Im Portfolio siehst du deine Anteile und jede Buchung.')) return;
  const [{ positions, ledger }, { markets }] = await Promise.all([api('/portfolio'), api('/markets?category=all&status=all')]);
  const titles = Object.fromEntries(markets.map((m) => [String(m.id), m.title]));
  const value = positions.reduce((a, p) => a + p.value, 0);
  const spent = positions.reduce((a, p) => a + p.spent, 0);
  const diff = value - spent;
  app.innerHTML = `
    <div class="page-title"><div><h1>Portfolio</h1><p>Deine laufenden Wetten und alle Buchungen</p></div></div>
    <div class="split-2" style="margin-bottom:20px">
      <section class="panel"><h2 class="muted" style="font-size:16px;font-family:var(--body);font-weight:500">Wert deiner Anteile</h2>
        <p class="balance">${money(value)}</p><p class="${diff >= 0 ? 'ja' : 'nein'}">${diff >= 0 ? '+' : ''}${money(diff)} seit dem Kauf</p></section>
      <section class="panel"><h2 class="muted" style="font-size:16px;font-family:var(--body);font-weight:500">Freies Guthaben</h2>
        <p class="balance" style="color:var(--text)">${money(state.me.balance)}</p><a href="#/wallet">Ein- und auszahlen</a></section>
    </div>
    <section class="panel" style="margin-bottom:20px"><h2>Anteile</h2>
      ${positions.length ? `<div class="table-wrap"><table class="table stackable"><thead><tr><th>Markt</th><th>Ausgang</th><th class="r">Anteile</th><th class="r">Chance</th><th class="r">Wert</th><th class="r">Gewinn/Verlust</th></tr></thead><tbody>
        ${positions.map((p) => `<tr><td class="title"><a href="#/market/${p.market_id}">${esc(p.title)}</a></td>
          <td data-label="Ausgang"><b style="color:${p.color}">${esc(p.label)}</b></td><td class="r" data-label="Anteile">${fmt(p.shares)}</td>
          <td class="r" data-label="Chance">${pct(p.price)}</td><td class="r" data-label="Wert">${money(p.value)}</td>
          <td class="r ${p.value - p.spent >= 0 ? 'ja' : 'nein'}" data-label="Gewinn/Verlust">${p.value - p.spent >= 0 ? '+' : ''}${money(p.value - p.spent)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><p>Du hast noch keine Anteile.</p><a class="btn btn-ja" href="#/">Markt aussuchen</a></div>'}
    </section>
    <section class="panel"><h2>Buchungen</h2>
      ${ledger.length ? `<div class="table-wrap"><table class="table"><tbody>${ledger.map((l) => `
        <tr><td><b>${LEDGER[l.type] || esc(l.type)}</b>${l.ref?.startsWith('m#') ? `<br><a class="muted" href="#/market/${l.ref.slice(2)}">${esc(titles[l.ref.slice(2)] || `Markt ${l.ref.slice(2)}`)}</a>` : ''}
          <br><small class="muted">${ago(l.created_at)}</small></td>
        <td class="r ${l.amount >= 0 ? 'ja' : 'nein'}" style="white-space:nowrap"><b>${l.amount >= 0 ? '+' : ''}${money(l.amount)}</b></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Noch keine Buchungen. Deine erste Einzahlung erscheint hier.</p>'}
    </section>`;
}

// ---------- Wallet ----------

async function viewWallet() {
  if (needLogin('In der Wallet zahlst du Ingame-Geld ein und wieder aus.')) return;
  await refreshMe();
  const me = state.me, s = state.status;
  const { withdrawals } = me.mcName ? await api('/withdrawals') : { withdrawals: [] };
  const wStatus = { pending: [s.payoutsNeedApproval ? 'Wartet auf Freigabe' : 'Wartet', 'warn'], approved: [s.payoutsNeedApproval ? 'Freigegeben' : 'Wird gleich ausgezahlt', 'warn'], processing: ['Wird ausgezahlt', 'warn'], uncertain: ['Wird vom Team geprüft', 'warn'], done: ['Ausgezahlt', 'live'], failed: ['Fehlgeschlagen, zurückgebucht', 'bad'], cancelled: ['Storniert', ''] };

  app.innerHTML = `
    <div class="page-title"><div><h1>Wallet</h1><p>Ein- und Auszahlungen laufen über den Bot <b translate="no">${esc(s.botName)}</b> auf Hugo SMP</p></div>
      <span class="tag ${s.botOnline ? 'live' : 'bad'}">${s.botOnline ? 'Bot online' : 'Bot offline'}</span></div>
    <div class="split-2">
      <div class="stack">
        <section class="panel"><h2 class="muted" style="font-size:16px;font-family:var(--body);font-weight:500">Guthaben</h2>
          <p class="balance">${money(me.balance)}</p>
          <p class="muted">${me.mcName ? `Verknüpft mit <b style="color:var(--text)">${esc(me.mcName)}</b>` : 'Noch kein Minecraft-Account verknüpft'}</p>
          <button class="btn btn-quiet btn-sm show-sm" type="button" id="logout-wallet" style="margin-top:8px;padding-left:0">Abmelden</button></section>
        ${me.mcName ? `
        <section class="panel"><h2>Einzahlen</h2>
          <p class="muted">Schick dem Bot auf Hugo SMP Geld. Er schreibt es dir gut, sobald er die Zahlung sieht.</p>
          <div class="cmd"><code translate="no">${esc(s.payCommand)}</code>
            <button class="btn btn-sm" type="button" data-copy="${esc(s.payCommand.replace(' <Betrag>', ' '))}">Kopieren</button></div>
        </section>` : ''}
      </div>
      <div class="stack">
        <section class="panel"><h2>Auszahlen</h2>
          ${me.mcName ? `
            <form id="wd-form">
              <div class="field"><label for="wd">Betrag in Dollar, mindestens ${s.minWithdraw}</label>
                <input class="input" id="wd" name="amount" inputmode="numeric" autocomplete="off" placeholder="z.B. 250…"></div>
              <div style="display:flex;gap:8px"><button class="btn btn-gold" style="flex:1">Auszahlung anfordern</button>
                <button class="btn" type="button" id="wd-all">Alles</button></div>
            </form>
            <p class="muted" style="font-size:14px;margin-top:12px">Der Bot zahlt an <b style="color:var(--text)">${esc(me.mcName)}</b> aus${s.payoutsNeedApproval ? ', sobald das Team die Auszahlung freigegeben hat' : s.botOnline ? ', meist innerhalb weniger Sekunden' : ', sobald er wieder online ist'}.</p>`
          : '<p class="muted">Verknüpfe zuerst deinen Minecraft-Account.</p>'}
        </section>
        ${withdrawals.length ? `<section class="panel"><h2>Deine Auszahlungen</h2><div class="table-wrap"><table class="table"><tbody>
          ${withdrawals.map((w) => `<tr><td>${money(w.amount)}</td><td><span class="tag ${wStatus[w.status][1]}">${wStatus[w.status][0]}</span></td>
            <td class="muted">${ago(w.created_at)}</td>
            <td class="r">${w.status === 'pending' ? `<button class="btn btn-quiet btn-sm" type="button" data-cancel="${w.id}">Stornieren</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}
      </div>
    </div>`;

  app.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
    await navigator.clipboard.writeText(b.dataset.copy);
    toast('Kopiert. Füg es im Minecraft-Chat ein.');
  });
  document.getElementById('logout-wallet')?.addEventListener('click', () => document.getElementById('logout')?.click());
  document.getElementById('wd-all')?.addEventListener('click', () => { document.getElementById('wd').value = Math.floor(me.balance); });
  document.getElementById('wd-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Wird angefordert…';
    try {
      await api('/withdrawals', { amount: Number(document.getElementById('wd').value) });
      toast('Auszahlung angefordert');
      viewWallet();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = 'Auszahlung anfordern';
      document.getElementById('wd').focus();
    }
  });
  app.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
    try { await api(`/withdrawals/${b.dataset.cancel}/cancel`, {}); toast('Auszahlung storniert'); viewWallet(); }
    catch (err) { toast(err.message, true); }
  });
}

// ---------- Leaderboard ----------

const playerLink = (name) => `#/player/${encodeURIComponent(name)}`;
const PERIOD_LABEL = { week: 'Woche', month: 'Monat', all: 'Gesamt' };

async function viewLeaderboard(query) {
  const period = PERIOD_LABEL[query?.get('p')] ? query.get('p') : 'all';
  const { leaders } = await api(`/leaderboard?period=${period}`);
  const name = (l) => l.mcName || l.username;
  const top = leaders.slice(0, 3);
  // Podest: 2 – 1 – 3
  const podium = top.length >= 3 ? `<div class="podium">${[1, 0, 2].map((i) => `
    <a class="podium-spot p${i + 1}" href="${playerLink(name(top[i]))}">
      <img class="podium-head" src="https://mc-heads.net/avatar/${encodeURIComponent(name(top[i]))}/64" width="56" height="56" alt="">
      <b>${esc(name(top[i]))}</b><span class="${top[i].profit >= 0 ? 'ja' : 'nein'}">${top[i].profit >= 0 ? '+' : ''}${money(top[i].profit)}</span>
      <div class="podium-block">${i + 1}</div></a>`).join('')}</div>` : '';
  app.innerHTML = `
    <div class="page-title"><div><h1>Rangliste</h1><p>${period === 'all'
      ? 'Wer auf Hugo SMP am besten vorhersagt, sortiert nach Gewinn'
      : `Gewinn aus Prognosen, die in ${period === 'week' ? 'dieser Woche' : 'diesem Monat'} entschieden wurden`}</p></div></div>
    <div class="filters" role="group" aria-label="Zeitraum">${Object.entries(PERIOD_LABEL).map(([k, v]) =>
      `<button type="button" data-p="${k}" aria-pressed="${k === period}">${v}</button>`).join('')}</div>
    ${podium}
    <section class="panel">${leaders.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Platz</th><th>Spieler</th><th class="r">Gewinn</th>${period === 'all' ? '<th class="r hide-sm">Vermögen</th>' : '<th class="r hide-sm">Prognosen</th>'}</tr></thead><tbody>
      ${leaders.map((l, i) => `<tr><td class="rank ${i < 3 ? `r${i + 1}` : ''}">${i + 1}</td>
        <td><a class="who" href="${playerLink(name(l))}" style="text-decoration:none">${head(name(l))}<b>${esc(name(l))}</b></a></td>
        <td class="r ${l.profit >= 0 ? 'ja' : 'nein'}">${l.profit >= 0 ? '+' : ''}${money(l.profit)}</td>
        <td class="r hide-sm">${period === 'all' ? money(l.netWorth) : fmt(l.markets)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><p>${period === 'all' ? 'Noch niemand auf der Rangliste. Der erste Gewinn bringt dich auf Platz 1.' : 'In diesem Zeitraum wurde noch keine Prognose entschieden.'}</p><a class="btn btn-ja" href="#/">Markt aussuchen</a></div>`}</section>`;
  app.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { location.hash = `#/leaderboard?p=${b.dataset.p}`; });
}

// ---------- Player profile ----------

async function viewPlayer(rawName) {
  const { player: p } = await api(`/players/${encodeURIComponent(decodeURIComponent(rawName))}`);
  const name = p.mcName || p.username;
  const st = p.stats;
  const signed = (v) => `${v >= 0 ? '+' : ''}${money(v)}`;
  app.innerHTML = `
    <a href="#/leaderboard" class="back">Rangliste</a>
    <div class="profile-head panel">
      <img class="profile-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(name)}/96" width="72" height="72" alt="">
      <div><h1>${esc(name)}</h1><p class="muted">${p.rank ? `Platz <b style="color:var(--text)">${p.rank}</b> · ` : ''}dabei seit ${date(p.since)}</p></div>
    </div>
    <div class="stat-grid">
      <div class="panel stat"><small>Gewinn</small><b class="${p.profit >= 0 ? 'ja' : 'nein'}">${signed(p.profit)}</b></div>
      <div class="panel stat"><small>Trefferquote</small><b>${st.hitRate === null ? '—' : `${Math.round(st.hitRate * 100)} %`}</b><span class="muted">${st.wins} von ${st.resolved}</span></div>
      <div class="panel stat"><small>Größter Gewinn</small><b class="ja">${st.biggestWin > 0 ? `+${money(st.biggestWin)}` : '—'}</b></div>
      <div class="panel stat"><small>Laufende Gebote</small><b>${st.openBets}</b></div>
    </div>
    <div class="split-2" style="margin-top:16px">
      <section class="panel"><h2>Laufende Gebote</h2>
        ${p.open.length ? `<div class="feed">${p.open.map((o) => `<a class="feed-row" style="text-decoration:none" href="#/market/${o.marketId}">
          <span class="slot" aria-hidden="true">${esc(o.emoji)}</span><span><b>${esc(o.title)}</b><br><span class="muted">auf <b style="color:${o.color}">${esc(o.label)}</b> · ${money(o.spent)} geboten</span></span>
          <span class="when">wert ${money(o.value)}</span></a>`).join('')}</div>` : '<p class="muted">Gerade keine laufenden Gebote.</p>'}
      </section>
      <section class="panel"><h2>Entschiedene Prognosen</h2>
        ${p.history.length ? `<div class="feed">${p.history.map((h) => `<a class="feed-row" style="text-decoration:none" href="#/market/${h.marketId}">
          <span class="slot" aria-hidden="true">${esc(h.emoji)}</span><span><b>${esc(h.title)}</b><br><span class="muted">Ergebnis: ${esc(h.result ?? '—')}</span></span>
          <span class="when ${h.pnl >= 0 ? 'ja' : 'nein'}" style="font-weight:700">${signed(h.pnl)}</span></a>`).join('')}</div>` : '<p class="muted">Noch keine entschiedene Prognose.</p>'}
      </section>
    </div>`;
}

// ---------- Admin ----------

/** Bestätigungsdialog (statt confirm()), ok/abbrechen → true/false. */
function confirmDialog({ title, body, ok = 'Bestätigen', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dialog';
    d.innerHTML = `<h2>${title}</h2><div class="dialog-body">${body}</div>
      <div class="dialog-actions"><button class="btn" type="button" data-x="0">Abbrechen</button>
      <button class="btn ${danger ? 'btn-nein' : 'btn-ja'}" type="button" data-x="1">${ok}</button></div>`;
    document.body.append(d);
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) done(b.dataset.x === '1'); else if (e.target === d) done(false); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    d.showModal();
  });
}

const ADMIN_TABS = { overview: 'Übersicht', markets: 'Prognosen', payouts: 'Auszahlungen', deposits: 'Einzahlungen', players: 'Spieler' };
const TEMPLATES = [
  { key: 'yesno', label: 'Ja / Nein', emoji: '❓', category: 'server', title: 'Passiert … bis …?', outcomes: 'Ja\nNein' },
  { key: 'clan', label: 'Clan Fight', emoji: '⚔️', category: 'clan', title: 'Wer gewinnt den Clan Fight zwischen … und …?', outcomes: 'Clan A\nClan B' },
  { key: 'overunder', label: 'Über / Unter', emoji: '📊', category: 'irl', title: 'Wie viel …?', outcomes: 'Über …\nUnter …' },
  { key: 'many', label: 'Mehrere', emoji: '🎲', category: 'meta', title: 'Was wird …?', outcomes: 'Option 1\nOption 2\nOption 3' },
];
// Schnell-Knöpfe für den Handelsschluss (lokale Zeit)
const at = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.getTime(); };
const CLOSE_PRESETS = [
  { label: 'Heute 20 Uhr', at: () => (at(0, 20) > Date.now() + 15 * 60e3 ? at(0, 20) : at(1, 20)) },
  { label: 'Morgen 20 Uhr', at: () => at(1, 20) },
  { label: 'Wochenende', at: () => at(((7 - new Date().getDay()) % 7) || 7, 20) }, // nächster Sonntag 20 Uhr
  { label: '1 Woche', at: () => at(7, 20) },
];
// Emoji passend zu Frage und Kategorie
const EMOJI_HINTS = [
  [/clan|fight|kampf|pvp|krieg|war\b/i, '⚔️'], [/event|turnier|tournament/i, '🏆'], [/mace|schwert|axt|waffe|meta/i, '🗡️'],
  [/netherite|diamant|diamond|erz|ore/i, '💎'], [/elytra|flug|fly/i, '🪽'], [/stream|twitch|youtube|video|live/i, '📺'],
  [/fußball|fussball|bundesliga|meister|champions|tor\b|spiel\b/i, '⚽'], [/wetter|schnee|schnei|regen|sonne|grad|hitze|kalt/i, '🌦️'],
  [/geld|\$|coins|reich|kontostand|preis/i, '💰'], [/wiegt|gewicht|kg\b|schwer/i, '⚖️'], [/server|update|reset|wipe/i, '🏰'],
  [/wahl|abstimmung|vote|präsident|kanzler/i, '🗳️'], [/auto|rennen|formel/i, '🏎️'], [/musik|song|album|charts/i, '🎵'],
];
const CATEGORY_EMOJI = { clan: '⚔️', meta: '🗡️', server: '🏰', irl: '🌍' };
const guessEmoji = (title, category) => EMOJI_HINTS.find(([re]) => re.test(title))?.[1] ?? CATEGORY_EMOJI[category] ?? '🎲';

const PREVIEW_COLORS = ['#4da3ff', '#ffb547', '#b27cff', '#2fd6c4', '#ff7ac6', '#c7d36f', '#ff8a4c', '#8f9bb3', '#3ddc84', '#ff5d6c'];
const localInput = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

async function viewAdmin(query) {
  if (needLogin('Der Admin-Bereich ist nur für Admins.')) return;
  if (!state.me.isAdmin) { app.innerHTML = '<div class="panel empty"><p>Dieser Bereich ist nur für Admins.</p></div>'; return; }
  const tab = ADMIN_TABS[query?.get('t')] ? query.get('t') : 'overview';
  const [ov, st] = await Promise.all([api('/admin/overview'), api('/admin/stats')]);
  app.innerHTML = `
    <div class="page-title"><div><h1>Admin</h1></div>
      <span class="tag ${ov.bot.online ? 'live' : 'bad'}">Bot ${ov.bot.enabled ? (ov.bot.online ? 'online' : 'offline') : 'deaktiviert'}</span></div>
    <div class="filters admin-tabs" role="tablist">${Object.entries(ADMIN_TABS).map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-pressed="${k === tab}">${v}${k === 'payouts' && st.openWithdrawalCount ? ` <span class="badge">${st.openWithdrawalCount}</span>` : ''}</button>`).join('')}</div>
    <div id="admin-body"></div>`;
  app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { location.hash = `#/admin?t=${b.dataset.tab}`; });
  const body = document.getElementById('admin-body');
  const reload = async (msg) => { if (msg) toast(msg); await refreshMe(); viewAdmin(query); };
  const run = async (fn, msg) => { try { await fn(); await reload(msg); } catch (err) { toast(err.message, true); } };
  ({ overview: adminOverviewTab, markets: adminMarketsTab, payouts: adminPayoutsTab, deposits: adminDepositsTab, players: adminPlayersTab })[tab](body, { ov, st, run, reload });
}

function adminOverviewTab(body, { ov, st }) {
  const c = st.cover;
  const coverHtml = c
    ? `<section class="panel cover ${c.diff >= -0.01 ? 'ok' : 'bad'}">
        <div class="cover-head"><span class="cover-icon">${c.diff >= -0.01 ? '✓' : '!'}</span><div>
          <h2>${c.diff >= -0.01 ? 'Alles gedeckt' : 'Nicht gedeckt'}</h2>
          <p class="muted">${c.diff >= -0.01 ? 'Der Bot hat genug Geld im Spiel, um alle Spieler auszuzahlen.' : 'Der Bot hat weniger Geld im Spiel, als den Spielern gehört. Prüfen, bevor Auszahlungen laufen!'}</p></div></div>
        <div class="cover-grid">
          <div><small>Bot im Spiel</small><b>${money(c.bot)}</b></div>
          <div><small>Gehört den Spielern</small><b>${money(st.owed)}</b></div>
          <div><small>${c.diff >= 0 ? 'Überschuss' : 'Fehlbetrag'}</small><b class="${c.diff >= -0.01 ? 'ja' : 'nein'}">${c.diff >= 0 ? '+' : ''}${money(c.diff)}</b></div>
        </div>
        <p class="muted" style="font-size:13px;margin-top:10px">Spieler: ${money(st.balances)} Guthaben + ${money(st.positions)} in Anteilen + ${money(st.openWithdrawals)} offene Auszahlungen${st.unclaimed ? ` + ${money(st.unclaimed)} Einzahlungen ohne Konto` : ''}${c.at ? ` · Kontostand ${ago(c.at)}` : ''}</p>
      </section>`
    : `<section class="panel cover"><h2>Deckung</h2><p class="muted">Der Bot hat noch keinen Kontostand gemeldet. Er meldet ihn, sobald er online ist und die Kontostand-Prüfung an ist.</p></section>`;
  const tile = (label, value, sub = '') => `<div class="panel stat"><small>${label}</small><b>${value}</b>${sub ? `<span class="muted">${sub}</span>` : ''}</div>`;
  const row = (label, f) => `<tr><td>${label}</td><td class="r">${f(st.today)}</td><td class="r">${f(st.week)}</td></tr>`;
  body.innerHTML = `${coverHtml}
    <div class="stat-grid" style="margin-top:16px">
      ${tile('Spieler', fmt(st.users), `+${st.week.newUsers} diese Woche`)}
      ${tile('Guthaben im Umlauf', money(st.balances))}
      ${tile('In Anteilen', money(st.positions))}
      ${tile('Gebühren gesamt', money(st.fees))}
      ${tile('Offene Auszahlungen', fmt(st.openWithdrawalCount), money(st.openWithdrawals))}
      ${tile('Laufende Prognosen', fmt(st.activeMarkets))}
    </div>
    <section class="panel" style="margin-top:16px"><h2>Zeiträume</h2><div class="table-wrap"><table class="table">
      <thead><tr><th></th><th class="r">Heute</th><th class="r">7 Tage</th></tr></thead><tbody>
      ${row('Einzahlungen', (p) => money(p.deposits))}${row('Auszahlungen', (p) => money(p.withdrawals))}
      ${row('Gebote (Volumen)', (p) => money(p.volume))}${row('Gebühren', (p) => money(p.fees))}${row('Neue Spieler', (p) => fmt(p.newUsers))}
    </tbody></table></div></section>
    ${ov.bot.lastError ? `<section class="panel" style="margin-top:16px"><p><b class="nein">Letzter Bot-Fehler:</b> ${esc(ov.bot.lastError)}</p></section>` : ''}`;
}

async function adminMarketsTab(body, { run }) {
  const { markets } = await api('/markets?category=all&status=all');
  const active = markets.filter((m) => m.status === 'open' || m.status === 'closed');
  const recent = markets.filter((m) => m.status === 'resolved' || m.status === 'cancelled').sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const soon = Date.now() + 7 * 86400e3;
  body.innerHTML = `<div class="split-2">
    <section class="panel"><h2>Neue Prognose</h2>
      <div class="templates">${TEMPLATES.map((t) => `<button class="btn btn-sm" type="button" data-tpl="${t.key}">${t.emoji} ${t.label}</button>`).join('')}</div>
      <form id="create">
        <div class="field"><label for="f-title">Frage</label><input class="input" id="f-title" name="title" required autocomplete="off" placeholder="Wer gewinnt den Clan Fight am Samstag?"></div>
        <div class="row-gap">
          <div class="field"><label for="f-cat">Kategorie</label><select class="input" id="f-cat" name="category">
            ${Object.entries(CATS).filter(([k]) => k !== 'all').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="field"><label for="f-emoji">Symbol (ein Emoji)</label><input class="input" id="f-emoji" name="emoji" value="⚔️" autocomplete="off"></div>
        </div>
        <div class="field"><label for="f-out">Ausgänge, einer pro Zeile. „Ja“ und „Nein“ ergibt einen Ja/Nein-Markt.</label>
          <textarea class="input" id="f-out" name="outcomes" rows="4">Ja\nNein</textarea>
          <div class="chips" id="known" aria-label="Schon bekannte Namen"></div></div>
        <div class="field"><label for="f-close">Handel endet</label>
          <div class="chips" id="close-chips">${CLOSE_PRESETS.map((p, i) => `<button class="chip" type="button" data-close-preset="${i}">${p.label}</button>`).join('')}</div>
          <input class="input" id="f-close" type="datetime-local" name="closesAt" value="${localInput(soon)}"></div>
        <details class="more-opts"><summary>Mehr Optionen</summary>
          <div class="field" style="margin-top:12px"><label for="f-desc">So wird entschieden</label><textarea class="input" id="f-desc" name="description" rows="3" placeholder="Wann zählt welcher Ausgang als gewonnen?…"></textarea></div>
          <div class="field"><label for="f-b">Liquidität (wie stark Gebote den Kurs bewegen)</label><input class="input" id="f-b" name="b" inputmode="numeric" autocomplete="off" placeholder="Standard: 100…"></div>
        </details>
        <p class="muted" style="font-size:13px;margin:4px 0 8px">Vorschau</p>
        <div id="preview" class="preview"></div>
        <button class="btn btn-ja btn-block" style="margin-top:14px">Prognose erstellen</button>
      </form>
    </section>
    <section class="panel"><h2>Laufende Prognosen</h2>
      ${active.length ? active.map((m) => `<div class="admin-market">
        <p><span aria-hidden="true">${esc(m.emoji)}</span> <a href="#/market/${m.id}"><b>${esc(m.title)}</b></a>
          <span class="tag ${STATUS[m.status][1]}">${STATUS[m.status][0]}</span>${m.featured ? ' <span class="tag warn">★ Oben</span>' : ''}</p>
        <p class="muted" style="font-size:13px">${money(m.volume)} Volumen ${endsBadge(m.closesAt)}</p>
        <div class="admin-actions">
          <select class="input" data-sel="${m.id}" aria-label="Gewinner für ${esc(m.title)}">
            ${sortedOutcomes(m).map((o) => `<option value="${o.id}">${esc(o.label)} (${pct(o.price)})</option>`).join('')}</select>
          <button class="btn btn-sm btn-ja" type="button" data-resolve="${m.id}">Entscheiden</button>
        </div>
        <div class="admin-actions">
          <button class="btn btn-sm" type="button" data-edit="${m.id}">Bearbeiten</button>
          <button class="btn btn-sm" type="button" data-copy-market="${m.id}">Nochmal</button>
          <button class="btn btn-sm" type="button" data-feature="${m.id}" data-on="${m.featured ? 0 : 1}">${m.featured ? 'Nicht mehr oben' : '★ Oben anzeigen'}</button>
          ${m.status === 'open' ? `<button class="btn btn-sm" type="button" data-close="${m.id}">Handel stoppen</button>` : ''}
          <button class="btn btn-sm btn-nein" type="button" data-cancelm="${m.id}">Stornieren</button>
        </div>
        <form class="edit-form hidden" data-editform="${m.id}">
          <div class="field"><label>Frage</label><input class="input" name="title" value="${esc(m.title)}" required></div>
          <div class="row-gap">
            <div class="field"><label>Kategorie</label><select class="input" name="category">${Object.entries(CATS).filter(([k]) => k !== 'all').map(([k, v]) => `<option value="${k}"${k === m.category ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
            <div class="field"><label>Symbol</label><input class="input" name="emoji" value="${esc(m.emoji)}"></div>
          </div>
          <div class="field"><label>Handel endet</label><input class="input" type="datetime-local" name="closesAt" value="${m.closesAt ? localInput(m.closesAt) : ''}"></div>
          <div class="field"><label>So wird entschieden</label><textarea class="input" name="description" rows="3">${esc(m.description || '')}</textarea></div>
          <p class="muted" style="font-size:13px;margin-bottom:10px">Die Ausgänge bleiben gleich, damit bisherige Gebote gültig bleiben.</p>
          <button class="btn btn-sm btn-ja">Speichern</button>
        </form>
      </div>`).join('') : '<p class="muted">Keine laufenden Prognosen. Leg links eine an.</p>'}
      ${recent.length ? `<h2 style="margin-top:22px">Zuletzt beendet</h2><div class="feed">${recent.map((m) => `<div class="feed-row">
        <span aria-hidden="true">${esc(m.emoji)}</span><span>${esc(m.title)}</span>
        <button class="btn btn-sm" type="button" data-copy-market="${m.id}" style="margin-left:auto">Nochmal</button></div>`).join('')}</div>` : ''}
    </section></div>`;

  // Vorlagen und Live-Vorschau
  const f = document.getElementById('create');
  const preview = () => {
    const labels = f.outcomes.value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10);
    const outs = labels.map((label, i) => ({ id: -1 - i, label, price: labels.length ? 1 / labels.length : 0, color: PREVIEW_COLORS[i % PREVIEW_COLORS.length] }));
    document.getElementById('preview').innerHTML = labels.length >= 2
      ? marketCard({ id: 0, title: f.title.value || 'Deine Frage …', emoji: f.emoji.value || '🎲', category: f.category.value, status: 'open', volume: 0, closesAt: f.closesAt.value ? new Date(f.closesAt.value).getTime() : null, outcomes: outs })
      : '<p class="muted">Mindestens zwei Ausgänge eintragen.</p>';
  };
  // Emoji automatisch, solange es nicht von Hand geändert wurde
  let emojiTouched = false;
  f.emoji.addEventListener('input', () => { emojiTouched = true; });
  const autoEmoji = () => { if (!emojiTouched) f.emoji.value = guessEmoji(f.title.value, f.category.value); };
  f.title.addEventListener('input', autoEmoji);
  f.category.addEventListener('change', () => { autoEmoji(); loadKnown(); preview(); });
  f.addEventListener('input', preview);
  // Schnell-Knöpfe für den Handelsschluss
  app.querySelectorAll('[data-close-preset]').forEach((b) => b.onclick = () => {
    f.closesAt.value = localInput(CLOSE_PRESETS[Number(b.dataset.closePreset)].at());
    app.querySelectorAll('[data-close-preset]').forEach((x) => x.classList.toggle('on', x === b));
    preview();
  });
  // Bekannte Namen der Kategorie (z. B. Clans) als Vorschläge zum Antippen
  const loadKnown = async () => {
    const el = document.getElementById('known');
    let labels = [];
    try { ({ labels } = await api(`/admin/known-outcomes?category=${f.category.value}`)); } catch { /* egal */ }
    el.innerHTML = labels.length ? `<span class="muted" style="font-size:12px">Schon da gewesen:</span>${labels.map((l) => `<button class="chip" type="button" data-known="${esc(l)}">+ ${esc(l)}</button>`).join('')}` : '';
    el.querySelectorAll('[data-known]').forEach((b) => b.onclick = () => {
      // Platzhalter (Clan A, Option 1, „Über …“) zuerst ersetzen
      const lines = f.outcomes.value.split('\n').map((l) => l.trim()).filter(Boolean);
      const placeholder = lines.findIndex((l) => /^(clan [a-z]|option \d+|.*…)$/i.test(l));
      if (lines.some((l) => l.toLowerCase() === b.dataset.known.toLowerCase())) return;
      if (placeholder >= 0) lines[placeholder] = b.dataset.known; else lines.push(b.dataset.known);
      f.outcomes.value = lines.join('\n');
      preview();
    });
  };
  loadKnown();
  autoEmoji();
  preview();
  // Nochmal: alte Prognose ins Formular übernehmen
  app.querySelectorAll('[data-copy-market]').forEach((b) => b.onclick = () => {
    const m = markets.find((x) => String(x.id) === b.dataset.copyMarket);
    f.title.value = m.title; f.category.value = m.category; f.emoji.value = m.emoji; emojiTouched = true;
    f.outcomes.value = m.outcomes.map((o) => o.label).join('\n');
    f.description.value = m.description || '';
    f.closesAt.value = localInput(Date.now() + 7 * 86400e3);
    loadKnown(); preview();
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.title.focus();
    toast('Übernommen – Namen anpassen und erstellen.');
  });
  app.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = () => {
    const t = TEMPLATES.find((x) => x.key === b.dataset.tpl);
    Object.assign(f.title, { value: t.title }); f.outcomes.value = t.outcomes; f.emoji.value = t.emoji; f.category.value = t.category;
    loadKnown();
    preview();
    f.title.focus();
    f.title.setSelectionRange(0, 0);
  });
  f.onsubmit = (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    run(() => api('/admin/markets', { ...v, outcomes: v.outcomes.split('\n'), closesAt: v.closesAt ? new Date(v.closesAt).toISOString() : null }), 'Prognose erstellt');
  };

  app.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => app.querySelector(`[data-editform="${b.dataset.edit}"]`).classList.toggle('hidden'));
  app.querySelectorAll('[data-editform]').forEach((form) => form.onsubmit = (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    run(() => api(`/admin/markets/${form.dataset.editform}/edit`, { ...v, closesAt: v.closesAt ? new Date(v.closesAt).toISOString() : null }), 'Gespeichert');
  });
  app.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.resolve;
    const sel = app.querySelector(`[data-sel="${id}"]`);
    let pv;
    try { pv = await api(`/admin/markets/${id}/resolve-preview?o=${sel.value}`); } catch (err) { toast(err.message, true); return; }
    const ok = await confirmDialog({
      title: 'Prognose entscheiden?',
      body: `<p><b>${esc(pv.title)}</b></p><p style="margin-top:8px">Gewinner: <b class="ja">${esc(pv.outcome)}</b></p>
        <ul class="dialog-list"><li><b>${pv.winners}</b> Spieler bekommen zusammen <b class="ja">${money(pv.payout)}</b></li><li><b>${pv.losers}</b> Spieler verlieren ihren Einsatz</li></ul>
        <p class="muted" style="margin-top:8px">Das lässt sich nicht rückgängig machen.</p>`,
      ok: 'Ja, entscheiden',
    });
    if (ok) run(() => api(`/admin/markets/${id}/resolve`, { outcomeId: Number(sel.value) }), 'Entschieden, Gewinne ausgezahlt');
  });
  app.querySelectorAll('[data-feature]').forEach((b) => b.onclick = () => run(() => api(`/admin/markets/${b.dataset.feature}/feature`, { on: b.dataset.on === '1' }), b.dataset.on === '1' ? 'Wird jetzt oben angezeigt' : 'Nicht mehr oben'));
  app.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => run(() => api(`/admin/markets/${b.dataset.close}/close`, {}), 'Handel gestoppt'));
  app.querySelectorAll('[data-cancelm]').forEach((b) => b.onclick = async () => {
    if (await confirmDialog({ title: 'Prognose stornieren?', body: '<p>Alle Einsätze werden erstattet. Das lässt sich nicht rückgängig machen.</p>', ok: 'Stornieren', danger: true })) {
      run(() => api(`/admin/markets/${b.dataset.cancelm}/cancel`, {}), 'Storniert, Einsätze erstattet');
    }
  });
}

function adminPayoutsTab(body, { ov, run }) {
  body.innerHTML = `<section class="panel"><h2>Auszahlungen</h2><div class="table-wrap"><table class="table"><tbody>
    ${ov.withdrawals.map((w) => `<tr><td><div class="who">${head(w.mc_name)}<span><b>${esc(w.mc_name)}</b>${w.username && w.username !== w.mc_name ? `<br><small class="muted">${esc(w.username)}</small>` : ''}</span></div></td><td style="white-space:nowrap">${money(w.amount)}</td>
      <td><span class="tag ${w.status === 'done' ? 'live' : w.status === 'failed' ? 'bad' : 'warn'}">${WITHDRAW_STATUS[w.status] || esc(w.status)}</span>${w.error ? `<br><small class="muted">${esc(w.error)}</small>` : ''}</td><td class="muted">${ago(w.created_at)}</td>
      <td class="r">${w.status === 'pending' && state.status?.payoutsNeedApproval ? `<button class="btn btn-sm btn-ja" type="button" data-approve="${w.id}">Freigeben</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">Noch keine Auszahlungen</td></tr>'}
  </tbody></table></div></section>`;
  body.querySelectorAll('[data-approve]').forEach((b) => b.onclick = () => run(() => api(`/admin/withdrawals/${b.dataset.approve}/approve`, {}), 'Freigegeben'));
}

function adminDepositsTab(body, { ov }) {
  body.innerHTML = `<section class="panel"><h2>Einzahlungen</h2><div class="table-wrap"><table class="table"><tbody>
    ${ov.deposits.map((d) => `<tr><td><div class="who">${head(d.mc_name)}<span><b>${esc(d.mc_name)}</b>${d.username ? (d.username !== d.mc_name ? `<br><small class="muted">${esc(d.username)}</small>` : '') : '<br><span class="tag warn">noch kein Konto</span>'}</span></div></td>
      <td class="ja r" style="white-space:nowrap">+${money(d.amount)}<br><small class="muted">${ago(d.created_at)}</small></td></tr>`).join('') || '<tr><td class="muted">Noch keine Einzahlungen</td></tr>'}
  </tbody></table></div></section>`;
}

async function adminPlayersTab(body, { run }) {
  body.innerHTML = `<section class="panel"><h2>Spieler</h2>
    <div class="field"><input class="input" id="player-q" placeholder="Suchen: Minecraft-, Website- oder Discord-Name…" autocomplete="off" spellcheck="false"></div>
    <div id="player-list" class="player-list"></div></section>`;
  const list = document.getElementById('player-list');
  const load = async (q = '') => {
    const { users } = await api(`/admin/users?q=${encodeURIComponent(q)}`);
    list.innerHTML = users.length ? users.map((u) => `<div class="player-row" data-uid="${u.id}">
      <button class="player-head" type="button" data-open="${u.id}">${head(u.mcName || u.username)}
        <span class="player-name"><b>${esc(u.mcName || u.username)}</b>${u.banned ? ' <span class="tag bad">gesperrt</span>' : ''}<br>
          <small class="muted">${u.discordName ? `Discord: ${esc(u.discordName)} · ` : ''}${fmt(u.trades)} Gebote</small></span>
        <span class="r"><b>${money(u.balance)}</b><br><small class="muted">+ ${money(u.inPositions)} in Anteilen</small></span></button>
      <div class="player-detail hidden" data-detail="${u.id}"></div></div>`).join('') : '<p class="muted">Keine Spieler gefunden.</p>';
    list.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openPlayer(Number(b.dataset.open)));
  };
  const openPlayer = async (id) => {
    const box = list.querySelector(`[data-detail="${id}"]`);
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    const { user: u } = await api(`/admin/users/${id}`);
    box.innerHTML = `
      <form class="credit-row" data-credit="${u.id}">
        <input class="input" name="amount" placeholder="±Betrag, z. B. 500 oder -200" required autocomplete="off" inputmode="decimal">
        <input class="input" name="note" placeholder="Grund…" autocomplete="off">
        <button class="btn btn-sm">Buchen</button></form>
      <div class="admin-actions" style="margin:10px 0">
        <a class="btn btn-sm" href="${playerLink(u.mcName || u.username)}">Profil</a>
        <button class="btn btn-sm ${u.banned ? 'btn-ja' : 'btn-nein'}" type="button" data-ban="${u.id}" data-to="${u.banned ? 0 : 1}">${u.banned ? 'Entsperren' : 'Sperren'}</button></div>
      <div class="feed">${u.ledger.length ? u.ledger.map((l) => `<div class="feed-row"><span><b>${LEDGER[l.type] || esc(l.type)}</b>${l.type === 'admin' && l.ref ? ` <span class="muted">· ${esc(l.ref)}</span>` : ''}</span>
        <span class="when ${l.amount >= 0 ? 'ja' : 'nein'}">${l.amount >= 0 ? '+' : ''}${money(l.amount)} · ${ago(l.created_at)}</span></div>`).join('') : '<p class="muted">Noch keine Buchungen.</p>'}</div>`;
    box.classList.remove('hidden');
    box.querySelector('[data-credit]').onsubmit = (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      run(() => api('/admin/credit', { username: u.username, amount: Number(String(v.amount).replace(',', '.')), note: v.note }), 'Gebucht');
    };
    box.querySelector('[data-ban]').onclick = async (e) => {
      const to = e.target.dataset.to === '1';
      if (to && !(await confirmDialog({ title: `${esc(u.mcName || u.username)} sperren?`, body: '<p>Die Person kann dann nicht mehr bieten, verkaufen oder auszahlen. Ihr Guthaben bleibt erhalten.</p>', ok: 'Sperren', danger: true }))) return;
      run(() => api(`/admin/users/${u.id}/ban`, { banned: to }), to ? 'Gesperrt' : 'Entsperrt');
    };
  };
  let t;
  document.getElementById('player-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value), 150); });
  await load();
}

// ---------- Login ----------

const LOGIN_POLL = 2000;
let pendingLogin = null;

async function viewLogin() {
  if (!pendingLogin || pendingLogin.expires <= Date.now()) {
    app.innerHTML = '';
    try {
      const r = await api('/login/start', {});
      pendingLogin = { ...r, expires: Date.now() + r.expiresInSeconds * 1000 };
    } catch (err) {
      app.innerHTML = `<section class="auth panel"><h1>Anmelden nicht möglich</h1><p class="muted">${esc(err.message)}</p></section>`;
      return;
    }
  }
  const s = state.status;
  const login = pendingLogin;
  const cmd = `/msg ${s?.botName || 'HugoPredict'} ${login.code}`;
  app.innerHTML = `<section class="auth panel" id="login-wait">
    <img class="auth-logo" src="/logo.png" width="148" height="148" alt="HugoPredict Logo">
    <h1>Mit Minecraft anmelden</h1>
    <ol class="steps"><li>Geh auf <b>Hugo SMP</b> online und schick diesen Befehl im Chat ab:</li></ol>
    <div class="cmd"><code translate="no">${esc(cmd)}</code><button class="btn btn-sm" type="button" data-copy="${esc(cmd)}">Kopieren</button></div>
    <ol class="steps" start="2"><li>Danach bist du hier automatisch angemeldet.</li></ol>
    ${s?.botOnline ? '<p class="muted" style="font-size:14px" aria-live="polite">Warte auf deine Nachricht…</p>' : '<p class="muted" style="font-size:14px">Der Bot ist gerade offline. Ohne ihn klappt die Anmeldung nicht.</p>'}
    <p class="muted" style="font-size:14px"><b style="color:var(--text)">Schick nur Befehle ab, die du hier selbst siehst.</b> Wer dir einen fertigen Befehl gibt, bekommt damit Zugriff auf dein Konto.</p>
    </section>`;
  app.querySelector('[data-copy]').onclick = async (e) => {
    await navigator.clipboard.writeText(e.target.dataset.copy);
    toast('Kopiert. Füg es im Minecraft-Chat ein.');
  };
  const wait = app.querySelector('#login-wait');
  const poll = async () => {
    if (!wait.isConnected || login !== pendingLogin) return;
    try {
      const r = await api('/login/poll', { secret: login.secret });
      if (r.loggedIn) {
        pendingLogin = null;
        await refreshMe();
        toast(`Angemeldet als ${state.me.mcName}`);
        location.hash = '#/';
        return;
      }
    } catch {
      if (Date.now() >= login.expires) {
        pendingLogin = null;
        if (wait.isConnected) viewLogin();
        return;
      }
    }
    setTimeout(poll, LOGIN_POLL);
  };
  setTimeout(poll, LOGIN_POLL);
}

// ---------- Boot ----------

// ---------- Konfetti (kleiner Moment der Freude nach einem Gebot) ----------

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  document.body.append(c);
  const ctx = c.getContext('2d');
  const colors = ['#33c26d', '#3b9df0', '#f0bd4b', '#ef5a48', '#b27cff', '#2fd6c4'];
  const parts = Array.from({ length: 90 }, () => ({
    x: c.width / 2, y: c.height * 0.55, vx: (Math.random() - 0.5) * 18 * devicePixelRatio, vy: (-Math.random() * 16 - 6) * devicePixelRatio,
    s: (Math.random() * 6 + 4) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  const tick = (t) => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.55 * devicePixelRatio; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (t - start < 1600) requestAnimationFrame(tick); else c.remove();
  };
  requestAnimationFrame(tick);
}

// ---------- Kurze Einführung beim ersten Besuch ----------

function showOnboarding() {
  try { if (localStorage.getItem('hp_onboarded')) return; } catch { return; }
  const d = document.createElement('dialog');
  d.className = 'dialog onboarding';
  d.innerHTML = `<img src="/icon-192.png" width="56" height="56" alt="" style="border-radius:14px">
    <h2>So funktioniert HugoPredict</h2>
    <ol class="onb-steps">
      <li><span>💰</span><div><b>Einzahlen</b><p>Im Spiel <code>/pay HugoPredict &lt;Betrag&gt;</code> – das Geld landet auf deinem Konto.</p></div></li>
      <li><span>🎯</span><div><b>Bieten</b><p>Such dir eine Prognose aus und biete auf das, was du glaubst.</p></div></li>
      <li><span>🏆</span><div><b>Gewinnen</b><p>Liegst du richtig, gewinnst du – je weniger daran geglaubt haben, desto mehr.</p></div></li>
    </ol>
    <button class="btn btn-ja btn-block" type="button">Los geht's</button>`;
  document.body.append(d);
  const close = () => { try { localStorage.setItem('hp_onboarded', '1'); } catch { /* egal */ } d.close(); d.remove(); };
  d.querySelector('button').onclick = close;
  d.addEventListener('cancel', close);
  d.showModal();
}

// ---------- Vorschläge (Dropdown) für Suchfelder ----------

/**
 * Hängt ein Vorschlags-Dropdown an ein Eingabefeld. fetchItems(text) liefert
 * [{ label, sub?, icon?, iconUrl?, value?, href? }]; onPick(item) wird beim Auswählen aufgerufen.
 */
function attachSuggest(input, fetchItems, onPick) {
  const box = document.createElement('div');
  box.className = 'suggest hidden';
  box.setAttribute('role', 'listbox');
  input.parentElement.style.position = 'relative';
  input.parentElement.append(box);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');
  let items = [], active = -1, timer, seq = 0;
  const close = () => { box.classList.add('hidden'); active = -1; };
  const render = () => {
    if (!items.length) return close();
    box.innerHTML = items.map((it, i) => `<button type="button" role="option" class="suggest-item${i === active ? ' active' : ''}" data-i="${i}" aria-selected="${i === active}">
      ${it.iconUrl ? `<img src="${esc(it.iconUrl)}" width="24" height="24" alt="">` : `<span class="suggest-icon">${esc(it.icon || '')}</span>`}
      <span class="suggest-text"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('');
    box.classList.remove('hidden');
  };
  const pick = (it) => { close(); onPick(it); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { items = []; return close(); }
    timer = setTimeout(async () => {
      const mine = ++seq;
      const res = await fetchItems(q).catch(() => []);
      if (mine !== seq) return; // veraltete Antwort
      items = res.slice(0, 8);
      active = -1;
      render();
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % items.length; render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  // pointerdown statt click: sonst schließt blur das Dropdown, bevor der Klick ankommt
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) { e.preventDefault(); pick(items[Number(b.dataset.i)]); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

let marketCache = { at: 0, list: [] };
async function allMarkets() {
  if (Date.now() - marketCache.at > 30e3) marketCache = { at: Date.now(), list: (await api('/markets?category=all&status=all')).markets };
  return marketCache.list;
}

const searchEl = document.getElementById('search');
searchEl.addEventListener('input', () => {
  state.search = searchEl.value;
  if ((location.hash.slice(1) || '/').split('?')[0] === '/') renderGrid();
});
attachSuggest(searchEl, async (q) => {
  const t = q.toLowerCase();
  const [markets, { players }] = await Promise.all([allMarkets(), api(`/players?q=${encodeURIComponent(q)}`)]);
  const ms = markets.filter((m) => m.title.toLowerCase().includes(t)).slice(0, 5).map((m) => {
    const lead = sortedOutcomes(m)[0];
    return { icon: m.emoji, label: m.title, sub: `${CATS[m.category]} · ${STATUS[m.status][0]}${lead ? ` · ${lead.label} ${pct(lead.price)}` : ''}`, href: `#/market/${m.id}` };
  });
  const ps = players.slice(0, 3).map((p) => ({ iconUrl: `https://mc-heads.net/avatar/${encodeURIComponent(p.mcName || p.username)}/24`, label: p.mcName || p.username, sub: 'Spieler', href: playerLink(p.mcName || p.username) }));
  return [...ms, ...ps];
}, (it) => { searchEl.value = ''; state.search = ''; searchEl.blur(); location.hash = it.href; });
document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if ((location.hash.slice(1) || '/').split('?')[0] !== '/') location.hash = '#/';
});
window.addEventListener('hashchange', router);
setTimeout(showOnboarding, 600);

// ---------- Als App (PWA) ----------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
document.documentElement.classList.toggle('standalone', standalone);
const installEl = document.getElementById('install');
const hideInstall = () => {
  installEl.classList.add('hidden');
  try { localStorage.setItem('hp_install_hidden', String(Date.now())); } catch { /* egal */ }
};
const installDismissed = () => {
  try { return Date.now() - Number(localStorage.getItem('hp_install_hidden') || 0) < 14 * 86400e3; } catch { return false; }
};
function showInstall(html, onInstall) {
  if (standalone || installDismissed()) return;
  installEl.innerHTML = `<img src="/icon-192.png" width="44" height="44" alt=""><div class="install-text"><b>HugoPredict als App</b><span>${html}</span></div>
    ${onInstall ? '<button class="btn btn-ja btn-sm" type="button" id="install-go">Installieren</button>' : ''}
    <button class="install-x" type="button" id="install-x" aria-label="Schließen">✕</button>`;
  installEl.classList.remove('hidden');
  document.getElementById('install-x').onclick = hideInstall;
  document.getElementById('install-go')?.addEventListener('click', onInstall);
}
// Android/Chrome: echter Installieren-Knopf
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  showInstall('Schneller Start vom Home-Bildschirm, ohne Browserleiste.', async () => {
    e.prompt();
    await e.userChoice.catch(() => {});
    hideInstall();
  });
});
// iPhone/iPad (Safari): Anleitung, weil iOS keinen Knopf anbietet
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) {
  setTimeout(() => showInstall('Tippe auf <b>Teilen</b> <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" style="vertical-align:-2px"><path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> und dann auf <b>„Zum Home-Bildschirm“</b>.'), 2500);
}
refreshMe().catch(() => {}).finally(router);
setInterval(() => refreshMe().catch(() => {}), 30000);

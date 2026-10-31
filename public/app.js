import * as lmsr from '/lmsr.js';

// ---------- Helpers ----------

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const fmt = (n) => nf.format(Number(n) || 0);
const money = (n) => `${fmt(n)} $`;
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
  [/^\/admin$/, viewAdmin, 'admin'],
  [/^\/login$/, viewLogin, ''],
];

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
    try {
      await view(...m.slice(1), new URLSearchParams(query));
    } catch (err) {
      app.innerHTML = `<div class="panel empty"><p>${esc(err.message)}</p><a class="btn" href="#/">Zu den Märkten</a></div>`;
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
      ? `<div class="actions"><a class="btn btn-yes" href="#/market/${m.id}?o=${ja.id}">Ja kaufen</a>
          <a class="btn btn-no" href="#/market/${m.id}?o=${nein.id}">Nein kaufen</a></div>`
      : winner ? `<p class="result">Ergebnis: <b class="${winner === ja ? 'ja' : 'nein'}">${esc(winner.label)}</b></p>` : '';
  } else {
    const top = sortedOutcomes(m).slice(0, 3);
    body = `<div class="mini">${top.map((o) => `
        <a class="mini-row" href="#/market/${m.id}?o=${o.id}"><span>${o.id === m.resolvedOutcomeId ? 'Gewonnen: ' : ''}${esc(o.label)}</span><b>${pct(o.price)}</b></a>`).join('')}
        ${m.outcomes.length > 3 ? `<span class="muted more">und ${m.outcomes.length - 3} weitere</span>` : ''}</div>`;
  }
  return `<article class="card${m.status === 'open' ? '' : ' done'}" style="--i:${Math.min(i, 11)}">
    <div class="card-top"><span class="slot" aria-hidden="true">${esc(m.emoji)}</span>
      <h3><a href="#/market/${m.id}">${esc(m.title)}</a></h3>${bin ? gauge(m.outcomes[0].price) : ''}</div>
    ${body}
    <div class="foot-line"><span>${money(m.volume)} Volumen</span>
      <span>${m.status === 'open' ? (m.closesAt ? `bis ${date(m.closesAt)}` : '') : `<span class="tag ${cls}">${label}</span>`}</span></div>
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
  const top = [...open].sort((a, b) => b.volume - a.volume)[0];
  if (!top) { featureEl.remove(); return; }
  const { market: m } = await api(`/markets/${top.id}`);
  const lead = sortedOutcomes(m)[0];
  featureEl.innerHTML = `
    <div class="feature-q">
      <div class="lead"><span class="slot lg" aria-hidden="true">${esc(m.emoji)}</span>
        <div><div class="meta"><span>${CATS[m.category]}</span><span>${money(m.volume)} Volumen</span></div>
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
              ${m.closesAt ? `<span>Handel bis ${date(m.closesAt)}</span>` : ''}</div></div></div>
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
            <div class="feed-row">${head(t.username, 'sm')}<span><b>${esc(t.username)}</b> ${t.side === 'buy'
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
          toast(`${fmt(r.shares)} Anteile ${o.label} gekauft`);
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

async function viewLeaderboard() {
  const { leaders } = await api('/leaderboard');
  app.innerHTML = `
    <div class="page-title"><div><h1>Rangliste</h1><p>Wer auf Hugo SMP am besten vorhersagt, sortiert nach Gewinn</p></div></div>
    <section class="panel">${leaders.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Platz</th><th>Spieler</th><th class="r">Gewinn</th><th class="r hide-sm">Vermögen</th></tr></thead><tbody>
      ${leaders.map((l, i) => `<tr><td class="rank ${i < 3 ? `r${i + 1}` : ''}">${i + 1}</td>
        <td><div class="who">${head(l.mcName || l.username)}<b>${esc(l.mcName || l.username)}</b></div></td>
        <td class="r ${l.profit >= 0 ? 'ja' : 'nein'}">${l.profit >= 0 ? '+' : ''}${money(l.profit)}</td>
        <td class="r hide-sm">${money(l.netWorth)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><p>Noch niemand auf der Rangliste. Der erste Gewinn bringt dich auf Platz 1.</p><a class="btn btn-ja" href="#/">Markt aussuchen</a></div>'}</section>`;
}

// ---------- Admin ----------

async function viewAdmin() {
  if (needLogin('Der Admin-Bereich ist nur für Admins.')) return;
  if (!state.me.isAdmin) { app.innerHTML = '<div class="panel empty"><p>Dieser Bereich ist nur für Admins.</p></div>'; return; }
  const [ov, { markets }] = await Promise.all([api('/admin/overview'), api('/markets')]);
  const active = markets.filter((m) => m.status === 'open' || m.status === 'closed');
  const soon = new Date(Date.now() + 7 * 86400e3);
  soon.setMinutes(soon.getMinutes() - soon.getTimezoneOffset());

  app.innerHTML = `
    <div class="page-title"><div><h1>Admin</h1><p>Märkte anlegen und entscheiden, Ein- und Auszahlungen im Blick behalten</p></div>
      <span class="tag ${ov.bot.online ? 'live' : 'bad'}">Bot ${ov.bot.enabled ? (ov.bot.online ? 'online' : 'offline') : 'deaktiviert'}</span></div>
    ${ov.bot.lastError ? `<section class="panel" style="margin-bottom:20px"><p><b class="nein">Letzter Bot-Fehler:</b> ${esc(ov.bot.lastError)}</p></section>` : ''}
    <section class="panel" style="margin-bottom:20px"><div class="meta" style="font-size:16px;gap:8px 32px">
      <span>${ov.users} Spieler</span><span>${money(ov.totalBalance)} Guthaben im Umlauf</span><span class="gold">${money(ov.fees)} Gebühren eingenommen</span></div></section>
    <div class="split-2">
      <section class="panel"><h2>Neuer Markt</h2>
        <form id="create">
          <div class="field"><label for="f-title">Frage</label><input class="input" id="f-title" name="title" required autocomplete="off" placeholder="Wer gewinnt den Clan Fight am Samstag?"></div>
          <div class="row-gap">
            <div class="field"><label for="f-cat">Kategorie</label><select class="input" id="f-cat" name="category">
              ${Object.entries(CATS).filter(([k]) => k !== 'all').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
            <div class="field"><label for="f-emoji">Symbol (ein Emoji)</label><input class="input" id="f-emoji" name="emoji" value="⚔️" autocomplete="off"></div>
          </div>
          <div class="field"><label for="f-out">Ausgänge, einer pro Zeile. „Ja“ und „Nein“ ergibt einen Ja/Nein-Markt.</label>
            <textarea class="input" id="f-out" name="outcomes" rows="4">Ja\nNein</textarea></div>
          <div class="row-gap">
            <div class="field"><label for="f-close">Handel endet</label><input class="input" id="f-close" type="datetime-local" name="closesAt" value="${soon.toISOString().slice(0, 16)}"></div>
            <div class="field"><label for="f-b">Liquidität</label><input class="input" id="f-b" name="b" inputmode="numeric" autocomplete="off" placeholder="Standard: 100…"></div>
          </div>
          <div class="field"><label for="f-desc">So wird entschieden</label><textarea class="input" id="f-desc" name="description" rows="3" placeholder="Wann zählt welcher Ausgang als gewonnen?…"></textarea></div>
          <button class="btn btn-ja btn-block">Markt erstellen</button>
        </form>
      </section>
      <div class="stack">
        <section class="panel"><h2>Laufende Märkte</h2>
          ${active.length ? active.map((m) => `<div style="padding:14px 0;border-top:1px solid var(--line)">
            <p><a href="#/market/${m.id}"><b>${esc(m.title)}</b></a> <span class="tag ${STATUS[m.status][1]}">${STATUS[m.status][0]}</span></p>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <select class="input" style="flex:1;min-width:150px;padding:7px 10px" data-sel="${m.id}" aria-label="Gewinner für ${esc(m.title)}">
                ${m.outcomes.map((o) => `<option value="${o.id}">${esc(o.label)} (${pct(o.price)})</option>`).join('')}</select>
              <button class="btn btn-sm btn-ja" type="button" data-resolve="${m.id}">Entscheiden</button>
              ${m.status === 'open' ? `<button class="btn btn-sm" type="button" data-close="${m.id}">Handel stoppen</button>` : ''}
              <button class="btn btn-sm btn-nein" type="button" data-cancelm="${m.id}">Stornieren</button>
            </div></div>`).join('') : '<p class="muted">Keine laufenden Märkte. Leg links einen an.</p>'}
        </section>
        <section class="panel"><h2>Guthaben korrigieren</h2>
          <form id="credit" style="display:flex;gap:8px;flex-wrap:wrap">
            <input class="input" name="username" aria-label="Website-Username" placeholder="Username…" style="flex:2;min-width:140px" required autocomplete="off" spellcheck="false">
            <input class="input" name="amount" aria-label="Betrag, negativ zum Abziehen" placeholder="±Betrag…" style="flex:1;min-width:90px" required autocomplete="off">
            <input class="input" name="note" aria-label="Notiz" placeholder="Grund…" style="flex:2;min-width:140px" autocomplete="off">
            <button class="btn">Buchen</button>
          </form>
        </section>
      </div>
    </div>
    <div class="split-2" style="margin-top:20px">
      <section class="panel"><h2>Auszahlungen</h2><div class="table-wrap"><table class="table"><tbody>
        ${ov.withdrawals.map((w) => `<tr><td><b>${esc(w.mc_name)}</b>${w.username && w.username !== w.mc_name ? `<br><small class="muted">${esc(w.username)}</small>` : ''}</td><td style="white-space:nowrap">${money(w.amount)}</td>
          <td><span class="tag ${w.status === 'done' ? 'live' : w.status === 'failed' ? 'bad' : 'warn'}">${WITHDRAW_STATUS[w.status] || esc(w.status)}</span></td><td class="muted">${ago(w.created_at)}</td>
          <td class="r">${w.status === 'pending' && state.status?.payoutsNeedApproval ? `<button class="btn btn-sm btn-ja" type="button" data-approve="${w.id}">Freigeben</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">Noch keine Auszahlungen</td></tr>'}
      </tbody></table></div></section>
      <section class="panel"><h2>Einzahlungen</h2><div class="table-wrap"><table class="table"><tbody>
        ${ov.deposits.map((d) => `<tr><td><b>${esc(d.mc_name)}</b><br>${d.username ? (d.username !== d.mc_name ? `<small class="muted">${esc(d.username)}</small>` : '') : '<span class="tag warn">nicht verknüpft</span>'}</td>
          <td class="ja r" style="white-space:nowrap">+${money(d.amount)}<br><small class="muted">${ago(d.created_at)}</small></td></tr>`).join('') || '<tr><td class="muted">Noch keine Einzahlungen</td></tr>'}
      </tbody></table></div></section>
    </div>`;

  const run = async (fn, msg) => {
    try { await fn(); toast(msg); await refreshMe(); viewAdmin(); } catch (err) { toast(err.message, true); }
  };
  document.getElementById('create').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    run(() => api('/admin/markets', { ...f, outcomes: f.outcomes.split('\n'), closesAt: f.closesAt ? new Date(f.closesAt).toISOString() : null }), 'Markt erstellt');
  };
  document.getElementById('credit').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    run(() => api('/admin/credit', { ...f, amount: Number(f.amount.replace(',', '.')) }), 'Gebucht');
  };
  app.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = () => {
    const sel = app.querySelector(`[data-sel="${b.dataset.resolve}"]`);
    if (!confirm(`Markt mit „${sel.selectedOptions[0].text}“ als Gewinner entscheiden? Das lässt sich nicht rückgängig machen.`)) return;
    run(() => api(`/admin/markets/${b.dataset.resolve}/resolve`, { outcomeId: Number(sel.value) }), 'Markt entschieden, Gewinne ausgezahlt');
  });
  app.querySelectorAll('[data-approve]').forEach((b) => b.onclick = () => run(() => api(`/admin/withdrawals/${b.dataset.approve}/approve`, {}), 'Auszahlung freigegeben'));
  app.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => run(() => api(`/admin/markets/${b.dataset.close}/close`, {}), 'Handel gestoppt'));
  app.querySelectorAll('[data-cancelm]').forEach((b) => b.onclick = () => {
    if (!confirm('Markt stornieren und alle Einsätze erstatten?')) return;
    run(() => api(`/admin/markets/${b.dataset.cancelm}/cancel`, {}), 'Markt storniert, Einsätze erstattet');
  });
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

const searchEl = document.getElementById('search');
searchEl.addEventListener('input', () => {
  state.search = searchEl.value;
  if ((location.hash.slice(1) || '/').split('?')[0] === '/') renderGrid();
  else location.hash = '#/';
});
document.getElementById('search-form').addEventListener('submit', (e) => e.preventDefault());
window.addEventListener('hashchange', router);
refreshMe().catch(() => {}).finally(router);
setInterval(() => refreshMe().catch(() => {}), 30000);

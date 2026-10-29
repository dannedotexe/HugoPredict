import * as lmsr from '/lmsr.js';

// ---------- Helpers ----------

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 2) => Number(n || 0).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const money = (n) => `${fmt(n)} $`;
const pct = (p) => (p < 0.005 ? '<1%' : p > 0.995 ? '>99%' : `${Math.round(p * 100)}%`);
const head = (name, size = 24) =>
  name ? `<img class="avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}" alt="" loading="lazy">` : '<span class="avatar"></span>';
const date = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std`;
  return `vor ${Math.floor(s / 86400)} T`;
};

const CATS = {
  all: 'Alle',
  clan: '⚔️ Clan Fights',
  meta: '🗡️ Meta',
  server: '🏰 Server',
  irl: '🌍 Real Life',
};
const LEDGER = {
  deposit: 'Einzahlung', withdraw: 'Auszahlung', withdraw_refund: 'Auszahlung zurück', buy: 'Kauf', sell: 'Verkauf',
  payout: 'Gewinn', refund: 'Erstattung', admin: 'Admin',
};
const STATUS = { open: ['Live', 'live'], closed: ['Geschlossen', 'warn'], resolved: ['Aufgelöst', ''], cancelled: ['Storniert', 'bad'] };

const state = { me: null, status: null, filter: { category: 'all', status: 'open' } };

async function api(path, body) {
  const res = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Etwas ist schiefgelaufen');
  return data;
}

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

const isBinary = (m) => m.outcomes.length === 2 && /^ja$/i.test(m.outcomes[0].label) && /^nein$/i.test(m.outcomes[1].label);

// ---------- Header ----------

async function refreshMe() {
  const [{ user }, status] = await Promise.all([api('/me'), api('/status')]);
  state.me = user;
  state.status = status;
  renderHeader();
}

function renderHeader() {
  const acc = document.getElementById('account');
  const me = state.me;
  acc.innerHTML = me
    ? `<a href="#/wallet" class="balance-pill"><small>Guthaben</small><b class="mono">${money(me.balance)}</b></a>
       <a href="#/wallet" title="${esc(me.mcName || 'Nicht verknüpft')}">${head(me.mcName || me.username, 32)}</a>
       <button class="btn btn-ghost btn-sm" id="logout">Logout</button>`
    : `<a class="btn btn-ghost" href="#/login">Login</a><a class="btn btn-primary" href="#/login?register">Registrieren</a>`;
  document.getElementById('logout')?.addEventListener('click', async () => {
    await api('/logout', {});
    state.me = null;
    renderHeader();
    location.hash = '#/';
  });
  document.getElementById('nav-admin').classList.toggle('hidden', !me?.isAdmin);
  const bs = document.getElementById('bot-status');
  bs.classList.toggle('on', !!state.status?.botOnline);
  bs.textContent = state.status?.botOnline ? `Bot ${state.status.botName} ist online` : 'Bot offline – Auszahlungen warten in der Queue';
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
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === nav));
    window.scrollTo(0, 0);
    try {
      await view(...m.slice(1), new URLSearchParams(query));
    } catch (err) {
      app.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
    return;
  }
  app.innerHTML = '<div class="empty">Seite nicht gefunden. <a href="#/" class="yes">Zu den Märkten</a></div>';
}

function needLogin() {
  if (state.me) return false;
  app.innerHTML = `<div class="card empty"><h2>Du bist nicht eingeloggt</h2><p>Logge dich ein, um zu wetten und dein Guthaben zu sehen.</p>
    <a class="btn btn-primary" href="#/login">Login / Registrieren</a></div>`;
  return true;
}

// ---------- Markets list ----------

function gauge(p, color) {
  const r = 22, c = Math.PI * r;
  return `<div class="gauge"><svg width="58" height="34" viewBox="0 0 58 34">
    <path d="M7 31 A22 22 0 0 1 51 31" fill="none" stroke="var(--line-2)" stroke-width="5" stroke-linecap="round"/>
    <path d="M7 31 A22 22 0 0 1 51 31" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
      stroke-dasharray="${c * p} ${c}"/>
    <text x="29" y="30" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="700">${pct(p)}</text></svg><small>Chance</small></div>`;
}

function marketCard(m) {
  const bin = isBinary(m);
  const winner = m.outcomes.find((o) => o.id === m.resolvedOutcomeId);
  const top = [...m.outcomes].sort((a, b) => b.price - a.price).slice(0, 3);
  const [label, cls] = STATUS[m.status];
  const body = bin
    ? `<div class="mcard-outcomes"></div>
       ${m.status === 'open'
         ? `<div class="mcard-actions">
              <a class="btn btn-yes" href="#/market/${m.id}?o=${m.outcomes[0].id}">Ja ${pct(m.outcomes[0].price)}</a>
              <a class="btn btn-no" href="#/market/${m.id}?o=${m.outcomes[1].id}">Nein ${pct(m.outcomes[1].price)}</a></div>`
         : winner ? `<div class="chip">Ergebnis: <b class="${winner === m.outcomes[0] ? 'yes' : 'no'}">${esc(winner.label)}</b></div>` : ''}`
    : `<div class="mcard-outcomes">${top.map((o) => `
        <div class="orow"><span class="lbl">${o.id === m.resolvedOutcomeId ? '🏆 ' : ''}${esc(o.label)}</span>
          <span class="bar"><i style="width:${o.price * 100}%;background:${o.color}"></i></span>
          <span class="pct mono">${pct(o.price)}</span></div>`).join('')}
        ${m.outcomes.length > 3 ? `<div class="muted" style="font-size:12px">+${m.outcomes.length - 3} weitere</div>` : ''}</div>`;

  return `<article class="mcard ${m.status === 'open' ? '' : 'done'}" data-href="#/market/${m.id}">
    <div class="mcard-head"><div class="emoji">${esc(m.emoji)}</div><div class="mcard-title">${esc(m.title)}</div>
      ${bin ? gauge(m.outcomes[0].price, m.outcomes[0].price >= 0.5 ? 'var(--yes)' : 'var(--no)') : ''}</div>
    ${body}
    <div class="mcard-foot"><span class="mono">${money(m.volume)} Vol.</span>
      <span>${m.status === 'open' ? (m.closesAt ? `bis ${date(m.closesAt)}` : '') : `<span class="chip ${cls}">${label}</span>`}</span></div></article>`;
}

async function viewMarkets() {
  const s = state.status;
  app.innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <h1>Wette auf alles, was auf <span>Hugo SMP</span> passiert.</h1>
        <p>Clan Fights, die nächste Meta, Server-Events oder echte Welt – kaufe Anteile auf das, was du glaubst. Liegst du richtig, zahlt jeder Anteil 1 $.</p>
        <a class="btn btn-primary" href="${state.me ? '#/wallet' : '#/login?register'}">${state.me ? 'Geld einzahlen' : 'Jetzt starten'}</a>
      </div>
      <div class="hero-steps">
        <div class="hero-step"><div class="num">1</div><div><b>Ingame einzahlen</b><span><code>${esc(s?.payCommand || '/pay HugoPredict <Betrag>')}</code></span></div></div>
        <div class="hero-step"><div class="num">2</div><div><b>Auf Outcomes wetten</b><span>Preise = Wahrscheinlichkeit der Community</span></div></div>
        <div class="hero-step"><div class="num">3</div><div><b>Gewinne auszahlen</b><span>Der Bot schickt dir dein Geld ingame zurück</span></div></div>
      </div>
    </section>
    <div class="filters" id="filters">
      ${Object.entries(CATS).map(([k, v]) => `<button data-cat="${k}" class="${state.filter.category === k ? 'on' : ''}">${v}</button>`).join('')}
      <span class="sep"></span>
      <button data-st="open" class="${state.filter.status === 'open' ? 'on' : ''}">Offen</button>
      <button data-st="done" class="${state.filter.status === 'done' ? 'on' : ''}">Beendet</button>
    </div>
    <div class="markets" id="markets">${'<div class="skeleton"></div>'.repeat(6)}</div>`;

  document.getElementById('filters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cat) state.filter.category = b.dataset.cat;
    if (b.dataset.st) state.filter.status = b.dataset.st;
    viewMarkets();
  });

  const { markets } = await api(`/markets?category=${state.filter.category}&status=${state.filter.status}`);
  const list = document.getElementById('markets');
  list.onclick = (e) => {
    const card = e.target.closest('.mcard');
    if (card && !e.target.closest('a')) location.hash = card.dataset.href;
  };
  list.innerHTML = markets.length
    ? markets.map(marketCard).join('')
    : `<div class="empty" style="grid-column:1/-1">Keine Märkte in dieser Kategorie.</div>`;
}

// ---------- Market detail ----------

function chart(m) {
  const W = 720, H = 260, P = { l: 8, r: 44, t: 12, b: 24 };
  const h = m.history;
  const bin = isBinary(m);
  const series = bin ? [0] : m.outcomes.map((_, i) => i);
  const t0 = h[0].t, t1 = Math.max(h.at(-1).t, t0 + 1);
  const x = (t) => P.l + ((t - t0) / (t1 - t0)) * (W - P.l - P.r);
  const y = (p) => P.t + (1 - p) * (H - P.t - P.b);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => `
    <line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)" stroke-dasharray="${g % 0.5 ? '3 4' : ''}"/>
    <text x="${W - P.r + 8}" y="${y(g) + 4}">${g * 100}%</text>`).join('');
  const lines = series.map((i) => {
    const pts = h.map((pt, k) => {
      const px = x(pt.t).toFixed(1);
      const prev = k ? `${px},${y(h[k - 1].p[i]).toFixed(1)} ` : '';
      return `${prev}${px},${y(pt.p[i]).toFixed(1)}`;
    }).join(' ');
    const c = m.outcomes[i].color;
    const last = h.at(-1);
    return `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="${x(last.t)}" cy="${y(last.p[i])}" r="4" fill="${c}"/>`;
  }).join('');
  const labels = `<text x="${P.l}" y="${H - 4}">${date(t0)}</text><text x="${W - P.r}" y="${H - 4}" text-anchor="end">jetzt</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Preisverlauf">${grid}${lines}${labels}</svg>`;
}

async function viewMarket(id, query) {
  const { market: m } = await api(`/markets/${id}`);
  const bin = isBinary(m);
  const open = m.status === 'open';
  const byId = Object.fromEntries(m.outcomes.map((o) => [o.id, o]));
  const trade = { side: 'buy', outcomeId: Number(query.get('o')) || m.outcomes[0].id, amount: '' };
  const [label, cls] = STATUS[m.status];
  const lead = [...m.outcomes].sort((a, b) => b.price - a.price)[0];

  app.innerHTML = `
    <a href="#/" class="muted">← Alle Märkte</a>
    <div class="mlayout" style="margin-top:14px">
      <div class="stack">
        <div class="card">
          <div class="mhead"><div class="emoji">${esc(m.emoji)}</div><div>
            <div class="mmeta"><span class="chip">${CATS[m.category]}</span><span class="chip ${cls}">${label}</span>
              <span class="chip">${money(m.volume)} Volumen</span>${m.closesAt ? `<span class="chip">Schluss: ${date(m.closesAt)}</span>` : ''}</div>
            <h1>${esc(m.title)}</h1></div></div>
          <div class="big-odds">${bin
            ? `<b style="color:${m.outcomes[0].color}">${pct(m.outcomes[0].price)}</b><span class="muted">Chance auf Ja</span>`
            : `<b style="color:${lead.color}">${pct(lead.price)}</b><span class="muted">${esc(lead.label)} führt</span>`}</div>
          <div class="legend">${(bin ? [m.outcomes[0]] : m.outcomes).map((o) => `<span style="--c:${o.color}">${esc(o.label)} ${pct(o.price)}</span>`).join('')}</div>
          ${chart(m)}
        </div>

        <div class="card"><h2>Outcomes</h2><div class="olist">
          ${m.outcomes.map((o) => `
            <div class="olist-row ${o.id === m.resolvedOutcomeId ? 'winner' : ''}">
              <div class="name"><i style="background:${o.color}"></i>${o.id === m.resolvedOutcomeId ? '🏆 ' : ''}${esc(o.label)}</div>
              <div class="pct mono">${pct(o.price)}</div>
              ${open ? `<button class="btn btn-sm" data-pick="${o.id}">Kaufen ${Math.round(o.price * 100)}¢</button>` : '<span></span>'}
            </div>`).join('')}
        </div></div>

        ${m.description ? `<div class="card"><h2>Regeln</h2><p class="muted" style="margin:0;white-space:pre-wrap">${esc(m.description)}</p></div>` : ''}

        <div class="card activity"><h2>Aktivität</h2>
          ${m.recent.length ? m.recent.map((t) => `
            <div class="row">${head(t.username)}<span><b>${esc(t.username)}</b>
              ${t.side === 'buy' ? 'kaufte' : 'verkaufte'} <b>${fmt(t.shares, 1)}</b>
              <span style="color:${byId[t.outcome_id]?.color}">${esc(byId[t.outcome_id]?.label)}</span>
              für ${money(t.amount)}</span><span class="when">${ago(t.created_at)}</span></div>`).join('')
            : '<p class="muted" style="margin:0">Noch keine Trades. Sei der Erste!</p>'}
        </div>
      </div>

      <aside class="stack">
        <div class="card trade" id="trade"></div>
        ${m.positions.length ? `<div class="card positions-mini"><h2>Deine Positionen</h2>
          ${m.positions.map((p) => `<div class="row"><span style="color:${byId[p.outcome_id].color};font-weight:600">${esc(byId[p.outcome_id].label)}</span>
            <span class="mono">${fmt(p.shares, 2)} Anteile · ${money(p.shares * byId[p.outcome_id].price)}</span></div>`).join('')}</div>` : ''}
      </aside>
    </div>`;

  app.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    Object.assign(trade, { side: 'buy', outcomeId: Number(b.dataset.pick) });
    renderTrade();
    document.getElementById('trade').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  const qs = m.outcomes.map((o) => o.q);
  const fee = state.status?.fee ?? 0;

  function renderTrade() {
    const el = document.getElementById('trade');
    if (!open) {
      const w = byId[m.resolvedOutcomeId];
      el.innerHTML = `<h2>${label}</h2><p class="muted" style="margin:0">${
        m.status === 'resolved' ? `Gewonnen hat <b style="color:${w.color}">${esc(w.label)}</b>. Gewinne wurden automatisch ausgezahlt.`
        : m.status === 'cancelled' ? 'Dieser Markt wurde storniert, Einsätze wurden erstattet.'
        : 'Der Handel ist beendet. Der Markt wird bald aufgelöst.'}</p>`;
      return;
    }
    const idx = m.outcomes.findIndex((o) => o.id === trade.outcomeId);
    const o = m.outcomes[idx];
    const pos = m.positions.find((p) => p.outcome_id === o.id);
    const amt = Number(String(trade.amount).replace(',', '.')) || 0;
    let summary = '';
    if (trade.side === 'buy' && amt > 0) {
      const shares = lmsr.sharesForAmount(qs, m.b, idx, amt * (1 - fee));
      const after = qs.slice(); after[idx] += shares;
      summary = `<div><span class="muted">Anteile</span><span class="mono">${fmt(shares)}</span></div>
        <div><span class="muted">Ø Preis</span><span class="mono">${fmt((amt / shares) * 100, 1)}¢</span></div>
        <div><span class="muted">Neue Chance</span><span class="mono">${pct(lmsr.prices(after, m.b)[idx])}</span></div>
        <div><span class="muted">Gewinn, wenn ${esc(o.label)}</span><span class="mono win">${money(shares)} (+${fmt(((shares - amt) / amt) * 100, 0)}%)</span></div>`;
    } else if (trade.side === 'sell' && amt > 0) {
      const sh = Math.min(amt, pos?.shares || 0);
      summary = `<div><span class="muted">Du erhältst</span><span class="mono win">${money(lmsr.sellValue(qs, m.b, idx, sh) * (1 - fee))}</span></div>`;
    }

    el.innerHTML = `
      <div class="tabs"><button data-side="buy" class="${trade.side === 'buy' ? 'on' : ''}">Kaufen</button>
        <button data-side="sell" class="${trade.side === 'sell' ? 'on' : ''}">Verkaufen</button></div>
      <div class="opick ${bin ? '' : 'many'}">${m.outcomes.map((x) => `
        <button data-o="${x.id}" style="--c:${x.color}" class="${x.id === o.id ? 'on' : ''}"><span>${esc(x.label)}</span><span class="mono">${Math.round(x.price * 100)}¢</span></button>`).join('')}</div>
      <div class="field"><label>${trade.side === 'buy' ? 'Betrag' : `Anteile (du hast ${fmt(pos?.shares || 0)})`}</label>
        <div class="input-wrap"><input class="input mono" id="amt" inputmode="decimal" placeholder="0" value="${esc(trade.amount)}">
          <span class="suffix">${trade.side === 'buy' ? '$' : 'Anteile'}</span></div>
        <div class="quick">${trade.side === 'buy'
          ? ['+10', '+50', '+100', 'Max'].map((q) => `<button class="btn btn-sm" data-q="${q}">${q}</button>`).join('')
          : ['25%', '50%', 'Max'].map((q) => `<button class="btn btn-sm" data-q="${q}">${q}</button>`).join('')}</div></div>
      ${summary ? `<div class="summary">${summary}</div>` : ''}
      ${state.me
        ? `<button class="btn btn-block ${trade.side === 'buy' ? (bin && idx === 1 ? 'btn-no on' : 'btn-yes on') : 'btn-primary'}" id="go" ${amt > 0 ? '' : 'disabled'}>
             ${trade.side === 'buy' ? `${esc(o.label)} kaufen` : `${esc(o.label)} verkaufen`}</button>
           <p class="muted" style="font-size:12px;margin:10px 0 0;text-align:center">Guthaben: ${money(state.me.balance)} · Gebühr ${fmt(fee * 100, 1)}%</p>`
        : '<a class="btn btn-primary btn-block" href="#/login">Einloggen zum Wetten</a>'}`;

    el.querySelectorAll('[data-side]').forEach((b) => b.onclick = () => { trade.side = b.dataset.side; trade.amount = ''; renderTrade(); });
    el.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => { trade.outcomeId = Number(b.dataset.o); renderTrade(); });
    el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => {
      const q = b.dataset.q, cur = Number(trade.amount) || 0;
      if (trade.side === 'buy') trade.amount = q === 'Max' ? Math.floor((state.me?.balance || 0) * 100) / 100 : cur + Number(q.slice(1));
      else trade.amount = Math.floor((pos?.shares || 0) * (q === 'Max' ? 1 : parseInt(q) / 100) * 100) / 100;
      renderTrade();
    });
    const input = el.querySelector('#amt');
    input.oninput = () => {
      trade.amount = input.value;
      const pos = input.selectionStart;
      renderTrade();
      const again = document.getElementById('amt');
      again.focus();
      again.setSelectionRange(pos, pos);
    };
    el.querySelector('#go')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        if (trade.side === 'buy') {
          const r = await api(`/markets/${m.id}/buy`, { outcomeId: o.id, amount: amt });
          toast(`${fmt(r.shares)} Anteile ${o.label} gekauft`);
        } else {
          const r = await api(`/markets/${m.id}/sell`, { outcomeId: o.id, shares: Math.min(amt, pos.shares) });
          toast(`Verkauft für ${money(r.payout)}`);
        }
        await refreshMe();
        viewMarket(id, new URLSearchParams(`o=${o.id}`));
      } catch (err) {
        toast(err.message, true);
        e.target.disabled = false;
      }
    });
  }
  renderTrade();
}

// ---------- Portfolio ----------

async function viewPortfolio() {
  if (needLogin()) return;
  const { positions, ledger } = await api('/portfolio');
  const value = positions.reduce((a, p) => a + p.value, 0);
  const spent = positions.reduce((a, p) => a + p.spent, 0);
  app.innerHTML = `
    <div class="page-head"><div><h1>Portfolio</h1><p>Deine offenen Wetten und Buchungen</p></div></div>
    <div class="grid-2" style="margin-bottom:20px">
      <div class="card"><span class="muted">Wert der Positionen</span><div class="balance-big mono">${money(value)}</div>
        <span class="${value - spent >= 0 ? 'yes' : 'no'} mono">${value - spent >= 0 ? '+' : ''}${money(value - spent)} seit Kauf</span></div>
      <div class="card"><span class="muted">Freies Guthaben</span><div class="balance-big mono" style="color:var(--text)">${money(state.me.balance)}</div>
        <a href="#/wallet" class="muted">Einzahlen / Auszahlen →</a></div>
    </div>
    <div class="card" style="margin-bottom:20px"><h2>Positionen</h2>
      ${positions.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Markt</th><th>Outcome</th><th class="r">Anteile</th><th class="r">Preis</th><th class="r">Wert</th><th class="r">G/V</th></tr></thead><tbody>
        ${positions.map((p) => `<tr><td><a href="#/market/${p.market_id}">${esc(p.emoji)} ${esc(p.title)}</a></td>
          <td style="color:${p.color};font-weight:600">${esc(p.label)}</td><td class="r mono">${fmt(p.shares)}</td>
          <td class="r mono">${Math.round(p.price * 100)}¢</td><td class="r mono">${money(p.value)}</td>
          <td class="r mono ${p.value - p.spent >= 0 ? 'yes' : 'no'}">${p.value - p.spent >= 0 ? '+' : ''}${fmt(p.value - p.spent)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Noch keine Positionen. <a href="#/" class="yes">Finde einen Markt →</a></p>'}
    </div>
    <div class="card"><h2>Verlauf</h2>
      ${ledger.length ? `<div class="table-wrap"><table class="table"><tbody>${ledger.map((l) => `
        <tr><td>${LEDGER[l.type] || l.type}</td><td class="muted">${l.ref?.startsWith('m#') ? `<a href="#/market/${l.ref.slice(2)}">Markt ${l.ref.slice(2)}</a>` : esc(l.ref || '')}</td>
        <td class="muted">${ago(l.created_at)}</td><td class="r mono ${l.amount >= 0 ? 'yes' : 'no'}">${l.amount >= 0 ? '+' : ''}${money(l.amount)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Noch keine Buchungen.</p>'}
    </div>`;
}

// ---------- Wallet ----------

async function viewWallet() {
  if (needLogin()) return;
  await refreshMe();
  const me = state.me, s = state.status;
  const { withdrawals } = me.mcName ? await api('/withdrawals') : { withdrawals: [] };
  const wStatus = { pending: ['Wartet', 'warn'], processing: ['Läuft', 'warn'], done: ['Ausgezahlt', 'live'], failed: ['Fehlgeschlagen', 'bad'], cancelled: ['Storniert', ''] };

  app.innerHTML = `
    <div class="page-head"><div><h1>Wallet</h1><p>Ein- und Auszahlungen laufen über den Bot <b>${esc(s.botName)}</b> auf Hugo SMP</p></div>
      <span class="chip ${s.botOnline ? 'live' : 'bad'}">${s.botOnline ? 'Bot online' : 'Bot offline'}</span></div>
    <div class="grid-2">
      <div class="stack">
        <div class="card"><span class="muted">Guthaben</span><div class="balance-big mono">${money(me.balance)}</div>
          <span class="muted">${me.mcName ? `Verknüpft mit ${head(me.mcName, 16)} <b style="color:var(--text)">${esc(me.mcName)}</b>` : 'Noch kein Minecraft-Account verknüpft'}</span></div>

        ${me.mcName ? `
        <div class="card"><h2>Einzahlen</h2>
          <ol class="steps"><li>Gehe auf <b>Hugo SMP</b> online.</li><li>Schicke dem Bot Geld:</li></ol>
          <div class="cmd"><code>${esc(s.payCommand)}</code><button class="btn btn-sm" data-copy="${esc(s.payCommand.replace(' <Betrag>', ' '))}">Kopieren</button></div>
          <p class="muted" style="margin:0;font-size:13px">Das Geld wird automatisch gutgeschrieben, sobald der Bot die Zahlung sieht.</p>
        </div>` : `
        <div class="card"><h2>Minecraft-Account verknüpfen</h2>
          <p class="muted" style="margin-top:0">Damit der Bot weiß, wem eine Zahlung gehört, verknüpfst du einmalig deinen Minecraft-Namen.</p>
          ${me.verifyCode ? `
            <ol class="steps"><li>Gehe auf <b>Hugo SMP</b> online.</li><li>Schreibe dem Bot diese Nachricht:</li></ol>
            <div class="cmd"><code>/msg ${esc(s.botName)} verify ${esc(me.verifyCode)}</code><button class="btn btn-sm" data-copy="/msg ${esc(s.botName)} verify ${esc(me.verifyCode)}">Kopieren</button></div>
            <p class="muted" style="font-size:13px">Der Code ist 15 Minuten gültig. <button class="btn btn-ghost btn-sm" id="check">Status prüfen</button></p>`
          : '<button class="btn btn-primary" id="link">Code erzeugen</button>'}
        </div>`}
      </div>

      <div class="stack">
        <div class="card"><h2>Auszahlen</h2>
          ${me.mcName ? `
            <div class="field"><label>Betrag (mind. ${s.minWithdraw})</label>
              <div class="input-wrap"><input class="input mono" id="wd" inputmode="numeric" placeholder="0"><span class="suffix">$</span></div>
              <div class="quick"><button class="btn btn-sm" data-wd="max">Alles</button></div></div>
            <button class="btn btn-primary btn-block" id="withdraw">Auszahlung anfordern</button>
            <p class="muted" style="font-size:13px;margin-bottom:0">Der Bot zahlt dir das Geld ingame an <b>${esc(me.mcName)}</b> aus${s.botOnline ? ' – meistens innerhalb weniger Sekunden' : ', sobald er wieder online ist'}.</p>`
          : '<p class="muted" style="margin:0">Verknüpfe zuerst deinen Minecraft-Account.</p>'}
        </div>
        ${withdrawals.length ? `<div class="card"><h2>Auszahlungen</h2><table class="table"><tbody>
          ${withdrawals.map((w) => `<tr><td class="mono">${money(w.amount)}</td><td><span class="chip ${wStatus[w.status][1]}">${wStatus[w.status][0]}</span></td>
            <td class="muted">${ago(w.created_at)}</td>
            <td class="r">${w.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-cancel="${w.id}">Stornieren</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      </div>
    </div>`;

  app.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
    await navigator.clipboard.writeText(b.dataset.copy);
    toast('Kopiert – füge es im Minecraft-Chat ein');
  });
  document.getElementById('link')?.addEventListener('click', async () => { await api('/link', {}); viewWallet(); });
  document.getElementById('check')?.addEventListener('click', async () => {
    await refreshMe();
    if (state.me.mcName) toast(`Verknüpft mit ${state.me.mcName}!`);
    else toast('Noch nicht verknüpft – hast du die Nachricht geschickt?', true);
    viewWallet();
  });
  app.querySelector('[data-wd]')?.addEventListener('click', () => { document.getElementById('wd').value = Math.floor(me.balance); });
  document.getElementById('withdraw')?.addEventListener('click', async () => {
    try {
      await api('/withdrawals', { amount: Number(document.getElementById('wd').value) });
      toast('Auszahlung angefordert');
      viewWallet();
    } catch (err) { toast(err.message, true); }
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
    <div class="page-head"><div><h1>Rangliste</h1><p>Die besten Predictor auf Hugo SMP – sortiert nach Gewinn</p></div></div>
    <div class="card">${leaders.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th></th><th>Spieler</th><th class="r">Gewinn</th><th class="r">Vermögen</th></tr></thead><tbody>
      ${leaders.map((l, i) => `<tr><td class="rank ${i < 3 ? 'top' : ''}">#${i + 1}</td>
        <td><div class="user-cell">${head(l.mcName || l.username, 28)}<b>${esc(l.mcName || l.username)}</b></div></td>
        <td class="r mono ${l.profit >= 0 ? 'yes' : 'no'}">${l.profit >= 0 ? '+' : ''}${money(l.profit)}</td>
        <td class="r mono">${money(l.netWorth)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Noch keine Spieler. Wer wird der Erste?</div>'}</div>`;
}

// ---------- Admin ----------

async function viewAdmin() {
  if (needLogin()) return;
  if (!state.me.isAdmin) { app.innerHTML = '<div class="empty">Nur für Admins.</div>'; return; }
  const [ov, { markets }] = await Promise.all([api('/admin/overview'), api('/markets')]);
  const active = markets.filter((m) => m.status === 'open' || m.status === 'closed');
  const soon = new Date(Date.now() + 7 * 86400e3);
  soon.setMinutes(soon.getMinutes() - soon.getTimezoneOffset());

  app.innerHTML = `
    <div class="page-head"><div><h1>Admin</h1><p>Märkte verwalten, Auszahlungen überwachen</p></div>
      <span class="chip ${ov.bot.online ? 'live' : 'bad'}">Bot ${ov.bot.enabled ? (ov.bot.online ? 'online' : 'offline') : 'deaktiviert'}</span></div>
    ${ov.bot.lastError ? `<div class="card" style="margin-bottom:20px;border-color:var(--no)"><b class="no">Bot-Fehler:</b> ${esc(ov.bot.lastError)}</div>` : ''}
    <div class="grid-2" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="card"><span class="muted">User</span><div class="balance-big" style="color:var(--text)">${ov.users}</div></div>
      <div class="card"><span class="muted">Guthaben aller User</span><div class="balance-big mono">${money(ov.totalBalance)}</div></div>
      <div class="card"><span class="muted">Eingenommene Gebühren</span><div class="balance-big mono" style="color:var(--gold)">${money(ov.fees)}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h2>Neuer Markt</h2>
        <form id="create">
          <div class="field"><label>Frage</label><input class="input" name="title" required placeholder="Wer gewinnt den Clan Fight am Samstag?"></div>
          <div class="grid-2" style="gap:12px">
            <div class="field"><label>Kategorie</label><select class="input" name="category">
              ${Object.entries(CATS).filter(([k]) => k !== 'all').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
            <div class="field"><label>Emoji</label><input class="input" name="emoji" value="⚔️"></div>
          </div>
          <div class="field"><label>Outcomes (eine pro Zeile – „Ja" und „Nein" für Ja/Nein-Märkte)</label>
            <textarea class="input" name="outcomes" rows="4">Ja\nNein</textarea></div>
          <div class="grid-2" style="gap:12px">
            <div class="field"><label>Handel endet</label><input class="input" type="datetime-local" name="closesAt" value="${soon.toISOString().slice(0, 16)}"></div>
            <div class="field"><label>Liquidität (b)</label><input class="input" name="b" inputmode="numeric" placeholder="Standard"></div>
          </div>
          <div class="field"><label>Regeln / Auflösung</label><textarea class="input" name="description" rows="3" placeholder="Wie wird entschieden, wer gewinnt?"></textarea></div>
          <button class="btn btn-primary btn-block">Markt erstellen</button>
        </form>
      </div>
      <div class="stack">
        <div class="card"><h2>Aktive Märkte</h2>
          ${active.length ? active.map((m) => `<div style="padding:12px 0;border-top:1px solid var(--line)">
            <a href="#/market/${m.id}"><b>${esc(m.emoji)} ${esc(m.title)}</b></a> <span class="chip ${STATUS[m.status][1]}">${STATUS[m.status][0]}</span>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <select class="input" style="flex:1;min-width:140px;padding:6px 10px" data-sel="${m.id}">
                ${m.outcomes.map((o) => `<option value="${o.id}">${esc(o.label)} (${pct(o.price)})</option>`).join('')}</select>
              <button class="btn btn-sm btn-yes" data-resolve="${m.id}">Auflösen</button>
              ${m.status === 'open' ? `<button class="btn btn-sm" data-close="${m.id}">Schließen</button>` : ''}
              <button class="btn btn-sm btn-no" data-cancelm="${m.id}">Stornieren</button>
            </div></div>`).join('') : '<p class="muted">Keine aktiven Märkte.</p>'}
        </div>
        <div class="card"><h2>Guthaben anpassen</h2>
          <form id="credit" style="display:flex;gap:8px;flex-wrap:wrap">
            <input class="input" name="username" placeholder="Website-Username" style="flex:2;min-width:140px" required>
            <input class="input" name="amount" placeholder="±Betrag" style="flex:1;min-width:90px" required>
            <input class="input" name="note" placeholder="Notiz" style="flex:2;min-width:140px">
            <button class="btn">Buchen</button>
          </form>
        </div>
      </div>
    </div>
    <div class="grid-2" style="margin-top:20px">
      <div class="card"><h2>Auszahlungen</h2><div class="table-wrap"><table class="table"><tbody>
        ${ov.withdrawals.map((w) => `<tr><td>${esc(w.username)} → ${esc(w.mc_name)}</td><td class="mono">${money(w.amount)}</td>
          <td><span class="chip ${w.status === 'done' ? 'live' : w.status === 'failed' ? 'bad' : 'warn'}">${w.status}</span></td><td class="muted">${ago(w.created_at)}</td></tr>`).join('') || '<tr><td class="muted">Keine</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><h2>Einzahlungen</h2><div class="table-wrap"><table class="table"><tbody>
        ${ov.deposits.map((d) => `<tr><td>${esc(d.mc_name)}</td><td class="mono yes">+${money(d.amount)}</td>
          <td>${d.username ? esc(d.username) : '<span class="chip warn">nicht verknüpft</span>'}</td><td class="muted">${ago(d.created_at)}</td></tr>`).join('') || '<tr><td class="muted">Keine</td></tr>'}
      </tbody></table></div></div>
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
    if (!confirm(`Markt mit „${sel.selectedOptions[0].text}" auflösen? Das kann nicht rückgängig gemacht werden.`)) return;
    run(() => api(`/admin/markets/${b.dataset.resolve}/resolve`, { outcomeId: Number(sel.value) }), 'Markt aufgelöst, Gewinne ausgezahlt');
  });
  app.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => run(() => api(`/admin/markets/${b.dataset.close}/close`, {}), 'Handel gestoppt'));
  app.querySelectorAll('[data-cancelm]').forEach((b) => b.onclick = () => {
    if (!confirm('Markt stornieren und alle Einsätze erstatten?')) return;
    run(() => api(`/admin/markets/${b.dataset.cancelm}/cancel`, {}), 'Markt storniert');
  });
}

// ---------- Login ----------

function viewLogin(query) {
  let register = query?.has('register');
  const render = () => {
    app.innerHTML = `<div class="auth card">
      <div class="logo"><span class="logo-mark"><i></i><i></i><i></i></span>Hugo<b>Predict</b></div>
      <div class="tabs"><button data-t="login" class="${register ? '' : 'on'}">Login</button><button data-t="reg" class="${register ? 'on' : ''}">Registrieren</button></div>
      <form id="auth">
        <div class="field"><label>Username</label><input class="input" name="username" autocomplete="username" required></div>
        <div class="field"><label>Passwort</label><input class="input" type="password" name="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="${register ? 8 : 1}"></div>
        <button class="btn btn-primary btn-block">${register ? 'Account erstellen' : 'Einloggen'}</button>
        ${register ? '<p class="muted" style="font-size:13px;margin-bottom:0">Deinen Minecraft-Account verknüpfst du danach in der Wallet.</p>' : ''}
      </form></div>`;
    app.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { register = b.dataset.t === 'reg'; render(); });
    document.getElementById('auth').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(register ? '/register' : '/login', Object.fromEntries(new FormData(e.target)));
        await refreshMe();
        toast(register ? 'Willkommen bei HugoPredict!' : `Hi ${state.me.username}!`);
        location.hash = register ? '#/wallet' : '#/';
      } catch (err) { toast(err.message, true); }
    };
  };
  render();
}

// ---------- Boot ----------

window.addEventListener('hashchange', router);
refreshMe().catch(() => {}).finally(router);
setInterval(() => refreshMe().catch(() => {}), 30000);

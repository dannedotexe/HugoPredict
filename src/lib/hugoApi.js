'use strict';

const crypto = require('node:crypto');

/*
 * Client für die HugoPredict-Website.
 *
 * Das Repository enthält (noch) keine Website-API. Dieser Client definiert daher
 * eine klar abgegrenzte Schnittstelle, die die Website implementieren muss
 * (siehe docs/API.md). Der Bot führt selbst KEINE Wirtschaft: Guthaben,
 * Positionen, Transaktionen, Daily-Rewards, Prognosen und Ranglisten kommen
 * ausschließlich von der Website. Ist die API nicht konfiguriert oder antwortet
 * fehlerhaft, wird das klar gemeldet – es werden nie Werte erfunden oder
 * Transaktionen als erfolgreich gemeldet.
 */

class ApiError extends Error {
  constructor(code, message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

const USER_MESSAGES = {
  not_configured: 'Die Verbindung zur Website ist noch nicht eingerichtet. Bitte wende dich an das Team.',
  not_linked: 'Dein Discord-Konto ist noch nicht mit HugoPredict verknüpft. Nutze /verify.',
  not_found: 'Der angefragte Datensatz wurde auf der Website nicht gefunden.',
  unauthorized: 'Der Bot ist bei der Website nicht autorisiert. Das Team wurde informiert.',
  rate_limited: 'Die Website ist gerade ausgelastet. Bitte versuche es gleich erneut.',
  timeout: 'Die Website hat nicht rechtzeitig geantwortet. Bitte versuche es später erneut.',
  network: 'Die Website ist momentan nicht erreichbar. Bitte versuche es später erneut.',
  server: 'Auf der Website ist ein Fehler aufgetreten. Bitte versuche es später erneut.',
  invalid_response: 'Die Website hat eine unerwartete Antwort geliefert. Das Team wurde informiert.',
  bad_request: 'Die Anfrage wurde von der Website abgelehnt.',
  conflict: 'Diese Aktion wurde bereits ausgeführt.',
};

function userMessage(err) {
  if (err instanceof ApiError) {
    // Die Website darf eine eigene, für Nutzer bestimmte Meldung mitsenden.
    const custom = typeof err.body?.message === 'string' ? err.body.message.slice(0, 300) : null;
    if (custom && ['bad_request', 'conflict', 'not_found', 'not_linked'].includes(err.code)) return custom;
    return USER_MESSAGES[err.code] ?? USER_MESSAGES.server;
  }
  return USER_MESSAGES.server;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const SNOWFLAKE = /^\d{15,25}$/;
const PAYOUT_ID = /^[\w-]{1,64}$/;
const MC_NAME = /^[A-Za-z0-9_]{3,16}$/;
const MARKET_STATUSES = ['open', 'paused', 'closed', 'resolved', 'rejected'];
const LEADERBOARDS = ['weekly', 'all-time', 'accuracy', 'biggest-wins'];

function requireArray(body, key) {
  if (!isObj(body) || !Array.isArray(body[key])) {
    throw new ApiError('invalid_response', `Antwort enthält kein Array "${key}".`, { body });
  }
  return body[key];
}

function normalizeMarket(m) {
  if (!isObj(m) || (typeof m.id !== 'string' && !isNum(m.id)) || typeof m.title !== 'string') return null;
  return {
    id: String(m.id),
    title: m.title,
    description: typeof m.description === 'string' ? m.description : '',
    yesPrice: isNum(m.yesPrice) ? m.yesPrice : null,
    noPrice: isNum(m.noPrice) ? m.noPrice : null,
    volume: isNum(m.volume) ? m.volume : null,
    status: typeof m.status === 'string' ? m.status : 'unknown',
    outcome: typeof m.outcome === 'string' ? m.outcome : null,
    closesAt: m.closesAt ?? null,
    resolvesAt: m.resolvesAt ?? null,
    resolvedAt: m.resolvedAt ?? null,
    createdAt: m.createdAt ?? null,
    rejectionReason: typeof m.rejectionReason === 'string' ? m.rejectionReason : null,
    url: typeof m.url === 'string' ? m.url : null,
  };
}

class HugoApi {
  constructor({ baseUrl, apiKey, timeoutMs = 8000, fetchImpl = globalThis.fetch, logger = console } = {}) {
    this.baseUrl = (baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = apiKey ?? '';
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.logger = logger;
  }

  get configured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async request(method, path, { body, query, idempotencyKey, retries = method === 'GET' ? 1 : 0 } = {}) {
    if (!this.configured) throw new ApiError('not_configured', 'HUGO_API_URL/HUGO_API_KEY nicht gesetzt.');

    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));

    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': 'HugoPredict-Discord-Bot/2.0',
      'X-Request-Id': crypto.randomUUID(),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const code = err?.name === 'AbortError' ? 'timeout' : 'network';
        if (attempt < retries) continue;
        throw new ApiError(code, `${method} ${path}: ${err?.message ?? err}`);
      }
      clearTimeout(timer);

      const text = await res.text().catch(() => '');
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          if (res.ok) throw new ApiError('invalid_response', `${method} ${path}: Antwort ist kein JSON.`, { status: res.status });
        }
      }

      if (res.ok) return parsed ?? {};
      if (res.status >= 500 && attempt < retries) continue;

      const code =
        res.status === 400 || res.status === 422 ? 'bad_request'
          : res.status === 401 || res.status === 403 ? 'unauthorized'
            : res.status === 404 ? (parsed?.code === 'not_linked' ? 'not_linked' : 'not_found')
              : res.status === 409 ? 'conflict'
                : res.status === 429 ? 'rate_limited'
                  : 'server';
      throw new ApiError(code, `${method} ${path}: HTTP ${res.status}`, { status: res.status, body: parsed });
    }
  }

  // --- Status -------------------------------------------------------------

  async health() {
    const body = await this.request('GET', '/health', { retries: 0 });
    return { ok: body?.status === 'ok', body };
  }

  // --- Prognosen -------------------------------------------------------------

  async listMarkets({ status = 'open', limit = 50 } = {}) {
    if (!MARKET_STATUSES.includes(status)) throw new TypeError(`Unbekannter Prognosestatus: ${status}`);
    const body = await this.request('GET', '/markets', { query: { status, limit } });
    return requireArray(body, 'markets').map(normalizeMarket).filter(Boolean);
  }

  async createMarketProposal(proposal, idempotencyKey) {
    const body = await this.request('POST', '/markets/proposals', { body: proposal, idempotencyKey });
    if (!isObj(body) || (typeof body.id !== 'string' && !isNum(body.id))) {
      throw new ApiError('invalid_response', 'Antwort beim Anlegen der Prognose enthält keine ID.', { body });
    }
    return { id: String(body.id), url: typeof body.url === 'string' ? body.url : null, status: body.status ?? null };
  }

  // --- Nutzer -------------------------------------------------------------

  userPath(discordId, suffix) {
    if (!SNOWFLAKE.test(String(discordId))) throw new TypeError('Ungültige Discord-ID.');
    return `/users/discord/${discordId}/${suffix}`;
  }

  async getBalance(discordId) {
    const body = await this.request('GET', this.userPath(discordId, 'balance'));
    if (!isObj(body) || !isNum(body.balance)) throw new ApiError('invalid_response', 'Kein gültiges Guthaben.', { body });
    return {
      balance: body.balance,
      available: isNum(body.available) ? body.available : null,
      locked: isNum(body.locked) ? body.locked : null,
      username: typeof body.username === 'string' ? body.username : null,
    };
  }

  async getPortfolio(discordId) {
    const body = await this.request('GET', this.userPath(discordId, 'portfolio'));
    const positions = requireArray(body, 'positions')
      .filter((p) => isObj(p) && typeof p.marketTitle === 'string')
      .map((p) => ({
        marketId: p.marketId != null ? String(p.marketId) : null,
        marketTitle: p.marketTitle,
        side: typeof p.side === 'string' ? p.side : '—',
        shares: isNum(p.shares) ? p.shares : null,
        avgPrice: isNum(p.avgPrice) ? p.avgPrice : null,
        currentPrice: isNum(p.currentPrice) ? p.currentPrice : null,
        value: isNum(p.value) ? p.value : null,
        url: typeof p.url === 'string' ? p.url : null,
      }));
    return { positions, totalValue: isNum(body.totalValue) ? body.totalValue : null };
  }

  async getTransactions(discordId, { limit = 10 } = {}) {
    const body = await this.request('GET', this.userPath(discordId, 'transactions'), { query: { limit } });
    return requireArray(body, 'transactions')
      .filter((t) => isObj(t) && isNum(t.amount))
      .map((t) => ({
        id: t.id != null ? String(t.id) : null,
        type: typeof t.type === 'string' ? t.type : 'unbekannt',
        amount: t.amount,
        description: typeof t.description === 'string' ? t.description : '',
        createdAt: t.createdAt ?? null,
      }));
  }

  /**
   * Fordert den Daily-Bonus an. Erfolg wird NUR gemeldet, wenn die Website
   * ausdrücklich claimed === true und einen Betrag zurückgibt.
   */
  async claimDaily(discordId, idempotencyKey) {
    try {
      const body = await this.request('POST', this.userPath(discordId, 'daily'), { body: {}, idempotencyKey });
      if (!isObj(body) || body.claimed !== true || !isNum(body.amount)) {
        throw new ApiError('invalid_response', 'Daily-Antwort ohne claimed/amount.', { body });
      }
      return {
        claimed: true,
        amount: body.amount,
        balance: isNum(body.balance) ? body.balance : null,
        nextClaimAt: body.nextClaimAt ?? null,
        transactionId: body.transactionId != null ? String(body.transactionId) : null,
      };
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        return { claimed: false, nextClaimAt: err.body?.nextClaimAt ?? null };
      }
      throw err;
    }
  }

  // --- Ranglisten ---------------------------------------------------------

  async getLeaderboard(type, { limit = 10 } = {}) {
    if (!LEADERBOARDS.includes(type)) throw new TypeError(`Unbekannte Rangliste: ${type}`);
    const body = await this.request('GET', `/leaderboards/${type}`, { query: { limit } });
    const entries = requireArray(body, 'entries')
      .filter((e) => isObj(e) && typeof e.username === 'string' && isNum(e.value))
      .map((e, i) => ({
        rank: isNum(e.rank) ? e.rank : i + 1,
        username: e.username,
        discordId: typeof e.discordId === 'string' && SNOWFLAKE.test(e.discordId) ? e.discordId : null,
        value: e.value,
        detail: typeof e.detail === 'string' ? e.detail : null,
      }));
    return { entries, period: typeof body.period === 'string' ? body.period : null, generatedAt: body.generatedAt ?? null };
  }

  // --- Verifizierung -----------------------------------------------------

  async startVerification({ discordId, discordUsername, minecraftName }) {
    const body = await this.request('POST', '/verification/start', { body: { discordId, discordUsername, minecraftName } });
    if (!isObj(body) || typeof body.code !== 'string') {
      throw new ApiError('invalid_response', 'Verifizierungsstart ohne Code.', { body });
    }
    return {
      code: body.code,
      instructions: typeof body.instructions === 'string' ? body.instructions : null,
      expiresAt: body.expiresAt ?? null,
      verifyUrl: typeof body.verifyUrl === 'string' ? body.verifyUrl : null,
    };
  }

  async getVerificationStatus(discordId) {
    if (!SNOWFLAKE.test(String(discordId))) throw new TypeError('Ungültige Discord-ID.');
    const body = await this.request('GET', `/verification/status/${discordId}`);
    if (!isObj(body) || typeof body.verified !== 'boolean') {
      throw new ApiError('invalid_response', 'Verifizierungsstatus ohne verified.', { body });
    }
    return {
      verified: body.verified,
      minecraftName: typeof body.minecraftName === 'string' ? body.minecraftName : null,
      pending: body.pending === true,
    };
  }

  // --- Minecraft-Bot ------------------------------------------------------

  /** Verknüpfung, die der Minecraft-Bot per Code im Spiel bestätigt hat. */
  async linkMinecraftAccount({ discordId, discordUsername, minecraftName, minecraftUuid }) {
    if (!SNOWFLAKE.test(String(discordId))) throw new TypeError('Ungültige Discord-ID.');
    const body = await this.request('POST', '/minecraft/links', {
      body: { discordId, discordUsername, minecraftName, minecraftUuid },
      idempotencyKey: `mc-link:${discordId}:${minecraftUuid}`,
    });
    if (!isObj(body) || body.linked !== true) throw new ApiError('invalid_response', 'Verknüpfung ohne linked === true.', { body });
    return { linked: true };
  }

  /**
   * Meldet eine bestätigte Einzahlung (Betrag in Spielwährung). Den Umrechnungskurs
   * und die Gutschrift in HugoCoins bestimmt allein die Website.
   */
  async reportDeposit({ id, minecraftName, minecraftUuid, amount, receivedAt }) {
    const body = await this.request('POST', '/minecraft/deposits', {
      body: { id, minecraftName, minecraftUuid, amount, receivedAt },
      idempotencyKey: `mc-deposit:${id}`,
    });
    if (!isObj(body) || body.accepted !== true) throw new ApiError('invalid_response', 'Einzahlung ohne accepted === true.', { body });
    return { linked: body.linked === true, credited: isNum(body.credited) ? body.credited : null };
  }

  /** Ein Spieler hat dem Bot den Code von der Website geflüstert. false: Code unbekannt oder abgelaufen. */
  async confirmLogin({ minecraftName, code }) {
    try {
      await this.request('POST', '/minecraft/login-confirm', { body: { minecraftName, code } });
      return true;
    } catch (err) {
      if (err.status === 404) return false;
      throw err;
    }
  }

  /** Zeigt auf der Website, ob der Minecraft-Bot gerade auf dem Server ist. */
  async minecraftHeartbeat({ online, username }) {
    await this.request('POST', '/minecraft/heartbeat', { body: { online, username } });
  }

  // --- Admin-Panel (/panel, nur lesend) ---------------------------------

  async panelSummary() {
    const body = await this.request('GET', '/admin/summary');
    if (!isObj(body) || !isNum(body.users)) throw new ApiError('invalid_response', 'Panel-Übersicht unvollständig.', { body });
    return body;
  }

  async panelUsers({ q = '', offset = 0, limit = 8 } = {}) {
    const body = await this.request('GET', '/admin/users', { query: { q, offset, limit } });
    return { total: isNum(body?.total) ? body.total : 0, users: requireArray(body, 'users') };
  }

  async panelMarkets() {
    return { markets: requireArray(await this.request('GET', '/admin/markets'), 'markets') };
  }

  async panelTransactions({ type = '', limit = 15 } = {}) {
    return { transactions: requireArray(await this.request('GET', '/admin/transactions', { query: { type, limit } }), 'transactions') };
  }

  /** Vom Team freigegebene Auszahlungen, die der Bot im Spiel ausführen soll. */
  async listPayouts() {
    const body = await this.request('GET', '/minecraft/payouts', { query: { status: 'approved' } });
    return requireArray(body, 'payouts')
      .filter((p) => isObj(p) && PAYOUT_ID.test(String(p.id)) && MC_NAME.test(String(p.minecraftName)) && isNum(p.amount) && p.amount > 0)
      .map((p) => ({ id: String(p.id), minecraftName: p.minecraftName, amount: p.amount }));
  }

  async completePayout(id, { paidAt }) {
    if (!PAYOUT_ID.test(String(id))) throw new TypeError('Ungültige Auszahlungs-ID.');
    await this.request('POST', `/minecraft/payouts/${id}/complete`, { body: { paidAt }, idempotencyKey: `mc-payout-complete:${id}` });
  }

  /** uncertain: Der Bot weiß nicht sicher, ob das Geld geflossen ist – das Team muss prüfen. */
  async failPayout(id, { reason, uncertain = false }) {
    if (!PAYOUT_ID.test(String(id))) throw new TypeError('Ungültige Auszahlungs-ID.');
    await this.request('POST', `/minecraft/payouts/${id}/fail`, { body: { reason, uncertain }, idempotencyKey: `mc-payout-fail:${id}` });
  }
}

module.exports = { HugoApi, ApiError, userMessage, normalizeMarket, LEADERBOARDS, MARKET_STATUSES };

# Website-Schnittstelle für den Discord-Bot

Im Repository gibt es **keine** Website- oder API-Implementierung. Damit der Bot keine
zweite, unabhängige Wirtschaft aufbaut, liest und schreibt er Wirtschaftsdaten
ausschließlich über die folgende Schnittstelle. Die Website muss sie bereitstellen
(oder einen Adapter auf ihre bestehende API setzen). Solange `HUGO_API_URL` und
`HUGO_API_KEY` fehlen, sind die betroffenen Funktionen deaktiviert und melden das
offen. Es werden keine Ersatzwerte erfunden.

Implementiert ist der Client in `src/lib/hugoApi.js`.

## Allgemein

| | |
|---|---|
| Basis-URL | `HUGO_API_URL`, z. B. `https://hugosmp-market.de/api/bot` (HTTPS Pflicht) |
| Authentifizierung | `Authorization: Bearer <HUGO_API_KEY>`. Ein eigener Schlüssel nur für den Bot, serverseitig prüfen |
| Format | JSON (`Content-Type: application/json`) |
| Tracing | Jeder Request trägt `X-Request-Id` (UUID) |
| Idempotenz | Schreibende Requests tragen `Idempotency-Key`. Die Website **muss** bei gleichem Schlüssel dieselbe Wirkung nur einmal ausführen und die ursprüngliche Antwort wiederholen |
| Timeout | `HUGO_API_TIMEOUT_MS` (Standard 8 s). GET wird bei Netzwerkfehler/5xx einmal wiederholt, POST nie |
| Preise | `yesPrice`/`noPrice` als Wahrscheinlichkeit von `0` bis `1` |
| Zeitpunkte | ISO-8601 (`2026-11-01T18:00:00Z`) |

### Statuscodes

| Code | Bedeutung im Bot |
|---|---|
| 2xx | Erfolg (Antwort wird validiert) |
| 400 / 422 | Anfrage abgelehnt. Ein optionales `message` wird dem Nutzer angezeigt |
| 401 / 403 | Bot nicht autorisiert (wird in `#bot-logs` gemeldet) |
| 404 + `{"code":"not_linked"}` | Discord-Account ist mit keinem Konto verknüpft |
| 404 | Datensatz nicht gefunden |
| 409 | Bereits ausgeführt (z. B. Daily heute schon abgeholt) |
| 429 | Website ausgelastet |
| 5xx | Fehler auf der Website |

## Endpunkte

### `GET /health`
`{ "status": "ok" }`, wird im Status-Channel angezeigt.

### `GET /markets?status=open|paused|closed|resolved|rejected&limit=N`
```json
{ "markets": [{
  "id": "m_123", "title": "Gewinnt Fraktion X das Event?", "description": "…",
  "yesPrice": 0.62, "noPrice": 0.38, "volume": 15230,
  "status": "open", "outcome": null, "rejectionReason": null,
  "closesAt": "2026-11-01T18:00:00Z", "resolvesAt": "2026-11-02T12:00:00Z",
  "createdAt": "2026-10-20T10:00:00Z", "url": "https://hugosmp-market.de/markets/m_123"
}] }
```
Pflichtfelder: `id`, `title`. Fehlende optionale Werte zeigt der Bot als „—“ an.

Status: `open` (Handel läuft), `paused` (Handel vorübergehend ausgesetzt), `closed` (Handel beendet,
Entscheidung ausstehend), `resolved` (entschieden, `outcome` gesetzt, optional `resolvedAt`), `rejected`.
#prognosen fragt `open`, `paused`, `closed` und die letzten 25 `resolved` ab.

### `GET /users/discord/{discordId}/balance`
`{ "balance": 1250, "available": 1000, "locked": 250, "username": "Steve" }`
(Pflicht: `balance`)

### `GET /users/discord/{discordId}/portfolio`
```json
{ "totalValue": 480, "positions": [{
  "marketId": "m_123", "marketTitle": "…", "side": "yes", "shares": 100,
  "avgPrice": 0.55, "currentPrice": 0.62, "value": 62, "url": "https://…"
}] }
```

### `GET /users/discord/{discordId}/transactions?limit=N`
`{ "transactions": [{ "id": "t_1", "type": "trade", "amount": -55, "description": "…", "createdAt": "…" }] }`

### `POST /users/discord/{discordId}/daily`
Header `Idempotency-Key: discord-daily:<discordId>:<YYYY-MM-DD>` (UTC-Tag).
- Erfolg (200): `{ "claimed": true, "amount": 50, "balance": 1300, "nextClaimAt": "…", "transactionId": "t_99" }`
- Bereits abgeholt (409): `{ "nextClaimAt": "…" }`

Der Bot meldet eine Gutschrift **nur**, wenn `claimed === true` und `amount` eine Zahl ist.
Betrag, Cooldown und Buchung bestimmt allein die Website.

### `GET /leaderboards/{weekly|all-time|accuracy|biggest-wins}?limit=N`
```json
{ "period": "KW 44/2026", "generatedAt": "…", "entries": [
  { "rank": 1, "username": "Steve", "discordId": "1234…", "value": 5230, "detail": "42 Trades" }
] }
```
`value` ist bei `accuracy` eine Quote von 0 bis 1, sonst ein Betrag.

### `POST /verification/start`
Body: `{ "discordId": "…", "discordUsername": "…", "minecraftName": "Steve" }`
Antwort: `{ "code": "A1B2C3", "instructions": "Gib auf HugoSMP /link A1B2C3 ein.", "expiresAt": "…", "verifyUrl": "https://…" }`
(Pflicht: `code`. `instructions` wird dem Nutzer angezeigt. Wie der Code bestätigt wird, entscheidet die Website bzw. das Minecraft-Plugin)

### `GET /verification/status/{discordId}`
`{ "verified": true, "minecraftName": "Steve", "pending": false }`
Die Rolle **Verified** vergibt der Bot erst bei `verified === true`.

### `POST /markets/proposals`
Nur aktiv bei `MARKET_CREATION_ENABLED=true`. Wird erst aufgerufen, wenn die Prognoseverwaltung einen Vorschlag annimmt.
Header `Idempotency-Key: discord-suggestion:<id>`.
```json
{ "title": "…", "description": "…", "outcomes": ["Ja", "Nein"], "resolutionSource": "…",
  "requestedCloseAt": "31.12.2026 20:00", "proposedByDiscordId": "…", "approvedByDiscordId": "…",
  "discordSuggestionId": "…" }
```
Antwort: `{ "id": "m_456", "url": "https://…", "status": "draft" }` (Pflicht: `id`).
Die Website sollte selbst prüfen, ob `approvedByDiscordId` dazu berechtigt ist.

## Minecraft-Bot

Ist `MC_ENABLED=true`, verknüpft der Minecraft-Bot Konten selbst: Er flüstert dem Spieler
auf HugoSMP einen Code zu, der in Discord eingegeben wird. `POST /verification/start` und
`GET /verification/status` werden dann nicht genutzt. Beträge sind immer **Spielgeld**;
die Website schreibt sie 1:1 in $ gut.

### `POST /minecraft/links`
Header `Idempotency-Key: mc-link:<discordId>:<minecraftUuid>`.
```json
{ "discordId": "1234…", "discordUsername": "steve", "minecraftName": "Steve", "minecraftUuid": "069a79f4-…" }
```
Antwort: `{ "linked": true }`. Ist das Minecraft-Konto schon mit einem anderen Discord-Konto
verknüpft: **409** mit optionalem `message`. Verknüpfungen, die ohne Website entstanden sind,
überträgt der Bot automatisch nach (gleicher Idempotency-Key).

### `POST /minecraft/login-confirm`
Die Website zeigt dem Spieler einen Code, der Spieler flüstert ihn dem Bot. Body: `{ "minecraftName": "Steve", "code": "abcd2345efgh" }`
Antwort: `{ "confirmed": true }`, Code unbekannt, abgelaufen oder schon benutzt: 404 mit `message`.
Der Bot schreibt den Code nie ins Log.

### `POST /minecraft/heartbeat`
`{ "online": true, "username": "HugoPredict" }`, jede Minute. Bleibt er 3 Minuten aus, gilt der Bot als offline.

### `POST /minecraft/deposits`
Eine Einzahlung, die der Bot am **gestiegenen Kontostand** bestätigt hat.
Header `Idempotency-Key: mc-deposit:<id>`. Nicht erreichbare Meldungen wiederholt der Bot.
```json
{ "id": "3f2c…", "minecraftName": "Steve", "minecraftUuid": "069a79f4-…", "amount": 15000, "receivedAt": "2026-10-29T18:00:00Z" }
```
`minecraftUuid` kann `null` sein, wenn der Spieler gerade nicht in der Spielerliste stand.
Antwort: `{ "accepted": true, "linked": true, "credited": 1500 }`
- `linked: false`: Konto noch nicht verknüpft. Die Website **muss** den Betrag trotzdem speichern
  und gutschreiben, sobald die Verknüpfung kommt.
- `credited`: gutgeschriebener Betrag in $ (optional, wird dem Spieler im Spiel angezeigt).

### `GET /minecraft/payouts?status=approved`
Nur Auszahlungen, die das Team freigegeben hat und die noch nicht ausgeführt wurden.
`{ "payouts": [{ "id": "p_1", "minecraftName": "Steve", "amount": 5000 }] }`
Die Website zieht den Betrag beim Beantragen ab, nicht erst nach der Ausführung.

### `POST /minecraft/payouts/{id}/complete`
`{ "paidAt": "…" }`, Header `Idempotency-Key: mc-payout-complete:<id>`. Danach darf die
Auszahlung nicht mehr in der Liste erscheinen.

### `POST /minecraft/payouts/{id}/fail`
`{ "reason": "…", "uncertain": false }`, Header `Idempotency-Key: mc-payout-fail:<id>`.
- `uncertain: false`: Es wurde **nichts** gezahlt (Limit, Bot-Guthaben). Betrag zurückbuchen.
- `uncertain: true`: Der Bot weiß nicht sicher, ob gezahlt wurde. **Nicht** automatisch
  zurückbuchen, das Team prüft im Spiel.

Der Bot führt jede Auszahlungs-ID höchstens einmal aus, auch nach einem Neustart.

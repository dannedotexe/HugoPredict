# HugoPredict: Discord-Bot für HugoSMP Market

Discord-Bot für **HugoSMP Market**, die Prognoseplattform für den Minecraft-Server HugoSMP.
Er richtet den kompletten Discord-Server ein (Rollen, Kategorien, Channels, Berechtigungen),
veröffentlicht Panels, betreibt Markt-Feed, Ranglisten, Tickets, Verifizierung und
Marktvorschläge und bindet die Website über eine klar definierte API an.

> **Wichtig:** Der Bot führt **keine eigene Wirtschaft**. Guthaben, Positionen, Transaktionen,
> Daily-Rewards, Märkte und Ranglisten kommen ausschließlich von der Website
> (Schnittstelle: [`docs/API.md`](docs/API.md)). Ohne konfigurierte API funktionieren
> Setup, Panels, Tickets und Vorschläge trotzdem. Wirtschaftsfunktionen melden dann
> „nicht verbunden“, statt Werte zu erfinden.

## Funktionen

| Bereich | Umsetzung |
|---|---|
| `/setup-server` | Erstellt 11 Rollen, 10 Kategorien und 58 Channels inklusive Berechtigungen. Vorher kommt eine Vorschau mit Bestätigung. Vorhandenes wird erkannt und nicht dupliziert, IDs werden gespeichert. Am Ende steht ein Ergebnis-Embed mit Erfolgen, Hinweisen und Fehlern |
| `/setup-panels` | Willkommen, Regeln (Button „Regeln akzeptieren“ vergibt Member), Website, Verifizierung, Ticket-Panel, Transaktions- und Betrugs-Panel, Marktvorschläge, FAQ, Status. Ein erneuter Aufruf **bearbeitet** die Panels, statt neue zu posten |
| Verifizierung | `/verify` oder Panel-Button, dann Code über die Website-API, dann „Status prüfen“. **Verified** wird erst vergeben, wenn die Website `verified: true` meldet |
| Konto | `/balance`, `/portfolio`, `/history`, `/daily`. Alle Antworten sind ephemer, also nur für dich sichtbar |
| Märkte | `/markets` mit Auswahlmenü für Details. Live-Feed in `📈・live-markets` (eine Nachricht pro Markt, die nur bei Änderungen bearbeitet wird), Top-Märkte, „bald entschieden“, neue, entschiedene und abgelehnte Märkte, Preisbewegungen ab 5 Prozentpunkten mit 30 Minuten Cooldown |
| Ranglisten | Wöchentlich, All-Time, Trefferquote, größte Gewinne. Eine Nachricht pro Channel, die automatisch aktualisiert wird. Nur echte API-Daten |
| Tickets | 5 Typen. Jedes Ticket ist ein privater Channel nur für den Ersteller und das zuständige Team. Es gibt „Übernehmen“ und „Schließen“ (mit Bestätigung). Beim Schließen landet ein Abschluss-Log mit `.txt`-Transkript in `🎫・ticket-logs` |
| Vorschläge | Modal mit Titel, Beschreibung, Ergebnissen, Entscheidungsquelle und Enddatum. Abstimmung in `🗳️・community-votes`, Entscheidung in `⚖️・markt-entscheidungen` (nur Market Moderator/Leitung, mit Begründung). Eine Annahme legt den Markt nur bei aktivierter API an (`MARKET_CREATION_ENABLED`). Abgelehnte Vorschläge erscheinen in `❌・abgelehnte-märkte` |
| Sicherheit | Privilegien-Prüfung bei jedem privilegierten Command und Button, Rate-Limits, Sperren gegen Doppelklicks, Idempotency-Keys für Daily und Marktanlage. Verweigerte Zugriffe gehen nach `🚨・sicherheits-logs`, Admin-Eingriffe nach `📝・moderations-logs`, Fehler nach `🛠️・bot-logs` |

### Rollen und Rechte (Kurzfassung)

- **🛡️ Administrator** ist die **einzige** Rolle mit dem Administrator-Recht. **👑 Owner** hat
  umfassende Verwaltungsrechte, aber bewusst ohne Administrator-Flag.
- **⚖️ Market Moderator** verwaltet Nachrichten in den Markt-Channels und entscheidet über
  Vorschläge. Keine Guthaben-Funktionen, kein Zugriff auf Wirtschafts- und Transaktions-Logs.
- **🎫 Support** sieht und bearbeitet die zugewiesenen Tickets. Er kann keine Kontostände
  ändern, denn der Bot hat dafür überhaupt keine Funktion.
- **🛠️ Developer** hat Webhooks, Audit-Log, `🧪・test-channel` und `🛠️・bot-logs`, aber
  keine Wirtschafts-Logs.
- Mitglieder können sich nur **Member** (Regeln akzeptieren) und **Verified** (nach bestätigter
  Verifizierung) über den Bot holen. Alle anderen Rollen vergeben nur Menschen.
- Team-Channels sind für alle Nicht-Team-Rollen unsichtbar. `📊・wirtschafts-logs`,
  `💸・transaktions-logs`, `🚨・sicherheits-logs` und `👑・leitung` sind nur für Owner/Admin.
- Sichtbarkeit: `📌 START HERE` und Support-Infos sieht jeder. Community, Märkte, HugoSMP und
  Rankings gibt es ab **Member**. Die Command-Channels in TRADING gibt es ab **Verified**
  (dort sind nur Slash-Commands erlaubt, keine öffentlichen Nachrichten).
- Zusätzlich legt das Setup die private Kategorie **🎫 TICKETS** für Ticket-Channels an.

Die komplette Struktur steht deklarativ in [`src/config/serverLayout.js`](src/config/serverLayout.js).

## Installation

Voraussetzung: **Node.js 18.17 oder neuer** (empfohlen: 22 LTS).

```bash
git clone https://github.com/dannedotexe/HugoPredict.git
cd HugoPredict
npm install
cp .env.example .env    # danach .env ausfüllen
```

### 1. Bot im Discord Developer Portal anlegen

1. <https://discord.com/developers/applications>, dann **New Application**.
2. Unter **Bot** auf **Reset Token** klicken und den Token als `DISCORD_TOKEN` in `.env` eintragen.
3. Unter **General Information** die **Application ID** als `DISCORD_CLIENT_ID` eintragen.
4. Optional bei `WELCOME_ON_JOIN=true`: Unter **Bot** den Schalter **Server Members Intent** aktivieren.
5. Bot einladen (ersetze `CLIENT_ID`):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=380410130000
   ```
   Die Berechtigungszahl enthält genau die Rechte, die das Setup braucht
   (u. a. Rollen und Channels verwalten, Nachrichten verwalten). **Kein** Administrator-Recht.
6. Server-ID kopieren (Entwicklermodus, dann Rechtsklick auf den Server) und als `DISCORD_GUILD_ID` eintragen.

### 2. Slash-Commands registrieren und starten

```bash
npm run deploy   # registriert die Commands (bei DISCORD_GUILD_ID sofort)
npm start        # startet den Bot
```

### 3. Server einrichten

1. **Servereinstellungen → Rollen:** Die Bot-Rolle ganz nach **oben** ziehen. Der Bot kann
   nur Rollen erstellen, sortieren und vergeben, die unter seiner eigenen Rolle liegen.
2. Im Discord `/setup-server` ausführen, die Vorschau prüfen und mit **Setup starten** bestätigen.
   - Option `berechtigungen_synchronisieren: true` setzt auch bereits vorhandene
     Channels und Rollen auf das Standard-Layout zurück.
3. Das Ergebnis-Embed lesen. Unter **Hinweise** steht, was manuell ergänzt werden muss:
   Discord erlaubt Bots nur, Rechte zu vergeben, die sie selbst besitzen. Das
   **Administrator**-Recht der Rolle 🛡️ Administrator sowie z. B. *Mitglieder bannen* für 👑 Owner
   musst du deshalb einmal selbst in den Rolleneinstellungen setzen.
4. `/setup-panels` ausführen.
5. Dir selbst die Rolle 👑 Owner geben und dem Team die passenden Rollen zuweisen.
6. Optional: Die Bot-Rolle danach unter 🛡️ Administrator schieben. Sie muss aber über
   ⛏️ Verified und 👤 Member bleiben, damit der Bot diese vergeben kann.

`/setup-server` und `/setup-panels` können beliebig oft ausgeführt werden.

### 4. Website anbinden

`WEBSITE_URL`, `HUGO_API_URL` und `HUGO_API_KEY` setzen und auf der Website die Endpunkte aus
[`docs/API.md`](docs/API.md) bereitstellen. Danach den Bot neu starten. Der Status-Channel
zeigt, ob die Verbindung steht.

## Umgebungsvariablen

| Variable | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `DISCORD_TOKEN` | ja | | Bot-Token (geheim) |
| `DISCORD_CLIENT_ID` | ja | | Application ID |
| `DISCORD_GUILD_ID` | empfohlen | | Server-ID für sofortige Command-Registrierung |
| `WEBSITE_URL` | nein | | Link in Panels/Embeds |
| `HUGO_API_URL` | für Wirtschaft | | Basis-URL der Bot-API (HTTPS) |
| `HUGO_API_KEY` | für Wirtschaft | | API-Schlüssel (geheim) |
| `HUGO_API_TIMEOUT_MS` | nein | `8000` | Timeout pro Request |
| `MARKET_CREATION_ENABLED` | nein | `false` | Angenommene Vorschläge per API anlegen |
| `CURRENCY_NAME` | nein | `HC` | Währungsname |
| `MARKET_FEED_INTERVAL_SECONDS` | nein | `60` | Aktualisierung des Markt-Feeds |
| `MARKET_FEED_MAX_MARKETS` | nein | `20` | Maximal angezeigte Live-Märkte |
| `CLOSING_SOON_HOURS` | nein | `48` | Zeitraum für „bald entschieden“ |
| `LEADERBOARD_INTERVAL_MINUTES` | nein | `15` | Aktualisierung der Ranglisten |
| `TICKET_CLOSE_CONFIRMATION` | nein | `true` | Bestätigung vor dem Schließen |
| `MAX_OPEN_TICKETS_PER_USER` | nein | `2` | Offene Tickets pro Nutzer |
| `WELCOME_ON_JOIN` | nein | `false` | Begrüßung pro Beitritt (Members-Intent nötig) |
| `DATA_DIR` | nein | `./data` | Speicherort für IDs, Panels, Tickets |
| `LOG_LEVEL` | nein | `info` | `debug`/`info`/`warn`/`error` |

`.env` und `data/` stehen in `.gitignore` und dürfen nie committet werden.

## Hosting auf Oracle Cloud (Always Free)

Der Bot braucht nur **ausgehende** Verbindungen (Discord-Gateway und deine API). Du musst
also keine Ports öffnen. Eine Always-Free-VM (z. B. *VM.Standard.A1.Flex*, Ampere/ARM,
Ubuntu 22.04/24.04) reicht dafür locker aus.

```bash
# Auf der VM (per SSH als ubuntu):
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo git clone https://github.com/dannedotexe/HugoPredict.git /opt/hugosmp-market-bot
sudo useradd --system --home-dir /opt/hugosmp-market-bot --shell /usr/sbin/nologin hugobot
sudo chown -R hugobot:hugobot /opt/hugosmp-market-bot
cd /opt/hugosmp-market-bot
sudo -u hugobot npm ci --omit=dev
sudo -u hugobot cp .env.example .env && sudo -u hugobot nano .env   # Werte eintragen
sudo chmod 600 .env
sudo -u hugobot mkdir -p data
sudo -u hugobot npm run deploy

sudo cp deploy/hugosmp-market-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hugosmp-market-bot
journalctl -u hugosmp-market-bot -f    # Logs ansehen
```

Updates einspielen: `cd /opt/hugosmp-market-bot && sudo -u hugobot git pull && sudo -u hugobot npm ci --omit=dev && sudo systemctl restart hugosmp-market-bot`.

Wenn das Repository privat ist, verwende zum Klonen einen Deploy-Key oder ein
Personal-Access-Token. Sichere `data/store.json` regelmäßig, denn dort liegen die
gespeicherten IDs.

## Entwicklung

```bash
npm test         # Unit-Tests (Layout, Berechtigungen, API-Client, Feeds, Builder)
npm run check    # Syntaxprüfung aller Dateien + Validierung aller Commands
```

### Projektstruktur

```
src/
  index.js                 Bot-Start, Interaction-Router, Intervalle
  deploy-commands.js       Slash-Command-Registrierung
  registry.js              Lädt Commands und Interaktions-Handler
  config/
    env.js                 Umgebungsvariablen (validiert)
    serverLayout.js        Rollen, Kategorien, Channels, Berechtigungen, Ticket-Typen
    theme.js               Farben/Design
  lib/
    hugoApi.js             Website-API-Client (siehe docs/API.md)
    store.js               Persistente IDs/Panels/Tickets (data/store.json)
    guildContext.js        Key→ID-Auflösung, Rechteprüfung, Audit-Logs
    rateLimit.js           Rate-Limits und Sperren
    embeds.js, respond.js, logger.js
  setup/
    setupServer.js         /setup-server-Logik (idempotent)
    panels.js              /setup-panels-Inhalte
  services/
    marketFeed.js          Live-Markets, Top, bald entschieden, neu/entschieden/abgelehnt, Preisbewegungen
    leaderboards.js        Automatische Ranglisten
    status.js              Status-Channel
  commands/                Slash-Commands
  interactions/            Buttons, Modals, Select-Menüs (tickets, suggestions, verification, rules, markets)
docs/API.md                Schnittstelle, die die Website bereitstellen muss
deploy/                    systemd-Dienst
test/                      node:test-Tests
```

Custom-IDs folgen dem Schema `hm:<bereich>:<aktion>[:<arg>]`. Neue Channels oder Rollen
fügst du in `serverLayout.js` hinzu und führst danach `/setup-server` erneut aus.

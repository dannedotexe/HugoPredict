# HugoPredict: Discord-Bot

Discord-Bot für **HugoPredict**, den Prognosemarkt für Ereignisse rund um den Minecraft-Server HugoSMP.
Er richtet eine schlanke, professionelle Serverstruktur ein, veröffentlicht Dokumentation und
Kundenservice-Panel, pflegt die Marktübersicht und bindet die Website über eine klar definierte
API an.

> **Wichtig:** Der Bot führt **keine eigene Wirtschaft**. Guthaben, Positionen, Transaktionen,
> Daily-Boni, Märkte und Ranglisten kommen ausschließlich von der Website
> (Schnittstelle: [`docs/API.md`](docs/API.md)). Ohne konfigurierte API funktionieren
> Einrichtung, Dokumentation, Kundenservice und Vorschläge trotzdem. Kontofunktionen melden
> dann „nicht verbunden“, statt Werte zu erfinden.

## Serverstruktur

| Kategorie | Channels | Sichtbar für |
|---|---|---|
| **INFORMATIONEN** | `ankündigungen`, `marktübersicht`, `dokumentation` | alle (nur lesen) |
| **COMMUNITY** | `diskussionen`, `marktanalysen` | ab *Mitglied* |
| **KUNDENSERVICE** | `support` (+ private Anfrage-Channels) | alle (nur lesen); Anfragen nur für Ersteller und Team |
| **INTERN · PRIVAT** | `betrieb`, `prüfprotokoll`, `systemmeldungen`, `moderation`, `team` | nur zuständige Teamrollen |

**Interne Channels im Detail**

| Channel | Inhalt | Zugriff |
|---|---|---|
| `betrieb` | Marktvorschläge prüfen, annehmen, ablehnen | Marktverwaltung, Inhaber, Administrator |
| `prüfprotokoll` | Einrichtung, Ankündigungen, Daily-Gutschriften, Kontoverknüpfungen, verweigerte Zugriffe | Inhaber, Administrator (nur lesen) |
| `systemmeldungen` | Systemstatus, API-Störungen, Fehler | Entwickler, Inhaber, Administrator (nur lesen) |
| `moderation` | Moderation, Ticket-Protokolle mit Transkript | Moderator, Support, Inhaber, Administrator |
| `team` | Internes Team | alle Teamrollen |

**Rollen** (in dieser Reihenfolge). Es gibt keine Level- oder Prestige-Rollen.

| Rolle | Aufgabe |
|---|---|
| Inhaber | Vollzugriff auf Server, Bot und Plattform |
| Administrator | Serververwaltung, Benutzer und Moderation |
| Entwickler | Technik, Bot, Website und Systemwartung |
| Marktverwaltung | Märkte prüfen, verwalten und Ergebnisse bearbeiten |
| Moderator | Regeln durchsetzen und Diskussionen moderieren |
| Support | Tickets bearbeiten und Nutzern helfen |
| Verifiziert | Minecraft-Konto erfolgreich verknüpft |
| Mitglied | Standardrolle für Community-Mitglieder |
| HugoPredict Bot | Technische Rolle für den Discord-Bot |

- **Administrator** ist die **einzige** Rolle mit dem Administrator-Recht. **Inhaber** hat
  umfassende Verwaltungsrechte, aber bewusst ohne Administrator-Flag.
- **Marktverwaltung** moderiert `marktübersicht` und entscheidet über Vorschläge, hat aber keine
  Guthaben-Funktionen und keinen Zugriff auf das Prüfprotokoll.
- **Support** bearbeitet zugewiesene Anfragen. Kontostände lassen sich über den Bot
  grundsätzlich nicht ändern.
- **Mitglied** (über „Regeln akzeptieren“) und **Verifiziert** (nach bestätigter Kontoverknüpfung)
  sind die einzigen Rollen, die der Bot selbst vergibt.
- Ankündigungen veröffentlichen nur Inhaber und Administrator, auf Wunsch über `/ankündigung`.

Die komplette Struktur steht deklarativ in [`src/config/serverLayout.js`](src/config/serverLayout.js),
die Texte von `dokumentation` in [`src/config/docs.js`](src/config/docs.js).

### Custom-Emojis

Statt Standard-Emojis nutzt der Bot ein eigenes, einheitliches Icon-Set: Linien-Icons in Emerald auf
dunkler Kachel (`assets/emojis/`, erzeugt mit `scripts/build-emojis.js`). Beim Start lädt der Bot sie
als **Application Emojis** hoch. Sie gehören dem Bot und belegen keine Emoji-Plätze des Servers.
Verwendet werden sie in Panels, Buttons, Auswahlmenüs, der Marktübersicht und im Systemstatus.
Channel-Namen bleiben ohne Emojis, weil Discord dort keine Custom-Emojis zulässt. Hat der Server
Boost-Stufe 2, setzt `/setup-server` die Icons zusätzlich als **Rollen-Icons**. Bereits gesetzte
Icons werden nicht überschrieben. Fehlt ein Emoji, wird es weggelassen und nie durch ein
Standard-Emoji ersetzt.

## Funktionen

| Bereich | Umsetzung |
|---|---|
| `/setup-server` | Richtet Rollen, Kategorien, Channels und Berechtigungen ein und **migriert** die frühere Struktur (siehe unten). Vorher kommt eine Vorschau mit Bestätigung. Vorhandenes wird erkannt und nicht dupliziert |
| `/setup-panels` | Dokumentation (mit „Regeln akzeptieren“ und „Konto verknüpfen“), Kundenservice-Panel mit Auswahlmenü, Systemstatus in `systemmeldungen`. Ein erneuter Aufruf **bearbeitet** die Panels, statt neue zu posten |
| `marktübersicht` | Jeder Markt erhält **genau eine Nachricht**. Sie entsteht beim ersten Erscheinen und wird bei Statuswechseln (offen, pausiert, Handel beendet, entschieden) bearbeitet. Kleinstschwankungen lösen keine Bearbeitung aus, Folgenachrichten gibt es nicht |
| Konto (privat) | `/verify`, `/balance`, `/portfolio`, `/history`, `/daily`, `/leaderboard`. Alle Antworten sind nur für die anfragende Person sichtbar |
| Kundenservice | Fünf Anliegen. Jede Anfrage wird ein privater Channel nur für Ersteller und zuständiges Team. Es gibt „Übernehmen“ und „Anfrage schließen“ (mit Bestätigung). Das Abschlussprotokoll mit `.txt`-Transkript landet in `moderation` |
| Marktvorschläge | `/vorschlag` öffnet ein Formular. Der Vorschlag wird in `betrieb` geprüft, angenommen oder (mit Begründung) abgelehnt, und die einreichende Person erhält eine Direktnachricht. Eine Annahme legt den Markt nur bei aktivierter API an (`MARKET_CREATION_ENABLED`) |
| Sicherheit | Rechteprüfung bei jedem privilegierten Command, Button und Formular. Dazu kommen Rate-Limits, Sperren gegen Doppelklicks und Idempotency-Keys für Daily und Marktanlage |

## Migration von der früheren Struktur

`/setup-server` erkennt die frühere Struktur (Emoji-Channels wie `📈・live-markets`) über
gespeicherte IDs oder die alten Namen. Die Vorschau listet alle Änderungen auf, bevor etwas passiert.

- **Umbenannt und verschoben** (Nachrichtenverlauf bleibt erhalten, neue Rechte werden gesetzt):
  `📢・ankündigungen` → `ankündigungen`, `📈・live-markets` → `marktübersicht`,
  `👋・willkommen` → `dokumentation`, `💬・allgemeiner-chat` → `diskussionen`,
  `🧠・analysen` → `marktanalysen`, `🎫・ticket-erstellen` → `support`,
  `⚖️・markt-entscheidungen` → `betrieb`, `📝・moderations-logs` → `prüfprotokoll`,
  `🛠️・bot-logs` → `systemmeldungen`, `🎫・ticket-logs` → `moderation`, `💬・team-chat` → `team`.
  Kategorien und Rollen werden ebenso umbenannt (z. B. `👑 Owner` → `Inhaber`).
- **Veraltet** sind alle übrigen Channels und Kategorien sowie die Rollen *Diamond Trader* und
  *Trader*. Sie werden **nie automatisch gelöscht**. Standardmäßig werden sie nur aufgelistet.
  Mit `/setup-server veraltete_archivieren:true` verschiebt der Bot veraltete Channels in eine
  versteckte Kategorie **ARCHIV** (nur Inhaber/Administrator, nur lesen). Leere Kategorien und
  veraltete Rollen kannst du danach selbst löschen.

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
4. Bot einladen (ersetze `CLIENT_ID`):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=378225945680
   ```
   Die Berechtigungszahl enthält genau die Rechte, die das Setup braucht
   (u. a. Rollen und Channels verwalten, Nachrichten verwalten). **Kein** Administrator-Recht.
5. Server-ID kopieren (Entwicklermodus, dann Rechtsklick auf den Server) und als `DISCORD_GUILD_ID` eintragen.

### 2. Slash-Commands registrieren und starten

```bash
npm run deploy   # registriert die Commands (bei DISCORD_GUILD_ID sofort)
npm start        # startet den Bot
```

### 3. Server einrichten

1. **Servereinstellungen → Rollen:** Die Bot-Rolle ganz nach **oben** ziehen. Der Bot kann
   nur Rollen erstellen, umbenennen, sortieren und vergeben, die unter seiner eigenen Rolle liegen.
2. `/setup-server` ausführen, die Vorschau prüfen und mit **Einrichtung starten** bestätigen.
   - `veraltete_archivieren: true` verschiebt Channels der früheren Struktur ins ARCHIV.
   - `berechtigungen_synchronisieren: true` setzt auch unveränderte Channels und Rollen auf
     das Standard-Layout zurück.
3. Das Ergebnis lesen. Unter **Hinweise** steht, was manuell ergänzt werden muss: Discord erlaubt
   Bots nur, Rechte zu vergeben, die sie selbst besitzen. Das **Administrator**-Recht der Rolle
   Administrator sowie z. B. *Mitglieder bannen* für Inhaber setzt du deshalb einmal selbst.
4. `/setup-panels` ausführen.
5. Dir selbst die Rolle **Inhaber** geben und dem Team die passenden Rollen zuweisen.

`/setup-server` und `/setup-panels` können beliebig oft ausgeführt werden.

### 4. Website anbinden

`WEBSITE_URL`, `HUGO_API_URL` und `HUGO_API_KEY` setzen und auf der Website die Endpunkte aus
[`docs/API.md`](docs/API.md) bereitstellen. Danach den Bot neu starten. Der Systemstatus in
`systemmeldungen` zeigt, ob die Verbindung steht.

## Umgebungsvariablen

| Variable | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `DISCORD_TOKEN` | ja | | Bot-Token (geheim) |
| `DISCORD_CLIENT_ID` | ja | | Application ID |
| `DISCORD_GUILD_ID` | empfohlen | | Server-ID für sofortige Command-Registrierung |
| `WEBSITE_URL` | nein | | Link in Panels/Embeds |
| `HUGO_API_URL` | für Kontofunktionen | | Basis-URL der Bot-API (HTTPS) |
| `HUGO_API_KEY` | für Kontofunktionen | | API-Schlüssel (geheim) |
| `HUGO_API_TIMEOUT_MS` | nein | `8000` | Timeout pro Request |
| `MARKET_CREATION_ENABLED` | nein | `false` | Angenommene Vorschläge per API anlegen |
| `BRAND_NAME` | nein | `HugoPredict` | Name in Embeds |
| `CURRENCY_NAME` | nein | `HC` | Währungsname |
| `MARKET_FEED_INTERVAL_SECONDS` | nein | `60` | Abfrageintervall für `marktübersicht` |
| `MARKET_FEED_MAX_MARKETS` | nein | `25` | Höchstzahl aktiver Märkte mit eigener Nachricht |
| `TICKET_CLOSE_CONFIRMATION` | nein | `true` | Bestätigung vor dem Schließen einer Anfrage |
| `MAX_OPEN_TICKETS_PER_USER` | nein | `2` | Offene Anfragen pro Person |
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

**Einfacher:** `bash scripts/install-server.sh` erledigt Installation, Start (pm2 oder systemd) und richtet
**automatische Updates** ein. Ein cron-Job prüft dann alle 15 Sekunden, ob es auf dem Branch neue Commits
gibt, und startet den Bot gegebenenfalls neu (Protokoll: `data/update.log`). Ohne direkten SSH-Schlüssel
geht es auch aus der Oracle Cloud Shell über eine Bastion-Sitzung: `scripts/bastion-connect.sh`.

Manuell updaten: `cd /opt/hugosmp-market-bot && sudo -u hugobot git pull && sudo -u hugobot npm ci --omit=dev && sudo systemctl restart hugosmp-market-bot`.

Wenn das Repository privat ist, verwende zum Klonen einen Deploy-Key oder ein
Personal-Access-Token. Sichere `data/store.json` regelmäßig, denn dort liegen die
gespeicherten IDs.

## Entwicklung

```bash
npm test         # Tests: Struktur, Berechtigungen, Migration, API-Client, Marktübersicht, Embeds
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
    legacyLayout.js        Frühere Struktur (nur zur Migration)
    docs.js                Texte für #dokumentation
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
    marketFeed.js          #marktübersicht (eine Nachricht pro Markt)
    leaderboards.js        Ranglisten-Embed für /leaderboard
    status.js              Systemstatus in #systemmeldungen
  commands/                Slash-Commands
  interactions/            Buttons, Modals, Select-Menüs (tickets, suggestions, verification, rules, markets, announcements)
docs/API.md                Schnittstelle, die die Website bereitstellen muss
deploy/                    systemd-Dienst
test/                      node:test-Tests
```

Custom-IDs folgen dem Schema `hm:<bereich>:<aktion>[:<arg>]`. Neue Channels oder Rollen
fügst du in `serverLayout.js` hinzu und führst danach `/setup-server` erneut aus.

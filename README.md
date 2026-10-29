# HugoPredict: Discord-Bot

Discord-Bot für **HugoPredict**, den Prognosemarkt für Ereignisse rund um den Minecraft-Server HugoSMP.
Er richtet eine schlanke, professionelle Serverstruktur ein, veröffentlicht Dokumentation und
Kundenservice-Panel, pflegt die Prognosen und bindet die Website über eine klar definierte
API an.

> **Wichtig:** Der Bot führt **keine eigene Wirtschaft**. Guthaben, Positionen, Transaktionen,
> Daily-Boni, Prognosen und Ranglisten kommen ausschließlich von der Website
> (Schnittstelle: [`docs/API.md`](docs/API.md)). Ohne konfigurierte API funktionieren
> Einrichtung, Dokumentation, Kundenservice und Vorschläge trotzdem. Kontofunktionen melden
> dann „nicht verbunden“, statt Werte zu erfinden.

## Serverstruktur

| Kategorie | Channels | Sichtbar für |
|---|---|---|
| **INFORMATIONEN** | `👋┃willkommen`, `📢┃ankündigungen`, `📈┃prognosen`, `📜┃regeln`, `🔔┃pings` | alle (nur lesen) |
| **COMMUNITY** | `💬┃diskussionen`, `📊┃analysen`, `📸┃medien`, `💡┃vorschläge`, `🔊┃talk` (Sprachkanal) | ab *Mitglied* |
| **KUNDENSERVICE** | `🎫┃support` (+ private Anfrage-Channels), Sprachkanäle `⏳┃support-warteraum`, `🎧┃support-1`, `🎧┃support-2` | alle (nur lesen); Anfragen nur für Ersteller und Team. Im Warteraum darf jeder warten (ohne zu sprechen); die Support-Räume betritt nur das Team, Nutzer werden hineingezogen. Wer den Warteraum betritt, wird in `moderation` mit Ping der Supporter gemeldet |
| **INTERN · PRIVAT** | `🔧┃betrieb`, `🧾┃prüfprotokoll`, `📡┃systemmeldungen`, `🔨┃moderation`, `👥┃team` | nur zuständige Teamrollen |

**Interne Channels im Detail**

| Channel | Inhalt | Zugriff |
|---|---|---|
| `betrieb` | Prognosevorschläge prüfen, annehmen, ablehnen | Prognoseverwaltung, Inhaber, Administrator |
| `prüfprotokoll` | Einrichtung, Ankündigungen, Daily-Gutschriften, Kontoverknüpfungen, verweigerte Zugriffe | Inhaber, Administrator (nur lesen) |
| `systemmeldungen` | Systemstatus, API-Störungen, Fehler | Entwickler, Inhaber, Administrator (nur lesen) |
| `moderation` | Moderation, Ticket-Protokolle mit Transkript | Moderator, Support, Inhaber, Administrator |
| `team` | Internes Team | alle Teamrollen |

**Rollen** (in dieser Reihenfolge). Es gibt keine Level- oder Prestige-Rollen.

| Rolle | Aufgabe |
|---|---|
| `\| Inhaber` | Vollzugriff auf Server, Bot und Plattform |
| `\| Administrator` | Serververwaltung, Benutzer und Moderation |
| `\| Entwickler` (optional) | Technik, Bot, Website und Systemwartung |
| `\| Prognoseverwaltung` | Prognosen prüfen, verwalten und Ergebnisse bearbeiten |
| `\| Moderator` (optional) | Regeln durchsetzen und Diskussionen moderieren |
| `\| Supporter` | Tickets bearbeiten und Nutzern helfen |
| `\| Verifiziert` | Minecraft-Konto erfolgreich verknüpft |
| `\| Mitglied` | Standardrolle für Community-Mitglieder |
| `ping:Neue Prognosen`, `ping:Ankündigungen` | Freiwillige Benachrichtigungen |
| `\| Hugo Predict` (optional) | Technische Rolle für den Discord-Bot |

Optionale Rollen legt `/setup-panels` nicht neu an, wenn sie auf dem Server gelöscht wurden.
Fehlen sie, übernehmen Inhaber und Administrator ihre Aufgaben.

- **Administrator** ist die **einzige** Rolle mit dem Administrator-Recht. **Inhaber** hat
  umfassende Verwaltungsrechte, aber bewusst ohne Administrator-Flag.
- **Prognoseverwaltung** moderiert `prognosen` und entscheidet über Vorschläge, hat aber keine
  Guthaben-Funktionen und keinen Zugriff auf das Prüfprotokoll.
- **Support** bearbeitet zugewiesene Anfragen. Kontostände lassen sich über den Bot
  grundsätzlich nicht ändern.
- **Mitglied** (über „Regeln akzeptieren“) und **Verifiziert** (nach bestätigter Kontoverknüpfung)
  sind die einzigen Rollen, die der Bot selbst vergibt.
- Ankündigungen veröffentlichen nur Inhaber und Administrator, auf Wunsch über `/ankündigung`.

Die komplette Struktur steht deklarativ in [`src/config/serverLayout.js`](src/config/serverLayout.js),
die Texte von `regeln` in [`src/config/docs.js`](src/config/docs.js).

### Custom-Emojis

Statt Standard-Emojis nutzt der Bot ein eigenes, einheitliches Icon-Set: Linien-Icons in Emerald auf
dunkler Kachel (`assets/emojis/`, erzeugt mit `scripts/build-emojis.js`). Beim Start lädt der Bot sie
als **Application Emojis** hoch. Sie gehören dem Bot und belegen keine Emoji-Plätze des Servers.
Verwendet werden sie in Panels, Buttons, Auswahlmenüs, der Prognosen und im Systemstatus.
Channel-Namen bleiben ohne Emojis, weil Discord dort keine Custom-Emojis zulässt. Hat der Server
Boost-Stufe 2, setzt die Einrichtung die Icons zusätzlich als **Rollen-Icons**. Bereits gesetzte
Icons werden nicht überschrieben. Fehlt ein Emoji, wird es weggelassen und nie durch ein
Standard-Emoji ersetzt.

## Funktionen

| Bereich | Umsetzung |
|---|---|
| ~~`/setup-server`~~ | **Entfernt**, weil die Struktur eingerichtet ist. Die Einrichtungslogik (`src/setup/setupServer.js`) bleibt erhalten. Den Befehl stellst du bei Bedarf aus der Git-Historie wieder her (`git checkout 599f0f9 -- src/commands/setup-server.js`) |
| `/setup-panels` | Regeln & Infos (mit „Regeln akzeptieren“ und „Konto verknüpfen“), Kundenservice-Panel mit Auswahlmenü, Systemstatus und Statistik in `systemmeldungen`. Ein erneuter Aufruf **bearbeitet** die Panels, statt neue zu posten. Außerdem legt der Befehl **fehlende** Channels des Layouts an (z. B. `willkommen`) und benennt Rollen mit früherem Namen um. Bestehende Channels und Rollenrechte bleiben dabei unverändert |
| `prognosen` | Jede Prognose erhält **genau eine Nachricht**. Sie entsteht beim ersten Erscheinen und wird bei Statuswechseln (offen, pausiert, Handel beendet, entschieden) bearbeitet. Kleinstschwankungen lösen keine Bearbeitung aus, Folgenachrichten gibt es nicht |
| Konto (privat) | `/verify`, `/balance`, `/portfolio`, `/history`, `/daily`, `/leaderboard`. Alle Antworten sind nur für die anfragende Person sichtbar |
| Kundenservice | Fünf Anliegen. Jede Anfrage wird ein privater Channel nur für Ersteller und zuständiges Team. Es gibt „Übernehmen“ und „Anfrage schließen“ (mit Bestätigung). Das Abschlussprotokoll mit `.txt`-Transkript landet in `moderation` |
| Prognosevorschläge | `/vorschlag` öffnet ein Formular. Der Vorschlag wird in `betrieb` geprüft, angenommen oder (mit Begründung) abgelehnt, und die einreichende Person erhält eine Direktnachricht. Eine Annahme legt die Prognose nur bei aktivierter API an (`MARKET_CREATION_ENABLED`) |
| Moderation | `/mod verwarnen`, `timeout`, `timeout-aufheben`, `kicken`, `bannen`, `entbannen`, `verlauf`. Pflichtbegründung, Hierarchieprüfung (nie gegen gleich- oder höhergestellte Rollen, Eigentümer oder Bot), nummerierte Fälle, Benachrichtigung per Direktnachricht, Protokoll in `moderation` (Kick/Bann zusätzlich in `prüfprotokoll`). Moderator darf verwarnen, Timeout vergeben und kicken; bannen und entbannen dürfen nur Inhaber und Administrator |
| Begrüßung | In `willkommen` begrüßt der Bot jedes neue Mitglied mit einer Karte (Profilbild, Erwähnung, Mitgliedsnummer, erste drei Schritte). Ohne den Channel geht die Begrüßung als Direktnachricht raus. Benötigt den *Server Members Intent* |
| Statistik | Ein Embed in `systemmeldungen` (stündlich aktualisiert): Mitglieder, online, neu in 7 Tagen, Rollen Mitglied/Verifiziert, offene Anfragen, Vorschläge in Prüfung, Moderationsfälle. Rollen- und Beitrittszahlen benötigen den *Server Members Intent* |
| Benachrichtigungen | In `pings` melden sich Mitglieder per Button für die Rollen **Neue Prognosen** und **Ankündigungen** an und wieder ab. Der Bot pingt diese Rollen bei neuen Prognosen bzw. Ankündigungen. Dafür braucht die Bot-Rolle das Recht *@everyone, @here und alle Rollen erwähnen*. Mitglieder selbst können die Rollen nicht pingen |
| Ankündigungen | `/ankündigung` veröffentlicht eine Ankündigungskarte in `ankündigungen` und pingt die Rolle **Ankündigungen**; `benachrichtigen:false` verzichtet auf den Ping |
| Prognose vorschlagen | Karte mit Button ganz oben in `prognosen` öffnet das Vorschlagsformular (wie `/vorschlag`) |
| Sicherheit | Rechteprüfung bei jedem privilegierten Command, Button und Formular. Dazu kommen Rate-Limits, Sperren gegen Doppelklicks und Idempotency-Keys für Daily und Prognose anlegen |

## Migration von der früheren Struktur

> Hinweis: Der Befehl `/setup-server` wurde nach der Migration entfernt. Dieser Abschnitt beschreibt,
> was er getan hat.

`/setup-server` erkannte die frühere Struktur (Emoji-Channels wie `📈・live-markets`) über
gespeicherte IDs oder die alten Namen. Die Vorschau listet alle Änderungen auf, bevor etwas passiert.

- **Umbenannt und verschoben** (Nachrichtenverlauf bleibt erhalten, neue Rechte werden gesetzt):
  `📢・ankündigungen` → `ankündigungen`, `📈・live-markets` → `prognosen`,
  `👋・willkommen` → `regeln`, `💬・allgemeiner-chat` → `diskussionen`,
  `🧠・analysen` → `analysen`, `🎫・ticket-erstellen` → `support`,
  `⚖️・markt-entscheidungen` → `betrieb`, `📝・moderations-logs` → `prüfprotokoll`,
  `🛠️・bot-logs` → `systemmeldungen`, `🎫・ticket-logs` → `moderation`, `💬・team-chat` → `team`.
  Kategorien und Rollen werden ebenso umbenannt (z. B. `👑 Owner` → `Inhaber`).
- **Veraltet** sind alle übrigen Channels und Kategorien sowie die Rollen *Diamond Trader* und
  *Trader*. Sie werden **nie automatisch gelöscht**. Standardmäßig werden sie nur aufgelistet.
  Mit `/setup-server veraltete_archivieren:true` verschiebt der Bot veraltete Channels in eine
  versteckte Kategorie **ARCHIV** (nur Inhaber/Administrator, nur lesen).
- **Endgültig aufräumen:** `/aufräumen` löscht nach einer Vorschau und Bestätigung alle Channels im
  ARCHIV, die Kategorie ARCHIV und leere Kategorien der früheren Struktur. Mit
  `veraltete_rollen:true` entfernt er auch Diamond Trader und Trader. Kategorien, in denen noch
  Channels liegen, sowie alles aus der aktuellen Struktur bleiben unangetastet. Der Vorgang wird
  im `prüfprotokoll` festgehalten.

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
4. Optional, aber empfohlen: Unter **Bot → Privileged Gateway Intents** den **Server Members Intent**
   aktivieren (für Begrüßung und vollständige Statistik). Der Bot erkennt die Freigabe selbst und
   startet innerhalb von zehn Minuten neu. Ohne Freigabe läuft er normal weiter, nur ohne diese beiden Funktionen.
5. Bot einladen (ersetze `CLIENT_ID`):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=1477737704534
   ```
   Die Berechtigungszahl enthält genau die Rechte, die Einrichtung und Moderation brauchen
   (u. a. Rollen und Channels verwalten, Nachrichten verwalten, Timeout, Kicken, Bannen).
   **Kein** Administrator-Recht. Wurde der Bot früher ohne Moderationsrechte eingeladen, aktiviere
   bei seiner Rolle *Mitglieder timeouten*, *Mitglieder kicken* und *Mitglieder bannen*.
6. Server-ID kopieren (Entwicklermodus, dann Rechtsklick auf den Server) und als `DISCORD_GUILD_ID` eintragen.

### 2. Slash-Commands registrieren und starten

```bash
npm run deploy   # registriert die Commands (bei DISCORD_GUILD_ID sofort)
npm start        # startet den Bot
```

### 3. Server einrichten

1. **Servereinstellungen → Rollen:** Die Bot-Rolle ganz nach **oben** ziehen. Der Bot kann
   nur Rollen erstellen, umbenennen, sortieren und vergeben, die unter seiner eigenen Rolle liegen.
2. `/setup-server` ausführen (derzeit entfernt, siehe Funktionen), die Vorschau prüfen und mit **Einrichtung starten** bestätigen.
   - `veraltete_archivieren: true` verschiebt Channels der früheren Struktur ins ARCHIV.
   - `berechtigungen_synchronisieren: true` setzt auch unveränderte Channels und Rollen auf
     das Standard-Layout zurück.
3. Das Ergebnis lesen. Unter **Hinweise** steht, was manuell ergänzt werden muss: Discord erlaubt
   Bots nur, Rechte zu vergeben, die sie selbst besitzen. Das **Administrator**-Recht der Rolle
   Administrator sowie z. B. *Mitglieder bannen* für Inhaber setzt du deshalb einmal selbst.
4. `/setup-panels` ausführen.
5. Dir selbst die Rolle **Inhaber** geben und dem Team die passenden Rollen zuweisen.

`/setup-panels` kann beliebig oft ausgeführt werden.

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
| `CURRENCY_NAME` | nein | `HugoCoins` | Währungsname (der frühere Wert `HC` wird als HugoCoins angezeigt) |
| `MARKET_FEED_INTERVAL_SECONDS` | nein | `60` | Abfrageintervall für `prognosen` |
| `MARKET_FEED_MAX_MARKETS` | nein | `25` | Höchstzahl aktiver Prognosen mit eigener Nachricht |
| `TICKET_CLOSE_CONFIRMATION` | nein | `true` | Bestätigung vor dem Schließen einer Anfrage |
| `MAX_OPEN_TICKETS_PER_USER` | nein | `2` | Offene Anfragen pro Person |
| `DATA_DIR` | nein | `./data` | Speicherort für IDs, Panels, Tickets |
| `LOG_LEVEL` | nein | `info` | `debug`/`info`/`warn`/`error` |
| `MC_ENABLED` | nein | `false` | Minecraft-Bot starten (siehe unten) |
| `MC_HOST`, `MC_PORT`, `MC_VERSION` | mit Minecraft | `25565`, automatisch | Adresse und Version von HugoSMP |
| `MC_ACCOUNT` | mit Minecraft | | Microsoft-Konto des Bot-Accounts |
| `MC_JOIN_COMMANDS` | nein | | Befehle nach dem Betreten, durch `;` getrennt |
| `MC_WHISPER_COMMAND`, `MC_PAY_COMMAND`, `MC_BALANCE_COMMAND` | nein | `/msg …`, `/pay …`, `/balance` | Befehle im Spiel |
| `MC_BALANCE_CHECK` | nein | `true` | Einzahlungen am Kontostand prüfen; `false` = Zahlungsnachricht zählt sofort (Auszahlungen werden immer geprüft) |
| `MC_PAY_CONFIRM_COMMAND` | nein | | Bestätigung nach `/pay`, falls der Server sie verlangt |
| `MC_PAY_PATTERN`, `MC_BALANCE_PATTERN` | nein | eingebaut | Eigene Erkennung der Servernachrichten |
| `MC_PAYOUTS_ENABLED` | nein | `false` | Auszahlungen ausführen |
| `MC_PAYOUT_MAX` | mit Auszahlungen | | Höchstbetrag pro Auszahlung |

`.env` und `data/` stehen in `.gitignore` und dürfen nie committet werden.

## Minecraft-Bot

Mit `MC_ENABLED=true` verbindet sich der Bot zusätzlich mit HugoSMP (Mineflayer, im selben
Prozess). Er braucht einen eigenen, gekauften Minecraft-Java-Account.

| Funktion | Ablauf |
|---|---|
| Kontoverknüpfung | „Konto verknüpfen“ oder `/verify` → Minecraft-Name → der Bot flüstert im Spiel einen 6-stelligen Code → „Code eingeben“ in Discord. Nur wer online ist, bekommt den Code. Danach: Rollen *Mitglied* und *Verifiziert*, Server-Name = Minecraft-Name. Code 10 Minuten gültig, 5 Versuche |
| Einzahlung | Spieler zahlt `/pay HugoPredict 15k`. Gutgeschrieben wird nur, wenn der Kontostand des Bots (`/balance`) wirklich gestiegen ist; Spieler-Chat wird nie ausgewertet. Meldung an die Website mit Idempotency-Key, bei Störungen später erneut |
| Auszahlung | Nur mit `MC_PAYOUTS_ENABLED=true`: vom Team freigegebene Auszahlungen der Website werden per `/pay` ausgeführt und am Kontostand geprüft. Limit `MC_PAYOUT_MAX`. Jede Auszahlung höchstens einmal, Unklares meldet der Bot dem Team statt zu wiederholen |

Einschalten auf dem Server: `bash ~/HugoPredict/scripts/enable-minecraft.sh bot@beispiel.de` (Server
standardmäßig `hugosmp.net`, ausschalten mit `--aus`). Erster Start: In `systemmeldungen` erscheint „Minecraft: Anmeldung nötig“ mit Link und Code.
Dort mit dem Microsoft-Konto des Bots anmelden; die Anmeldung wird in `data/minecraft-auth`
gespeichert. Erkennt der Bot Zahlungs- oder Kontostandsnachrichten nicht, meldet er die
unbekannte Nachricht in `systemmeldungen`. Dann `MC_PAY_PATTERN`/`MC_BALANCE_PATTERN`
anpassen. Alle Geldbewegungen stehen in `prüfprotokoll`.

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
npm test         # Tests: Struktur, Berechtigungen, Migration, API-Client, Prognosen, Embeds
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
    docs.js                Texte für #regeln
    theme.js               Farben/Design
  lib/
    hugoApi.js             Website-API-Client (siehe docs/API.md)
    store.js               Persistente IDs/Panels/Tickets (data/store.json)
    guildContext.js        Key→ID-Auflösung, Rechteprüfung, Audit-Logs
    rateLimit.js           Rate-Limits und Sperren
    embeds.js, respond.js, logger.js
  setup/
    setupServer.js         Einrichtung und Migration (idempotent)
    cleanup.js             /aufräumen
    panels.js              /setup-panels-Inhalte
  services/
    marketFeed.js          #prognosen (eine Nachricht pro Prognose)
    leaderboards.js        Ranglisten-Embed für /leaderboard
    status.js              Systemstatus in #systemmeldungen
  commands/                Slash-Commands
  interactions/            Buttons, Modals, Select-Menüs (tickets, suggestions, verification, rules, markets, announcements)
docs/API.md                Schnittstelle, die die Website bereitstellen muss
deploy/                    systemd-Dienst
test/                      node:test-Tests
```

Custom-IDs folgen dem Schema `hm:<bereich>:<aktion>[:<arg>]`. Neue Channels oder Rollen
fügst du in `serverLayout.js` hinzu. Für die Übernahme auf den Server muss `/setup-server` wiederhergestellt werden.

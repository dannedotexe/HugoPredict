#!/usr/bin/env bash
# Zieht eine ältere, separat gestartete Website (z. B. auf Port 3001) in die
# Website um, die automatisch aktualisiert wird (~/HugoPredict-Website):
#   bash ~/HugoPredict/scripts/website-umzug.sh [alter-port]
#
# - Zeigt erst alles an und fragt nach „ja“, bevor sich etwas ändert.
# - Der alte Ordner wird NICHT gelöscht oder verändert, nur der alte Prozess gestoppt.
# - Datenbank (Konten, Guthaben, Märkte) und Einstellungen aus der alten .env ziehen mit um.
# - Vorher wird alles nach ~/website-backups/<Zeit>/ gesichert; bei einem Fehler
#   wird automatisch zurückgerollt.
set -Eeuo pipefail

OLD_PORT="${1:-3001}"
BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NEW="${WEB_DIR:-$HOME/HugoPredict-Website}"
WEB_NAME="hugopredict-web"

fail() { echo "FEHLER: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

[[ "$OLD_PORT" =~ ^[0-9]{2,5}$ ]] || fail "Ungültiger Port: $OLD_PORT"
[ -d "$NEW/.git" ] || fail "$NEW fehlt – erst die Website einrichten (bastion-connect.sh website)."
command -v pm2 >/dev/null || fail "pm2 fehlt."
NODE22="$(cat "$NEW/data/.node-bin" 2>/dev/null || command -v node)"

get_var() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- || true; }
# Setzt KEY=VALUE sicher (auch bei Sonderzeichen im Wert).
set_var() {
  node -e '
    const fs = require("fs"); const [file, key, value] = process.argv.slice(1);
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
    const i = lines.findIndex((l) => l.startsWith(key + "="));
    if (i >= 0) lines[i] = key + "=" + value; else { if (lines.length && lines.at(-1) === "") lines.pop(); lines.push(key + "=" + value, ""); }
    fs.writeFileSync(file, lines.join("\n"));
  ' "$1" "$2" "$3"
}
db_path() { # Ordner → Pfad der Datenbank laut .env
  local f; f="$(get_var "$1/.env" DB_FILE)"; f="${f:-data/hugopredict.db}"
  case "$f" in /*) echo "$f" ;; *) echo "$1/$f" ;; esac
}
db_stats() {
  [ -f "$1" ] || { echo "keine Datenbank"; return; }
  "$NODE22" -e '
    const { DatabaseSync } = require("node:sqlite");
    let db; try { db = new DatabaseSync(process.argv[1], { readOnly: true }); } catch { db = new DatabaseSync(process.argv[1]); }
    const n = (sql) => { try { return db.prepare(sql).get().n ?? 0; } catch { return "?"; } };
    console.log(`Konten ${n("SELECT COUNT(*) n FROM users")}, Guthaben ${n("SELECT ROUND(SUM(balance),2) n FROM users")}, Märkte ${n("SELECT COUNT(*) n FROM markets")}, Trades ${n("SELECT COUNT(*) n FROM trades")}, Einzahlungen ${n("SELECT COUNT(*) n FROM deposits")}, Auszahlungen ${n("SELECT COUNT(*) n FROM withdrawals")}`);
  ' "$1" 2>/dev/null || echo "nicht lesbar"
}
count() { "$NODE22" -e 'const { DatabaseSync } = require("node:sqlite"); try { const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log(db.prepare(process.argv[2]).get().n ?? 0); } catch { console.log(0); }' "$1" "$2" 2>/dev/null || echo 0; }
health() { curl -fs --max-time 5 "http://127.0.0.1:$1/api/health" >/dev/null; }
commit_of() { git -C "$1" rev-parse --short HEAD 2>/dev/null || echo "?"; }

step "Bestandsaufnahme (es wird noch nichts geändert)"
NEW_PORT="$(get_var "$NEW/.env" PORT)"
echo "Neue Website:  $NEW  · Port ${NEW_PORT:-?} · Stand $(commit_of "$NEW")"

# Wer lauscht auf dem alten Port?
PID="$(ss -ltnpH "( sport = :$OLD_PORT )" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)"
[ -n "$PID" ] || {
  echo "Auf Port $OLD_PORT läuft nichts (oder ein Prozess eines anderen Benutzers)."
  echo "Gefundene Website-Ordner:"
  find "$HOME" -maxdepth 3 -path '*/src/server.js' -not -path '*/node_modules/*' 2>/dev/null | sed 's|/src/server.js||; s|^|  |'
  exit 1
}
OLD="$(readlink -f "/proc/$PID/cwd" 2>/dev/null || true)"
[ -n "$OLD" ] || fail "Ordner des Prozesses $PID nicht lesbar."
[ "$OLD" = "$(readlink -f "$NEW")" ] && fail "Port $OLD_PORT gehört schon zur neuen Website – nichts umzuziehen."
[ -f "$OLD/.env" ] || fail "In $OLD liegt keine .env – ist das wirklich die alte Website?"
OLD_PM2="$(pm2 jlist 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const [pid, cwd] = process.argv.slice(1);
    const list = JSON.parse(s || "[]");
    const p = list.find((x) => String(x.pid) === pid) || list.find((x) => x.pm2_env?.pm_cwd === cwd && x.pm2_env?.status === "online");
    console.log(p ? p.name : "");
  });' "$PID" "$OLD" || true)"
echo "Alte Website:  $OLD  · Port $OLD_PORT · Stand $(commit_of "$OLD") · Prozess $([ -n "$OLD_PM2" ] && echo "pm2 „$OLD_PM2“" || echo "PID $PID (nicht pm2)")"

OLD_DB="$(db_path "$OLD")"
NEW_DB="$(db_path "$NEW")"
echo
echo "Datenbank alt: $OLD_DB"
echo "  $(db_stats "$OLD_DB")"
echo "Datenbank neu: $NEW_DB"
echo "  $(db_stats "$NEW_DB")"
echo
echo "Einstellungen in der alten .env (nur Namen): $(grep -oE '^[A-Z_][A-Z0-9_]*=' "$OLD/.env" | tr -d = | tr '\n' ' ')"
CRON_OLD="$(crontab -l 2>/dev/null | grep -F "$OLD" | grep -v '^#' || true)"
[ -n "$CRON_OLD" ] && echo "Cron-Einträge für den alten Ordner: $(printf '%s\n' "$CRON_OLD" | grep -c .)"

[ -f "$OLD_DB" ] || fail "Die alte Website hat keine Datenbank unter $OLD_DB – nichts umzuziehen."
# Hat die neue Website schon eigene Buchungen, würden sie überschrieben → abbrechen.
NEW_BOOKINGS=0
if [ -f "$NEW_DB" ]; then
  for t in trades deposits withdrawals; do NEW_BOOKINGS=$((NEW_BOOKINGS + $(count "$NEW_DB" "SELECT COUNT(*) n FROM $t"))); done
fi
if [ "$NEW_BOOKINGS" -gt 0 ]; then
  fail "Die neue Website hat schon $NEW_BOOKINGS eigene Buchungen. Nichts geändert – bitte diese Ausgabe schicken, dann werden beide zusammengeführt."
fi

echo
echo "Geplant:"
echo "  1. Sicherung von beiden Ordnern (Datenbank + .env) nach ~/website-backups/"
echo "  2. Alte Website stoppen (Ordner bleibt unverändert)"
echo "  3. Alte Datenbank und Einstellungen in die neue Website übernehmen"
echo "     (Port, API-Schlüssel und Domain-Einstellungen der neuen bleiben; ADMIN_MC enthält Alpha_Noah)"
echo "  4. Neue Website starten, Discord-Verknüpfungen erneut übertragen"
ANSWER=""
if [ -t 0 ]; then read -rp "Umziehen? Zum Bestätigen „ja“ eingeben: " ANSWER; fi
[ "$ANSWER" = "ja" ] || { echo "Abgebrochen, nichts geändert."; exit 0; }

BK="$HOME/website-backups/$(date +%Y%m%d-%H%M%S)"
step "Sichern nach $BK"
mkdir -p "$BK/alt" "$BK/neu"
# Alten Prozess zuerst stoppen, damit die Datenbank in sich stimmig kopiert wird.
if [ -n "$OLD_PM2" ]; then
  pm2 stop "$OLD_PM2" >/dev/null
else
  kill "$PID" 2>/dev/null || true
fi
for _ in $(seq 1 10); do health "$OLD_PORT" || break; sleep 1; done
health "$OLD_PORT" && { [ -n "$OLD_PM2" ] && pm2 start "$OLD_PM2" >/dev/null 2>&1; fail "Die alte Website läuft nach dem Stoppen weiter (startet sie ein anderer Dienst neu?). Nichts übernommen."; }
pm2 stop "$WEB_NAME" >/dev/null
cp -a "$OLD/.env" "$BK/alt/.env"
cp -a "$NEW/.env" "$BK/neu/.env"
for f in "$OLD_DB" "$OLD_DB-wal" "$OLD_DB-shm"; do [ -f "$f" ] && cp -a "$f" "$BK/alt/"; done
for f in "$NEW_DB" "$NEW_DB-wal" "$NEW_DB-shm"; do [ -f "$f" ] && cp -a "$f" "$BK/neu/"; done
chmod -R go-rwx "$BK"
echo "Gesichert."

rollback() {
  echo
  echo "!! Fehler – stelle den vorherigen Zustand wieder her"
  cp -a "$BK/neu/.env" "$NEW/.env"
  rm -f "$NEW_DB" "$NEW_DB-wal" "$NEW_DB-shm"
  for f in "$BK"/neu/*.db*; do [ -f "$f" ] && cp -a "$f" "$(dirname "$NEW_DB")/"; done
  pm2 restart "$WEB_NAME" --update-env >/dev/null 2>&1 || true
  if [ -n "$OLD_PM2" ]; then pm2 start "$OLD_PM2" >/dev/null 2>&1 || true; fi
  echo "Zurückgerollt. Sicherung bleibt in $BK. Bitte diese Ausgabe schicken."
  exit 1
}
trap rollback ERR

step "Datenbank übernehmen"
mkdir -p "$(dirname "$NEW_DB")"
rm -f "$NEW_DB" "$NEW_DB-wal" "$NEW_DB-shm"
OLD_BASE="$(basename "$OLD_DB")"
NEW_BASE="$(basename "$NEW_DB")"
for f in "$BK/alt/$OLD_BASE" "$BK/alt/$OLD_BASE-wal" "$BK/alt/$OLD_BASE-shm"; do
  [ -f "$f" ] && cp -a "$f" "$(dirname "$NEW_DB")/$NEW_BASE${f#"$BK/alt/$OLD_BASE"}"
done
echo "  $(db_stats "$NEW_DB")"

step "Einstellungen übernehmen"
KEEP=" PORT HUGO_API_KEY WEBSITE_URL COOKIE_SECURE BOT_ENABLED DB_FILE "
n=0
while IFS= read -r line; do
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
  case "$KEEP" in *" $key "*) continue ;; esac
  [ -z "$value" ] && [ -n "$(get_var "$NEW/.env" "$key")" ] && continue
  set_var "$NEW/.env" "$key" "$value"; n=$((n + 1))
done < "$OLD/.env"
ADMINS="$(get_var "$NEW/.env" ADMIN_MC)"
printf '%s' ",$ADMINS," | tr -d ' ' | grep -qi ',Alpha_Noah,' || set_var "$NEW/.env" ADMIN_MC "Alpha_Noah${ADMINS:+,$ADMINS}"
chmod 600 "$NEW/.env"
echo "$n Einstellungen übernommen. ADMIN_MC=$(get_var "$NEW/.env" ADMIN_MC)"
[ "$(get_var "$NEW/.env" HUGO_API_KEY | wc -c)" -gt 32 ] || false

step "Neue Website starten"
pm2 restart "$WEB_NAME" --update-env >/dev/null
for _ in $(seq 1 20); do health "$NEW_PORT" && break; sleep 1; done
health "$NEW_PORT"
KEY="$(get_var "$NEW/.env" HUGO_API_KEY)"
curl -fs --max-time 5 -H "Authorization: Bearer $KEY" "http://127.0.0.1:$NEW_PORT/api/bot/health" | grep -q '"ok"'
echo "Website läuft auf Port $NEW_PORT mit den alten Daten."
trap - ERR

step "Aufräumen"
if [ -n "$CRON_OLD" ]; then
  crontab -l > "$BK/crontab.txt"
  awk -v d="$OLD" 'index($0, d) && $0 !~ /^#/ { print "# (Umzug) " $0; next } { print }' "$BK/crontab.txt" | crontab -
  echo "Cron-Einträge für den alten Ordner deaktiviert (Sicherung: $BK/crontab.txt)."
fi
pm2 save >/dev/null
echo "Alte Website gestoppt, Ordner $OLD unverändert."

step "Discord-Verknüpfungen erneut übertragen"
(cd "$BOT_DIR" && node scripts/resync-links.js) || echo "Hinweis: Übertragung später automatisch (alle 5 Minuten für neue Verknüpfungen)."

echo
echo "Fertig. Die Website (Port $NEW_PORT) hat jetzt die Konten und Guthaben der alten und"
echo "bekommt automatische Updates. Sicherung: $BK"
echo "Rückgängig: alte Website wieder starten mit  pm2 start ${OLD_PM2:-<name>}"

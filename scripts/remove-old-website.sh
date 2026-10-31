#!/usr/bin/env bash
# Löscht die alte, umgezogene Website ~/HugoPredict-website (kleines w) und ihren
# gestoppten pm2-Eintrag. Die aktive Website ~/HugoPredict-Website bleibt.
# Datenbank und .env der alten liegen weiter in ~/website-backups/.
set -euo pipefail

OLD="$HOME/HugoPredict-website"
NEW="$HOME/HugoPredict-Website"
fail() { echo "FEHLER: $*" >&2; exit 1; }

[ -d "$OLD" ] || { echo "$OLD gibt es nicht mehr – nichts zu tun."; exit 0; }
[ "$(readlink -f "$OLD")" != "$(readlink -f "$NEW")" ] || fail "$OLD ist die aktive Website – wird nicht gelöscht."
ls "$HOME"/website-backups/*/alt/.env >/dev/null 2>&1 || fail "Keine Sicherung in ~/website-backups gefunden – erst website-umzug ausführen."
if curl -fs --max-time 3 http://127.0.0.1:3001/api/health >/dev/null; then
  PID="$(ss -ltnpH '( sport = :3001 )' 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)"
  [ -n "$PID" ] && [ "$(readlink -f "/proc/$PID/cwd")" = "$(readlink -f "$OLD")" ] && fail "Die alte Website läuft noch – nichts gelöscht."
fi

# pm2-Einträge, die in diesem Ordner laufen (gestoppt)
NAMES="$(pm2 jlist 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    for (const p of JSON.parse(s || "[]")) if (p.pm2_env?.pm_cwd?.replace(/\/$/, "") === process.argv[1]) console.log(p.name);
  });' "$(readlink -f "$OLD")" || true)"
for n in $NAMES; do
  [ "$n" = "hugopredict-web" ] && fail "pm2-Eintrag hugopredict-web zeigt auf den alten Ordner – nichts gelöscht."
  pm2 delete "$n" >/dev/null && echo "pm2-Eintrag „$n“ entfernt."
done
pm2 save >/dev/null 2>&1 || true

rm -rf -- "$OLD"
echo "Alter Ordner $OLD gelöscht."
echo "Aktive Website: $NEW (Port $(grep -m1 '^PORT=' "$NEW/.env" | cut -d= -f2)) – läuft: $(curl -fs --max-time 3 "http://127.0.0.1:$(grep -m1 '^PORT=' "$NEW/.env" | cut -d= -f2)/api/health" >/dev/null && echo ja || echo NEIN)"

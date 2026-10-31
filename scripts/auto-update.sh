#!/usr/bin/env bash
# Wird per cron jede Minute gestartet (eingerichtet von install-server.sh) und
# prüft innerhalb dieser Minute alle 15 Sekunden auf neue Commits. Bei Änderungen:
# Pull, Abhängigkeiten, Command-Registrierung, Neustart des Bots.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="hugopredict"
cd "$DIR"

exec 9>"$DIR/data/.update.lock"
flock -n 9 || exit 0

# Zuletzt erfolgreich gestartete Version (beim ersten Lauf: aktueller Stand)
DEPLOYED_FILE="$DIR/data/.deployed"
[ -f "$DEPLOYED_FILE" ] || git rev-parse HEAD > "$DEPLOYED_FILE"

update_once() {
  local branch target
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git fetch -q origin "$branch" || return 1
  target="$(git rev-parse "origin/$branch")"
  [ "$target" = "$(cat "$DEPLOYED_FILE")" ] && return 0

  echo "[$(date -Is)] Update auf $(git rev-parse --short "origin/$branch")"
  local previous
  previous="$(cat "$DEPLOYED_FILE")"
  # Jeder Schritt muss klappen, sonst kein Neustart.
  # Direkt auf dem Server geänderte Dateien würden das Update dauerhaft blockieren:
  # sichern (git stash list) statt hängen zu bleiben.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    git stash push -q -m "server-aenderungen-$(date +%Y%m%d-%H%M)" || return 1
    echo "[$(date -Is)] Lokale Änderungen gesichert (git stash list)"
  fi
  git merge -q --ff-only "$target" || return 1
  # Pakete nur neu installieren, wenn sie sich geändert haben (Minecraft-Daten sind groß).
  if [ ! -d node_modules ] || ! git diff --quiet "$previous" "$target" -- package.json package-lock.json 2>/dev/null; then
    npm ci --omit=dev --no-audit --no-fund --loglevel=error || return 1
  fi
  npm run -s deploy || echo "[$(date -Is)] Warnung: Command-Registrierung fehlgeschlagen – Neustart trotzdem"
  if command -v pm2 >/dev/null && pm2 describe "$NAME" >/dev/null 2>&1; then
    pm2 restart "$NAME" || return 1
  else
    sudo -n systemctl restart "$NAME" || return 1
  fi
  echo "$target" > "$DEPLOYED_FILE"
  echo "[$(date -Is)] Neustart erledigt"
}

for i in 1 2 3 4; do
  update_once || echo "[$(date -Is)] Update fehlgeschlagen"
  if [ "$i" -lt 4 ]; then sleep 15; fi
done

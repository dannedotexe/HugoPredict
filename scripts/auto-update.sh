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

update_once() {
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git fetch -q origin "$branch" || return 1
  [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$branch")" ] && return 0

  echo "[$(date -Is)] Update auf $(git rev-parse --short "origin/$branch")"
  # Jeder Schritt muss klappen, sonst kein Neustart.
  git pull -q --ff-only origin "$branch" || return 1
  npm ci --omit=dev --no-audit --no-fund --loglevel=error || return 1
  npm run -s deploy || return 1
  if command -v pm2 >/dev/null && pm2 describe "$NAME" >/dev/null 2>&1; then
    pm2 restart "$NAME" || return 1
  else
    sudo -n systemctl restart "$NAME" || return 1
  fi
  echo "[$(date -Is)] Neustart erledigt"
}

for i in 1 2 3 4; do
  update_once || echo "[$(date -Is)] Update fehlgeschlagen"
  if [ "$i" -lt 4 ]; then sleep 15; fi
done

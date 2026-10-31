#!/usr/bin/env bash
# Wird per cron jede Minute gestartet (eingerichtet von setup-website.sh) und
# prüft innerhalb dieser Minute alle 15 Sekunden, ob es auf dem Branch „website“
# neue Commits gibt. Dann: Pull, Pakete (nur bei Änderung), Neustart.
set -euo pipefail

WEB_DIR="${1:-$HOME/HugoPredict-Website}"
NAME="hugopredict-web"
cd "$WEB_DIR"

exec 9>"$WEB_DIR/data/.update.lock"
flock -n 9 || exit 0

DEPLOYED_FILE="$WEB_DIR/data/.deployed"
[ -f "$DEPLOYED_FILE" ] || git rev-parse HEAD > "$DEPLOYED_FILE"

update_once() {
  local branch target previous
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git fetch -q origin "$branch" || return 1
  target="$(git rev-parse "origin/$branch")"
  previous="$(cat "$DEPLOYED_FILE")"
  [ "$target" = "$previous" ] && return 0

  echo "[$(date -Is)] Website-Update auf $(git rev-parse --short "$target")"
  git merge -q --ff-only "$target" || return 1
  if [ ! -d node_modules ] || ! git diff --quiet "$previous" "$target" -- package.json package-lock.json 2>/dev/null; then
    npm ci --omit=dev --no-audit --no-fund --loglevel=error || return 1
  fi
  pm2 restart "$NAME" --update-env || return 1
  echo "$target" > "$DEPLOYED_FILE"
  echo "[$(date -Is)] Neustart erledigt"
}

for i in 1 2 3 4; do
  update_once || echo "[$(date -Is)] Update fehlgeschlagen"
  if [ "$i" -lt 4 ]; then sleep 15; fi
done

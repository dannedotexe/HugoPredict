#!/usr/bin/env bash
# Wird per cron alle 10 Minuten ausgeführt (eingerichtet von install-server.sh).
# Holt neue Commits des aktuellen Branches, installiert Abhängigkeiten,
# registriert Commands und startet den Bot neu – nur wenn sich etwas geändert hat.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="hugopredict"
cd "$DIR"

exec 9>"$DIR/data/.update.lock"
flock -n 9 || exit 0

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] && exit 0

echo "[$(date -Is)] Update auf $(git rev-parse --short "origin/$BRANCH")"
git pull -q --ff-only origin "$BRANCH"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
npm run -s deploy

if command -v pm2 >/dev/null && pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 restart "$NAME"
else
  sudo -n systemctl restart "$NAME"
fi
echo "[$(date -Is)] Neustart erledigt"

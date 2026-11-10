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

# --- Einmalig (vom Inhaber freigegeben): 4 GB Swap, damit npm ci die 1-GB-VM
# nicht mehr lahmlegt. Danach fehlende Pakete neu installieren und Bot starten.
ensure_swap() {
  [ -n "$(swapon --noheadings 2>/dev/null)" ] && return 0
  if [ ! -f /swapfile ]; then
    local free_kb
    free_kb="$(df --output=avail -k / | tail -1 | tr -d ' ')"
    if [ "${free_kb:-0}" -lt $((6 * 1024 * 1024)) ]; then echo "[$(date -Is)] Swap: zu wenig Speicherplatz"; return 1; fi
    echo "[$(date -Is)] Lege 4 GB Swap an"
    sudo -n fallocate -l 4G /swapfile && sudo -n chmod 600 /swapfile && sudo -n mkswap /swapfile >/dev/null || return 1
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo -n tee -a /etc/fstab >/dev/null
  fi
  sudo -n swapon /swapfile && echo "[$(date -Is)] Swap aktiv"
}
restart_bot() {
  if command -v pm2 >/dev/null && pm2 describe "$NAME" >/dev/null 2>&1; then
    pm2 restart "$NAME" 9>&- || return 1
  else
    sudo -n systemctl restart "$NAME" || return 1
  fi
}
heal_modules() {
  if [ -d node_modules ] && npm ls --omit=dev --depth=0 >/dev/null 2>&1; then return 0; fi
  # Nur mit Swap (sonst hängt die VM) und höchstens alle 30 Minuten
  ensure_swap || return 1
  local mark="$DIR/data/.heal-tried"
  if [ -f "$mark" ] && [ $(( $(date +%s) - $(stat -c %Y "$mark") )) -lt 1800 ]; then return 0; fi
  touch "$mark"
  echo "[$(date -Is)] Pakete unvollständig – installiere neu"
  nice -n 10 npm ci --omit=dev --no-audit --no-fund --loglevel=error --maxsockets=2 || return 1
  restart_bot && echo "[$(date -Is)] Nach Reparatur neu gestartet"
}

update_once() {
  ensure_swap >/dev/null 2>&1 || true
  heal_modules || echo "[$(date -Is)] Reparatur der Pakete fehlgeschlagen"
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
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git stash push -q -m "server-aenderungen-$(date +%Y%m%d-%H%M)" || return 1
    echo "[$(date -Is)] Lokale Änderungen gesichert (git stash list)"
  fi
  git merge -q --ff-only "$target" || return 1
  # Pakete nur neu installieren, wenn sie sich geändert haben (Minecraft-Daten sind groß).
  if [ ! -d node_modules ] || ! git diff --quiet "$previous" "$target" -- package.json package-lock.json 2>/dev/null; then
    ensure_swap || true
    nice -n 10 npm ci --omit=dev --no-audit --no-fund --loglevel=error --maxsockets=2 || return 1
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

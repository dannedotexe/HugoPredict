#!/usr/bin/env bash
# Schaltet den Minecraft-Bot ein und startet HugoPredict neu.
#   bash ~/HugoPredict/scripts/enable-minecraft.sh bot@beispiel.de [server]
# Ohne Server wird hugosmp.net verwendet. Ausschalten: ... --aus
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/.env"
[ -f "$ENV_FILE" ] || { echo "Keine .env in $DIR gefunden."; exit 1; }

# Setzt KEY=VALUE in der .env (ersetzt eine vorhandene Zeile, sonst anhängen).
set_var() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

if [ "${1:-}" = "--aus" ]; then
  set_var MC_ENABLED false
  echo "Minecraft-Bot ausgeschaltet."
else
  ACCOUNT="${1:-}"
  HOST="${2:-hugosmp.net}"
  if ! [[ "$ACCOUNT" =~ ^[^[:space:]@|]+@[^[:space:]@|]+\.[^[:space:]@|]+$ ]]; then
    echo "Bitte die E-Mail des Microsoft-Kontos des Bots angeben:"
    echo "  bash $0 bot@beispiel.de"
    exit 1
  fi
  if ! [[ "$HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "Ungültige Serveradresse: $HOST"
    exit 1
  fi
  cp "$ENV_FILE" "$ENV_FILE.backup-$(date +%Y%m%d-%H%M%S)"
  set_var MC_ENABLED true
  set_var MC_HOST "$HOST"
  set_var MC_ACCOUNT "$ACCOUNT"
  echo "Minecraft-Bot eingeschaltet: $ACCOUNT auf $HOST."
  echo "Gleich erscheint in #systemmeldungen ein Anmeldecode für microsoft.com/link."
fi

if command -v pm2 >/dev/null && pm2 describe hugopredict >/dev/null 2>&1; then
  pm2 restart hugopredict --update-env >/dev/null
else
  sudo -n systemctl restart hugopredict
fi
echo "HugoPredict wurde neu gestartet."

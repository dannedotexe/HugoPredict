#!/usr/bin/env bash
# Für Oracle Cloud Shell: findet die aktive Bastion-Sitzung (Managed SSH),
# verbindet sich mit dem Server und startet dort scripts/install-server.sh.
# Aufruf in Cloud Shell:  bash <(curl -sL <raw-URL dieses Skripts>)
# Nur prüfen (verändert nichts):  bash <(curl -sL <raw-URL dieses Skripts>) pruefen
# Website einrichten und verbinden:  bash <(curl -sL <raw-URL dieses Skripts>) website [domain]
# Minecraft-Bot einschalten (fragt nach der E-Mail):  bash <(curl -sL <raw-URL dieses Skripts>) minecraft
# Alte Website (Port 3001) mit Konten und .env in die aktualisierte umziehen:  ... website-umzug [port]
set -euo pipefail
MODE="${1:-install}"

KEY="${KEY:-$HOME/.ssh/bastion}"
BRANCH="${BRANCH:-claude/hugosmp-market-discord-kyruph}"
REPO="https://github.com/dannedotexe/HugoPredict.git"

fail() { echo "FEHLER: $*" >&2; exit 1; }

command -v oci >/dev/null || fail "OCI CLI nicht gefunden – bitte in Oracle Cloud Shell ausführen."
[ -f "$KEY" ] && [ -f "$KEY.pub" ] || fail "Schlüssel $KEY fehlt. Erzeugen mit: ssh-keygen -t rsa -f ~/.ssh/bastion"
COMPARTMENT="${COMPARTMENT:-${OCI_TENANCY:-}}"
[ -n "$COMPARTMENT" ] || fail "OCI_TENANCY ist nicht gesetzt."
REGION="${OCI_REGION:-eu-frankfurt-1}"

echo "==> Suche aktiven Bastion"
BASTION=$(oci bastion bastion list --compartment-id "$COMPARTMENT" --all \
  --query 'data[?"lifecycle-state"==`ACTIVE`] | [0].id' --raw-output)
[ -n "$BASTION" ] && [ "$BASTION" != "null" ] || fail "Kein aktiver Bastion gefunden."

# Fingerabdruck eines öffentlichen Schlüssels: Typ + Inhalt, ohne Kommentar.
key_id() { awk '{print $1" "$2}'; }
MY_KEY="$(key_id < "$KEY.pub")"

echo "==> Suche aktive Sitzung mit deinem Schlüssel"
SESSION=""
for S in $(oci bastion session list --bastion-id "$BASTION" --all \
    --query 'data[?"lifecycle-state"==`ACTIVE`].id' --raw-output 2>/dev/null | tr -d '[]",'); do
  PUB="$(oci bastion session get --session-id "$S" --query 'data."key-details"."public-key-content"' --raw-output 2>/dev/null | key_id)"
  if [ "$PUB" = "$MY_KEY" ]; then SESSION="$S"; break; fi
done

if [ -z "$SESSION" ]; then
  echo "==> Keine passende Sitzung – erstelle eine neue (dauert 1–2 Minuten)"
  TARGET=$(oci bastion session list --bastion-id "$BASTION" --all \
    --query 'data[0]."target-resource-details"."target-resource-id"' --raw-output 2>/dev/null || true)
  if [ -z "$TARGET" ] || [ "$TARGET" = "null" ]; then
    TARGET=$(oci compute instance list --compartment-id "$COMPARTMENT" --display-name "${INSTANCE:-discord-bots}" \
      --lifecycle-state RUNNING --query 'data[0].id' --raw-output)
  fi
  [ -n "$TARGET" ] && [ "$TARGET" != "null" ] || fail "Server „${INSTANCE:-discord-bots}“ nicht gefunden."
  SESSION=$(oci bastion session create-managed-ssh --bastion-id "$BASTION" \
    --target-resource-id "$TARGET" --target-os-username "${SSH_USER:-ubuntu}" \
    --ssh-public-key-file "$KEY.pub" --session-ttl 10800 --display-name hugopredict \
    --query 'data.id' --raw-output)
  [ -n "$SESSION" ] && [ "$SESSION" != "null" ] || fail "Sitzung konnte nicht erstellt werden."
  for _ in $(seq 1 60); do
    STATE=$(oci bastion session get --session-id "$SESSION" --query 'data."lifecycle-state"' --raw-output)
    [ "$STATE" = "ACTIVE" ] && break
    [ "$STATE" = "FAILED" ] && fail "Die neue Sitzung ist fehlgeschlagen (ist das Bastion-Plugin auf dem Server aktiv?)."
    sleep 5
  done
  [ "$STATE" = "ACTIVE" ] || fail "Die neue Sitzung wurde nicht rechtzeitig aktiv. Bitte gleich nochmal versuchen."
  sleep 10 # kurz warten, bis der Schlüssel auf dem Server angekommen ist
fi

IP=$(oci bastion session get --session-id "$SESSION" \
  --query 'data."target-resource-details"."target-resource-private-ip-address"' --raw-output)
USERNAME=$(oci bastion session get --session-id "$SESSION" \
  --query 'data."target-resource-details"."target-resource-operating-system-user-name"' --raw-output)
PORT=$(oci bastion session get --session-id "$SESSION" \
  --query 'data."target-resource-details"."target-resource-port"' --raw-output)
[ "$PORT" = "null" ] && PORT=22

# Direkt auf dem Server geänderte Dateien blockieren das Update: sie werden per
# git stash gesichert (nichts geht verloren, ansehen mit: git -C ~/HugoPredict stash list).
UPDATE_BOT="if [ -d ~/HugoPredict/.git ]; then cd ~/HugoPredict && { [ -z \"\$(git status --porcelain --untracked-files=no)\" ] || { git stash push -m server-aenderungen-\$(date +%Y%m%d-%H%M) && echo '==> Lokale Änderungen auf dem Server gesichert (git stash list)'; }; } && git fetch -q origin $BRANCH && git checkout -q -B $BRANCH FETCH_HEAD -f && echo \"==> Bot auf Stand \$(git rev-parse --short HEAD)\"; else git clone -b $BRANCH $REPO ~/HugoPredict; fi"
if [ "$MODE" = "website" ]; then
  DOMAIN="${2:-hugopredict.de}"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Ungültige Domain: $DOMAIN"
  REMOTE="$UPDATE_BOT && bash ~/HugoPredict/scripts/setup-website.sh $DOMAIN"
elif [ "$MODE" = "website-umzug" ]; then
  # Alte, separat gestartete Website (Standard: Port 3001) in die aktualisierte umziehen
  OLD_PORT="${2:-3001}"
  [[ "$OLD_PORT" =~ ^[0-9]{2,5}$ ]] || fail "Ungültiger Port: $OLD_PORT"
  REMOTE="$UPDATE_BOT && bash ~/HugoPredict/scripts/website-umzug.sh $OLD_PORT"
elif [ "$MODE" = "alte-website-loeschen" ]; then
  REMOTE="$UPDATE_BOT && bash ~/HugoPredict/scripts/remove-old-website.sh"
elif [ "$MODE" = "kontostand-aus" ] || [ "$MODE" = "kontostand-an" ]; then
  REMOTE="$UPDATE_BOT && bash ~/HugoPredict/scripts/enable-minecraft.sh --$MODE"
elif [ "$MODE" = "fernzugriff" ]; then
  # Claude Code Remote Control auf dem Server (danach kein Oracle mehr nötig)
  REMOTE="$UPDATE_BOT && bash ~/HugoPredict/scripts/setup-remote-control.sh"
elif [ "$MODE" = "minecraft" ]; then
  REMOTE="$UPDATE_BOT && bash ~/HugoPredict/scripts/enable-minecraft.sh"
elif [ "$MODE" = "pruefen" ]; then
  # Nur lesend: das Prüfskript direkt von GitHub ausführen, ohne etwas zu installieren.
  REMOTE="curl -sL https://raw.githubusercontent.com/dannedotexe/HugoPredict/$BRANCH/scripts/diagnose-server.sh | bash"
else
  REMOTE="$UPDATE_BOT && bash ~/HugoPredict/scripts/install-server.sh"
fi

echo "==> Verbinde mit $USERNAME@$IP über den Bastion"
OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
exec ssh -i "$KEY" "${OPTS[@]}" \
  -o ProxyCommand="ssh -i $KEY -o StrictHostKeyChecking=accept-new -W %h:%p -p 22 $SESSION@host.bastion.$REGION.oci.oraclecloud.com" \
  -p "$PORT" -t "$USERNAME@$IP" \
  "$REMOTE"

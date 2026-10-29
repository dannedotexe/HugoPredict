#!/usr/bin/env bash
# Für Oracle Cloud Shell: findet die aktive Bastion-Sitzung (Managed SSH),
# verbindet sich mit dem Server und startet dort scripts/install-server.sh.
# Aufruf in Cloud Shell:  bash <(curl -sL <raw-URL dieses Skripts>)
# Nur prüfen (verändert nichts):  bash <(curl -sL <raw-URL dieses Skripts>) pruefen
set -euo pipefail
MODE="${1:-install}"

KEY="${KEY:-$HOME/.ssh/bastion}"
BRANCH="${BRANCH:-claude/hugosmp-market-discord-kyruph}"
REPO="https://github.com/dannedotexe/HugoPredict.git"

fail() { echo "FEHLER: $*" >&2; exit 1; }

command -v oci >/dev/null || fail "OCI CLI nicht gefunden – bitte in Oracle Cloud Shell ausführen."
[ -f "$KEY" ] || fail "Schlüssel $KEY fehlt. Erzeugen mit: ssh-keygen -t rsa -f ~/.ssh/bastion"
COMPARTMENT="${COMPARTMENT:-${OCI_TENANCY:-}}"
[ -n "$COMPARTMENT" ] || fail "OCI_TENANCY ist nicht gesetzt."
REGION="${OCI_REGION:-eu-frankfurt-1}"

echo "==> Suche aktiven Bastion"
BASTION=$(oci bastion bastion list --compartment-id "$COMPARTMENT" --all \
  --query 'data[?"lifecycle-state"==`ACTIVE`] | [0].id' --raw-output)
[ -n "$BASTION" ] && [ "$BASTION" != "null" ] || fail "Kein aktiver Bastion gefunden."

echo "==> Suche aktive Sitzung"
SESSION=$(oci bastion session list --bastion-id "$BASTION" --all \
  --query 'data[?"lifecycle-state"==`ACTIVE`] | [0].id' --raw-output)
[ -n "$SESSION" ] && [ "$SESSION" != "null" ] || fail "Keine aktive Sitzung. Im Bastion unter Sessions eine Managed SSH session erstellen."

IP=$(oci bastion session get --session-id "$SESSION" \
  --query 'data."target-resource-details"."target-resource-private-ip-address"' --raw-output)
USERNAME=$(oci bastion session get --session-id "$SESSION" \
  --query 'data."target-resource-details"."target-resource-operating-system-user-name"' --raw-output)
PORT=$(oci bastion session get --session-id "$SESSION" \
  --query 'data."target-resource-details"."target-resource-port"' --raw-output)
[ "$PORT" = "null" ] && PORT=22

if [ "$MODE" = "pruefen" ]; then
  # Nur lesend: das Prüfskript direkt von GitHub ausführen, ohne etwas zu installieren.
  REMOTE="curl -sL https://raw.githubusercontent.com/dannedotexe/HugoPredict/$BRANCH/scripts/diagnose-server.sh | bash"
else
  REMOTE="if [ -d ~/HugoPredict/.git ]; then git -C ~/HugoPredict pull --ff-only origin $BRANCH; else git clone -b $BRANCH $REPO ~/HugoPredict; fi && bash ~/HugoPredict/scripts/install-server.sh"
fi

echo "==> Verbinde mit $USERNAME@$IP über den Bastion"
OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
exec ssh -i "$KEY" "${OPTS[@]}" \
  -o ProxyCommand="ssh -i $KEY -o StrictHostKeyChecking=accept-new -W %h:%p -p 22 $SESSION@host.bastion.$REGION.oci.oraclecloud.com" \
  -p "$PORT" -t "$USERNAME@$IP" \
  "$REMOTE"

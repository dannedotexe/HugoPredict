#!/usr/bin/env bash
# Installiert oder aktualisiert den HugoSMP-Market-Bot auf einem Linux-Server
# (z. B. Oracle Cloud) und startet ihn dauerhaft – per pm2, falls vorhanden,
# sonst als systemd-Dienst. Erneut ausführen = Update.
set -euo pipefail

REPO="${REPO:-https://github.com/dannedotexe/HugoPredict.git}"
BRANCH="${BRANCH:-claude/hugosmp-market-discord-kyruph}"
DIR="${DIR:-$HOME/HugoPredict}"
NAME="hugopredict"

fail() { echo "FEHLER: $*" >&2; exit 1; }

command -v git >/dev/null || fail "git fehlt. Installieren mit: sudo apt install -y git  (Ubuntu)  oder  sudo dnf install -y git  (Oracle Linux)"
command -v node >/dev/null || fail "Node.js fehlt. Siehe README → Hosting auf Oracle Cloud."
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>18||(a===18&&b>=17)?0:1)' \
  || fail "Node $(node -v) ist zu alt – mindestens 18.17 nötig."

echo "==> Code laden ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" pull --ff-only origin "$BRANCH"
else
  git clone -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

echo "==> Abhängigkeiten installieren"
npm ci --omit=dev --no-audit --no-fund

if [ ! -f .env ]; then
  echo "==> Konfiguration (.env) anlegen"
  cp .env.example .env
  chmod 600 .env
  read -rp "Application ID (DISCORD_CLIENT_ID): " CID
  read -rp "Server-ID (DISCORD_GUILD_ID): " GID
  read -rsp "Bot-Token (DISCORD_TOKEN, Eingabe unsichtbar): " TOK; echo
  [[ "$CID" =~ ^[0-9]{15,25}$ ]] || fail "Application ID muss eine Zahl sein."
  [[ "$GID" =~ ^[0-9]{15,25}$ ]] || fail "Server-ID muss eine Zahl sein."
  [[ "$TOK" =~ ^[A-Za-z0-9._-]{50,}$ ]] || fail "Das sieht nicht nach einem Bot-Token aus."
  sed -i -e "s#^DISCORD_CLIENT_ID=.*#DISCORD_CLIENT_ID=$CID#" \
         -e "s#^DISCORD_GUILD_ID=.*#DISCORD_GUILD_ID=$GID#" \
         -e "s#^DISCORD_TOKEN=.*#DISCORD_TOKEN=$TOK#" .env
else
  echo "==> Vorhandene .env wird beibehalten"
fi
mkdir -p data

echo "==> Slash-Commands registrieren"
npm run deploy

if command -v pm2 >/dev/null; then
  echo "==> Start mit pm2"
  if pm2 describe "$NAME" >/dev/null 2>&1; then pm2 restart "$NAME"; else pm2 start src/index.js --name "$NAME"; fi
  pm2 save
  echo "Fertig. Logs: pm2 logs $NAME"
else
  echo "==> Start als systemd-Dienst (sudo nötig)"
  sudo tee "/etc/systemd/system/$NAME.service" >/dev/null <<EOF
[Unit]
Description=HugoSMP Market Discord-Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$DIR
ExecStart=$(command -v node) src/index.js
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable "$NAME"
  sudo systemctl restart "$NAME"
  echo "Fertig. Logs: journalctl -u $NAME -f"
fi

#!/usr/bin/env bash
# Richtet die HugoPredict-Website (Branch „website“) auf diesem Server ein und
# verbindet sie mit dem Discord-Bot und dem Minecraft-Bot:
#   bash ~/HugoPredict/scripts/setup-website.sh [domain]
# Standard-Domain: hugopredict.de. Erneut ausführen = Update, nichts geht verloren.
#
# Was passiert:
#   1. Website nach ~/HugoPredict-Website laden und mit pm2 starten (nur lokal erreichbar)
#   2. Gemeinsamen API-Schlüssel erzeugen und in beide .env-Dateien schreiben
#   3. Discord-Bot auf die Website zeigen lassen und neu starten
#   4. Caddy als HTTPS-Proxy für die Domain einrichten, Ports 80/443 öffnen
#   5. Automatische Updates der Website (wie beim Bot)
set -euo pipefail

DOMAIN="${1:-hugopredict.de}"
BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="${WEB_DIR:-$HOME/HugoPredict-Website}"
WEB_BRANCH="${WEB_BRANCH:-website}"
WEB_NAME="hugopredict-web"
BOT_NAME="hugopredict"

fail() { echo "FEHLER: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail "Ungültige Domain: $DOMAIN"
[ -f "$BOT_DIR/.env" ] || fail "Keine .env in $BOT_DIR – erst den Discord-Bot einrichten."
command -v pm2 >/dev/null || fail "pm2 fehlt (läuft der Discord-Bot mit pm2?)."

# Die Website braucht Node.js 22.13+ (eingebautes SQLite). Ist das System-Node älter,
# bekommt NUR die Website ein eigenes Node 22 in ~/.local/node22 – das System-Node
# und andere Bots auf dem Server bleiben unverändert.
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; }
NODE_BIN="$(command -v node)"
if ! node_ok "$NODE_BIN"; then
  NODE_HOME="$HOME/.local/node22"
  if ! node_ok "$NODE_HOME/bin/node"; then
    step "Eigenes Node.js 22 für die Website laden (System-Node $(node -v) bleibt)"
    case "$(uname -m)" in
      aarch64|arm64) ARCH=arm64 ;;
      x86_64|amd64) ARCH=x64 ;;
      *) fail "Unbekannte Prozessor-Architektur: $(uname -m)" ;;
    esac
    BASE="https://nodejs.org/dist/latest-v22.x"
    TMP="$(mktemp -d)"
    curl -fsSL --max-time 60 "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" || fail "Node-Download nicht erreichbar."
    FILE="$(grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-$ARCH\.tar\.xz" "$TMP/SHASUMS256.txt" | head -1)"
    [ -n "$FILE" ] || fail "Kein Node-22-Paket für $ARCH gefunden."
    curl -fsSL --max-time 300 "$BASE/$FILE" -o "$TMP/$FILE" || fail "Node-Download fehlgeschlagen."
    (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c --quiet -) || fail "Prüfsumme des Node-Downloads stimmt nicht."
    rm -rf "$NODE_HOME" && mkdir -p "$NODE_HOME"
    tar -xJf "$TMP/$FILE" -C "$NODE_HOME" --strip-components=1
    rm -rf "$TMP"
  fi
  NODE_BIN="$NODE_HOME/bin/node"
  node_ok "$NODE_BIN" || fail "Node 22 konnte nicht eingerichtet werden."
fi
# npm/npx der passenden Node-Version verwenden
export PATH="$(dirname "$NODE_BIN"):$PATH"
echo "Website nutzt Node $("$NODE_BIN" -v)"

# Setzt KEY=VALUE in einer .env (ersetzt eine vorhandene Zeile, sonst anhängen).
set_var() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
get_var() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- || true; }

step "Website laden (Branch $WEB_BRANCH)"
REPO="$(git -C "$BOT_DIR" remote get-url origin)"
if [ -d "$WEB_DIR/.git" ]; then
  git -C "$WEB_DIR" fetch -q origin "$WEB_BRANCH"
  git -C "$WEB_DIR" checkout -q "$WEB_BRANCH"
  git -C "$WEB_DIR" merge -q --ff-only "origin/$WEB_BRANCH"
else
  git clone -q -b "$WEB_BRANCH" "$REPO" "$WEB_DIR"
fi
cd "$WEB_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
mkdir -p data
git rev-parse HEAD > data/.deployed
printf '%s\n' "$NODE_BIN" > data/.node-bin

step "Konfiguration"
[ -f .env ] || { cp .env.example .env; chmod 600 .env; }
KEY="$(get_var .env HUGO_API_KEY)"
[ "${#KEY}" -ge 32 ] || KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
PORT="$(get_var .env PORT)"
PORT="${PORT:-3000}"
# Belegter Port (z. B. durch einen anderen Bot)? Dann den nächsten freien nehmen.
if ! pm2 describe "$WEB_NAME" >/dev/null 2>&1; then
  if command -v ss >/dev/null; then
    while ss -ltn "( sport = :$PORT )" | grep -q LISTEN; do PORT=$((PORT + 1)); done
  fi
fi
set_var .env PORT "$PORT"
set_var .env HUGO_API_KEY "$KEY"
set_var .env WEBSITE_URL "https://$DOMAIN"
set_var .env COOKIE_SECURE true
set_var .env BOT_ENABLED false
echo "Website-Port: $PORT (nur lokal, nach außen über HTTPS)"

step "Website starten"
if pm2 describe "$WEB_NAME" >/dev/null 2>&1; then
  # Falls sich das Node geändert hat: mit dem richtigen Interpreter neu anlegen
  pm2 delete "$WEB_NAME" >/dev/null 2>&1 || true
  pm2 start src/server.js --name "$WEB_NAME" --cwd "$WEB_DIR" --interpreter "$NODE_BIN" >/dev/null
else
  pm2 start src/server.js --name "$WEB_NAME" --cwd "$WEB_DIR" --interpreter "$NODE_BIN" >/dev/null
fi
for _ in $(seq 1 20); do
  curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 1
done
curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null || fail "Website antwortet nicht. Logs: pm2 logs $WEB_NAME"
curl -fs -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/api/bot/health" | grep -q '"ok"' \
  || fail "Bot-API der Website antwortet nicht mit dem Schlüssel. Logs: pm2 logs $WEB_NAME"
echo "Website läuft, Bot-API erreichbar."

step "Discord-Bot mit der Website verbinden"
cp "$BOT_DIR/.env" "$BOT_DIR/.env.backup-$(date +%Y%m%d-%H%M%S)"
set_var "$BOT_DIR/.env" HUGO_API_URL "http://127.0.0.1:$PORT/api/bot"
set_var "$BOT_DIR/.env" HUGO_API_KEY "$KEY"
set_var "$BOT_DIR/.env" WEBSITE_URL "https://$DOMAIN"
pm2 restart "$BOT_NAME" --update-env >/dev/null
pm2 save >/dev/null
echo "Discord-Bot neu gestartet (Minecraft-Bot läuft im selben Prozess mit)."

step "HTTPS für $DOMAIN (Caddy)"
if ! command -v caddy >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi
SITE_BLOCK="$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
if grep -q "^$DOMAIN {" "$CADDYFILE" 2>/dev/null; then
  echo "Caddy kennt $DOMAIN bereits."
elif grep -qE '^\s*:80\s*\{' "$CADDYFILE" 2>/dev/null && ! grep -q 'reverse_proxy' "$CADDYFILE"; then
  # Nur die Standard-Beispielseite von Caddy → ersetzen
  printf '%s\n' "$SITE_BLOCK" | sudo tee "$CADDYFILE" >/dev/null
else
  printf '\n%s\n' "$SITE_BLOCK" | sudo tee -a "$CADDYFILE" >/dev/null
fi
sudo systemctl enable --now caddy >/dev/null 2>&1 || true
sudo systemctl reload caddy || sudo systemctl restart caddy

step "Firewall auf dem Server (Ports 80 und 443)"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
done
command -v netfilter-persistent >/dev/null && sudo netfilter-persistent save >/dev/null 2>&1 || true

step "Automatische Updates der Website"
CRON="* * * * * PATH=$PATH bash $BOT_DIR/scripts/auto-update-website.sh $WEB_DIR >> $WEB_DIR/data/update.log 2>&1"
crontab -l > "$HOME/crontab-backup-$(date +%Y%m%d-%H%M%S).txt" 2>/dev/null || true
( crontab -l 2>/dev/null | grep -vF "auto-update-website.sh" || true; echo "$CRON" ) | crontab -
echo "Aktiv. Protokoll: $WEB_DIR/data/update.log"

IP="$(curl -fs --max-time 5 https://ifconfig.me 2>/dev/null || echo '<öffentliche IP der VM>')"
cat <<EOF

Fertig. Website, Discord-Bot und Minecraft-Bot sind verbunden.

Noch zu tun (einmalig, im Browser):
  1. Domain: Beim Anbieter von $DOMAIN einen A-Eintrag anlegen:  $DOMAIN  →  $IP
  2. Oracle Cloud: Netzwerk → Virtuelle Cloud-Netzwerke → Subnetz → Sicherheitsliste →
     Ingress-Regeln hinzufügen: Quelle 0.0.0.0/0, TCP, Zielport 80 und 443.
Danach holt Caddy das HTTPS-Zertifikat von selbst. Test: https://$DOMAIN
EOF

#!/usr/bin/env bash
# Nur lesend: zeigt, wie die Bots auf diesem Server gestartet und aktualisiert werden.
# Verändert nichts.

line() { printf '\n===== %s =====\n' "$1"; }

line "crontab ($USER)"
crontab -l 2>/dev/null || echo "(leer)"

line "crontab-Sicherungen"
ls -1 "$HOME"/crontab-backup-*.txt 2>/dev/null || echo "(keine)"

line "Update-/Deploy-Skripte im Home-Ordner"
find "$HOME" -maxdepth 4 -type f \( -iname '*update*.sh' -o -iname '*deploy*.sh' -o -iname '*pull*.sh' \) \
  -not -path '*/node_modules/*' 2>/dev/null || true

line "pm2"
if command -v pm2 >/dev/null; then pm2 jlist 2>/dev/null | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const p of JSON.parse(s))console.log(`${p.name.padEnd(20)} ${p.pm2_env.status.padEnd(9)} ${p.pm2_env.pm_cwd}`)}catch{console.log("(keine Ausgabe)")}})'
else echo "(pm2 nicht installiert)"; fi

line "systemd-Dienste (bot/discord/node)"
systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | grep -iE 'bot|discord|node|predict' || echo "(keine)"

line "Root-crontab und /etc/cron.d"
sudo -n crontab -l 2>/dev/null || echo "(leer oder kein Zugriff)"
ls -1 /etc/cron.d 2>/dev/null

line "Ordner im Home"
ls -1 "$HOME"

line "Speicher"
free -h | head -2
df -h "$HOME" | tail -1

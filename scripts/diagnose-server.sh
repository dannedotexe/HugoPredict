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

line "systemd-Timer"
systemctl list-timers --all --no-pager --no-legend 2>/dev/null | grep -viE 'apt|motd|logrotate|man-db|fstrim|fwupd|e2scrub|systemd-tmpfiles|update-notifier|snapd|dpkg|ua-timer|sysstat' || echo "(keine)"

for unit in $(systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | awk '{print $1}' | grep -iE 'deploy|update' | grep -viE 'apt|unattended|motd|update-notifier'); do
  line "Letzte Meldungen: $unit"
  systemctl show "$unit" -p ActiveState -p Result --no-pager 2>/dev/null
  journalctl -u "$unit" -n 12 --no-pager -o cat 2>/dev/null || sudo -n journalctl -u "$unit" -n 12 --no-pager -o cat 2>/dev/null || echo "(kein Zugriff)"
done

line "SSH-Schlüssel von $USER (nur Typ und Name, keine Schlüssel)"
if [ -f "$HOME/.ssh/authorized_keys" ]; then
  echo "Zuletzt geändert: $(date -r "$HOME/.ssh/authorized_keys" '+%Y-%m-%d %H:%M')"
  awk 'NF && $1 !~ /^#/ { n++; printf "%d. %s %s\n", n, $1, ($3 == "" ? "(ohne Namen)" : $3) }' "$HOME/.ssh/authorized_keys"
else
  echo "(keine authorized_keys)"
fi
ls -1 "$HOME"/.ssh/ 2>/dev/null

line "Letzte abgelehnte SSH-Anmeldungen"
(sudo -n journalctl -u ssh -u sshd --since "-3 days" --no-pager -o short 2>/dev/null || sudo -n cat /var/log/auth.log 2>/dev/null) \
  | grep -E "Failed publickey|Invalid user|Connection closed by authenticating" | tail -8 || echo "(keine oder kein Zugriff)"

line "Oracle Cloud Agent (Bastion)"
systemctl is-active oracle-cloud-agent 2>/dev/null || systemctl is-active snap.oracle-cloud-agent.oracle-cloud-agent 2>/dev/null || echo "(nicht gefunden)"

line "Root-crontab und /etc/cron.d"
sudo -n crontab -l 2>/dev/null || echo "(leer oder kein Zugriff)"
ls -1 /etc/cron.d 2>/dev/null

line "Ordner im Home"
ls -1 "$HOME"

line "Speicher"
free -h | head -2
df -h "$HOME" | tail -1

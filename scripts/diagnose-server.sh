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

line "Schlüssel nur in authorized_keys_backup (fehlen aktuell)"
if [ -f "$HOME/.ssh/authorized_keys_backup" ]; then
  echo "Sicherung zuletzt geändert: $(date -r "$HOME/.ssh/authorized_keys_backup" '+%Y-%m-%d %H:%M')"
  awk 'NR==FNR { if (NF && $1 !~ /^#/) have[$2]=1; next }
       NF && $1 !~ /^#/ { printf "%s %s %s\n", (($2 in have) ? "vorhanden:" : "FEHLT:    "), $1, ($3 == "" ? "(ohne Namen)" : $3) }' \
    "$HOME/.ssh/authorized_keys" "$HOME/.ssh/authorized_keys_backup"
else
  echo "(keine Sicherung)"
fi

line "Anmeldungen von ubuntu (erfolgreich/abgelehnt, letzte 3 Tage)"
LOGS="$(sudo -n journalctl -u ssh -u sshd --since "-3 days" --no-pager -o short 2>/dev/null || sudo -n cat /var/log/auth.log 2>/dev/null)"
echo "$LOGS" | grep -E "Accepted publickey for ubuntu|authenticating user ubuntu|Failed publickey for ubuntu" \
  | sed -E 's/^([A-Za-z]+ +[0-9]+ [0-9:]+).*(Accepted publickey|Connection closed by authenticating user|Failed publickey for)( for)? ?(ubuntu)? ?(from )?([0-9.]+).*/\1 \2 \6/' | tail -12 || echo "(keine oder kein Zugriff)"

line "Git-Zugang der Bots (ohne Tokens)"
for d in "$HOME"/*/; do
  [ -d "$d/.git" ] || continue
  url="$(git -C "$d" remote get-url origin 2>/dev/null | sed -E 's#//[^@/]+@#//***@#')"
  printf '%s\n  Remote: %s\n  Stand:  %s\n' "$(basename "$d")" "${url:-?}" "$(git -C "$d" log -1 --format='%cd %h' --date=format:'%Y-%m-%d %H:%M' 2>/dev/null)"
done
echo "credential.helper (global): $(git config --global --get credential.helper || echo '-')"
[ -f "$HOME/.git-credentials" ] && echo ".git-credentials: $(wc -l < "$HOME/.git-credentials") Eintrag/Einträge, geändert $(date -r "$HOME/.git-credentials" '+%Y-%m-%d %H:%M')" || echo ".git-credentials: nicht vorhanden"

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

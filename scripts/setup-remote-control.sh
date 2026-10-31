#!/usr/bin/env bash
# Richtet Claude Code „Remote Control“ auf diesem Server ein: Danach kann Claude
# aus der Claude-App direkt im Ordner ~/HugoPredict arbeiten – ohne Oracle Cloud Shell.
#   bash ~/HugoPredict/scripts/setup-remote-control.sh
#
# - Installiert Claude Code (offizieller Installer) und meldet dich einmal an.
# - Startet „claude remote-control“ dauerhaft in tmux (Sitzung „claude-rc“),
#   startet nach Abbrüchen und nach einem Server-Neustart von selbst wieder.
# - Jeder Zugriff fragt in der Claude-App um Erlaubnis. Stoppen: tmux kill-session -t claude-rc
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOOP="$HOME/.local/bin/hugopredict-remote-control"
SESSION="claude-rc"
export PATH="$HOME/.local/bin:$PATH"
step() { echo; echo "==> $*"; }

if ! command -v tmux >/dev/null; then
  step "tmux installieren"
  sudo apt-get update -qq && sudo apt-get install -y -qq tmux
fi

if ! command -v claude >/dev/null; then
  step "Claude Code installieren"
  curl -fsSL https://claude.ai/install.sh | bash
fi
echo "Claude Code: $(claude --version 2>/dev/null || echo '?')"

if [ ! -s "$HOME/.claude/.credentials.json" ]; then
  step "Anmelden (einmalig)"
  echo "Gleich erscheint ein Link. Öffne ihn auf dem Handy, melde dich mit deinem"
  echo "Claude-Konto an und füge den angezeigten Code hier ein."
  if ! claude auth login; then
    echo "Falls das nicht ging: Claude startet jetzt normal und fragt nach der Anmeldung."
    echo "Nach „Login successful“ mit /exit beenden."
    claude
  fi
  [ -s "$HOME/.claude/.credentials.json" ] || { echo "FEHLER: Anmeldung nicht abgeschlossen. Bitte nochmal ausführen."; exit 1; }
fi

step "Dauerbetrieb einrichten"
mkdir -p "$(dirname "$LOOP")"
cat > "$LOOP" <<LOOPEOF
#!/usr/bin/env bash
# Hält „claude remote-control“ für $DIR am Laufen (gestartet in tmux „$SESSION“).
export PATH="\$HOME/.local/bin:\$PATH"
cd "$DIR"
while true; do
  claude remote-control --name "HugoPredict-Server" || true
  echo "Remote Control beendet – Neustart in 15 Sekunden (Strg+C zweimal zum Stoppen)."
  sleep 15
done
LOOPEOF
chmod +x "$LOOP"
CRON="@reboot tmux new-session -d -s $SESSION $LOOP"
crontab -l > "$HOME/crontab-backup-$(date +%Y%m%d-%H%M%S).txt" 2>/dev/null || true
( crontab -l 2>/dev/null | grep -vF "hugopredict-remote-control" || true; echo "$CRON" ) | crontab -
echo "Startet auch nach einem Server-Neustart automatisch."

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo
  echo "Remote Control läuft schon (tmux-Sitzung „$SESSION“). Fertig."
  exit 0
fi

step "Remote Control starten"
echo "Beim ersten Start fragt Claude zweimal – jeweils mit  y  und Enter bestätigen:"
echo "  „Enable Remote Control? (y/n)“  und  „Trust $DIR? [y/N]“"
echo "Wenn danach Remote Control läuft, kannst du die Cloud Shell einfach schließen –"
echo "es läuft auf dem Server weiter."
echo
read -rp "Weiter mit Enter … " _ || true
exec tmux new-session -s "$SESSION" "$LOOP"

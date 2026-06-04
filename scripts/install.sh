#!/usr/bin/env bash
# Installation automatique de Netonix Manager
# Usage (en root) : bash scripts/install.sh [--port 3000] [--dir /opt/netonix-manager]
#
# Sur LXC / VPS où l'on est déjà root : lancez directement sans sudo.
# Sur système avec sudo : sudo bash scripts/install.sh

set -e

REPO_URL="https://github.com/Acidpix/Netonix_configurator.git"
APP_PORT=${APP_PORT:-3000}
APP_DIR=${APP_DIR:-/opt/netonix-manager}

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --port) APP_PORT="$2"; shift 2 ;;
    --dir)  APP_DIR="$2";  shift 2 ;;
    *) echo "Option inconnue : $1"; exit 1 ;;
  esac
done

echo ""
echo "════════════════════════════════════"
echo "  Netonix Manager — Installation"
echo "  Dossier : $APP_DIR"
echo "  Port    : $APP_PORT"
echo "════════════════════════════════════"
echo ""

# ── Vérifie les droits ────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "❌ Ce script doit être lancé en root (ou avec sudo)."
  exit 1
fi

# ── Localise node et npm ──────────────────────────────────────────────────────
# Cherche dans le PATH courant ET dans les emplacements courants (nvm, nodesource, n…)
SEARCH_PATHS="/usr/bin:/usr/local/bin:/usr/sbin:$HOME/.nvm/versions/node/*/bin:/opt/node/bin"
NODE_BIN=$(PATH="$PATH:$SEARCH_PATHS" command -v node 2>/dev/null || true)
NPM_BIN=$(PATH="$PATH:$SEARCH_PATHS" command -v npm  2>/dev/null || true)

if [[ -z "$NODE_BIN" ]]; then
  echo "❌ Node.js introuvable."
  echo "   Sur Debian/Ubuntu : curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
  exit 1
fi
if [[ -z "$NPM_BIN" ]]; then
  echo "❌ npm introuvable. Vérifiez votre installation Node.js."
  exit 1
fi

NODE_VER=$("$NODE_BIN" -e "process.stdout.write(process.version)")
echo "✓ Node.js $NODE_VER  ($NODE_BIN)"
echo "✓ npm                 ($NPM_BIN)"

# ── Localise git ──────────────────────────────────────────────────────────────
GIT_BIN=$(command -v git 2>/dev/null || true)
if [[ -z "$GIT_BIN" ]]; then
  echo "❌ git introuvable."
  echo "   Sur Debian/Ubuntu : apt-get install -y git"
  exit 1
fi
echo "✓ git ($GIT_BIN)"

# ── Clone ou met à jour le dépôt ──────────────────────────────────────────────
if [[ -d "$APP_DIR/.git" ]]; then
  echo "→ Dépôt existant détecté — mise à jour…"
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
  echo "✓ Code mis à jour depuis GitHub"
else
  echo "→ Clonage depuis $REPO_URL…"
  git clone "$REPO_URL" "$APP_DIR"
  echo "✓ Dépôt cloné dans $APP_DIR"
fi

mkdir -p "$APP_DIR/data"

# ── Installe les dépendances ──────────────────────────────────────────────────
cd "$APP_DIR"
"$NPM_BIN" install --omit=dev
echo "✓ Dépendances installées"

# ── Crée le .env ─────────────────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s/PORT=3000/PORT=$APP_PORT/" "$APP_DIR/.env"
  echo "✓ Fichier .env créé (port $APP_PORT)"
else
  echo "✓ Fichier .env existant conservé"
fi

# ── Service systemd ───────────────────────────────────────────────────────────
if command -v systemctl &>/dev/null; then
  # Adapte le service : remplace le chemin et retire User=/Group= si on est root
  sed "s|/opt/netonix-manager|$APP_DIR|g" \
    "$APP_DIR/systemd/netonix-manager.service" \
    | grep -v "^User=\|^Group=" \
    > /etc/systemd/system/netonix-manager.service

  # Ajoute ExecStart avec le bon chemin node
  sed -i "s|ExecStart=.*|ExecStart=$NODE_BIN $APP_DIR/src/server.js|" \
    /etc/systemd/system/netonix-manager.service

  systemctl daemon-reload
  systemctl enable netonix-manager
  systemctl restart netonix-manager
  echo "✓ Service systemd installé et démarré"
else
  echo "⚠ systemd non disponible — lancez manuellement :"
  echo "  $NODE_BIN $APP_DIR/src/server.js"
fi

# ── Résumé ────────────────────────────────────────────────────────────────────
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "✅ Installation terminée !"
echo "   → http://${IP:-localhost}:$APP_PORT"
echo ""
echo "Commandes utiles :"
echo "  systemctl status netonix-manager"
echo "  journalctl -u netonix-manager -f"
echo "  systemctl restart netonix-manager"
echo ""

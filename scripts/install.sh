#!/usr/bin/env bash
# Installation automatique de Netonix Manager
# Usage : sudo bash scripts/install.sh [--user pi] [--port 3000] [--dir /opt/netonix-manager]

set -e

APP_USER=${APP_USER:-pi}
APP_PORT=${APP_PORT:-3000}
APP_DIR=${APP_DIR:-/opt/netonix-manager}

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --user) APP_USER="$2"; shift 2 ;;
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
echo "  User    : $APP_USER"
echo "════════════════════════════════════"
echo ""

# Vérifie Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Node.js introuvable. Installez Node.js 16+ puis relancez."
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.version)")
echo "✓ Node.js $NODE_VER détecté"

# Crée le dossier d'installation
mkdir -p "$APP_DIR"
cp -r . "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" 2>/dev/null || true
mkdir -p "$APP_DIR/data"

# Installe les dépendances
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --omit=dev

# Crée le .env
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s/PORT=3000/PORT=$APP_PORT/" "$APP_DIR/.env"
  echo "✓ Fichier .env créé"
fi

# Installe le service systemd
sed "s|/opt/netonix-manager|$APP_DIR|g; s|User=pi|User=$APP_USER|g; s|Group=pi|Group=$APP_USER|g" \
  "$APP_DIR/systemd/netonix-manager.service" > /etc/systemd/system/netonix-manager.service

systemctl daemon-reload
systemctl enable netonix-manager
systemctl restart netonix-manager

echo ""
echo "✅ Installation terminée !"
echo "   → http://$(hostname -I | awk '{print $1}'):$APP_PORT"
echo ""
echo "Commandes utiles :"
echo "  sudo systemctl status netonix-manager"
echo "  sudo journalctl -u netonix-manager -f"
echo ""

#!/usr/bin/env bash
# Mise à jour de Netonix Manager depuis GitHub
# Usage (en root) : bash scripts/update.sh [--dir /opt/netonix-manager]

set -e

REPO_URL="https://github.com/Acidpix/Netonix_configurator.git"
APP_DIR=${APP_DIR:-/opt/netonix-manager}

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir) APP_DIR="$2"; shift 2 ;;
    *) echo "Option inconnue : $1"; exit 1 ;;
  esac
done

echo ""
echo "════════════════════════════════════"
echo "  Netonix Manager — Mise à jour"
echo "  Dossier : $APP_DIR"
echo "════════════════════════════════════"
echo ""

# ── Vérifie les droits ────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "❌ Ce script doit être lancé en root (ou avec sudo)."
  exit 1
fi

# ── Vérifie que le dossier d'installation existe ─────────────────────────────
if [[ ! -d "$APP_DIR" ]]; then
  echo "❌ Dossier $APP_DIR introuvable."
  echo "   Lancez d'abord scripts/install.sh"
  exit 1
fi

# ── Localise git ──────────────────────────────────────────────────────────────
GIT_BIN=$(command -v git 2>/dev/null || true)
if [[ -z "$GIT_BIN" ]]; then
  echo "❌ git introuvable."
  echo "   Sur Debian/Ubuntu : apt-get install -y git"
  exit 1
fi
echo "✓ git ($GIT_BIN)"

# ── Localise npm ──────────────────────────────────────────────────────────────
SEARCH_PATHS="/usr/bin:/usr/local/bin:/usr/sbin:$HOME/.nvm/versions/node/*/bin:/opt/node/bin"
NPM_BIN=$(PATH="$PATH:$SEARCH_PATHS" command -v npm 2>/dev/null || true)
if [[ -z "$NPM_BIN" ]]; then
  echo "❌ npm introuvable. Vérifiez votre installation Node.js."
  exit 1
fi
echo "✓ npm ($NPM_BIN)"

# ── Récupère la version actuelle ──────────────────────────────────────────────
cd "$APP_DIR"
CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "inconnu")
echo "✓ Version actuelle : $CURRENT_COMMIT"

# ── Initialise git si nécessaire ─────────────────────────────────────────────
if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "→ Initialisation du dépôt git…"
  git init
  git remote add origin "$REPO_URL"
fi

# ── Vérifie/met à jour le remote ──────────────────────────────────────────────
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || true)
if [[ "$CURRENT_REMOTE" != "$REPO_URL" ]]; then
  git remote set-url origin "$REPO_URL"
  echo "✓ Remote mis à jour : $REPO_URL"
fi

# ── Sauvegarde les fichiers locaux importants ─────────────────────────────────
echo "→ Sauvegarde de .env et data/…"
TMP_ENV=$(mktemp)
TMP_DATA=$(mktemp -d)

[[ -f "$APP_DIR/.env" ]]  && cp "$APP_DIR/.env" "$TMP_ENV"
[[ -d "$APP_DIR/data" ]]  && cp -r "$APP_DIR/data/." "$TMP_DATA/"

# ── Tire la dernière version ───────────────────────────────────────────────────
echo "→ Récupération depuis GitHub…"
git fetch origin main
git reset --hard origin/main
echo "✓ Code mis à jour"

# ── Restaure les fichiers locaux ──────────────────────────────────────────────
mkdir -p "$APP_DIR/data"
[[ -s "$TMP_ENV" ]]       && cp "$TMP_ENV" "$APP_DIR/.env"  && echo "✓ .env restauré"
[[ -n "$(ls -A "$TMP_DATA" 2>/dev/null)" ]] \
  && cp -r "$TMP_DATA/." "$APP_DIR/data/" && echo "✓ data/ restauré"

rm -f "$TMP_ENV"
rm -rf "$TMP_DATA"

# ── Met à jour les dépendances ────────────────────────────────────────────────
echo "→ Mise à jour des dépendances…"
"$NPM_BIN" install --omit=dev
echo "✓ Dépendances à jour"

# ── Redémarre le service si systemd est dispo ─────────────────────────────────
if command -v systemctl &>/dev/null && systemctl is-active --quiet netonix-manager 2>/dev/null; then
  systemctl restart netonix-manager
  echo "✓ Service redémarré"
else
  echo "⚠ Redémarrez le service manuellement :"
  echo "  systemctl restart netonix-manager"
fi

# ── Résumé ────────────────────────────────────────────────────────────────────
NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "inconnu")
echo ""
echo "✅ Mise à jour terminée !"
echo "   $CURRENT_COMMIT → $NEW_COMMIT"
echo ""
echo "Commandes utiles :"
echo "  systemctl status netonix-manager"
echo "  journalctl -u netonix-manager -f"
echo ""

#!/usr/bin/env bash
# ==============================================================================
# AkiLab DN42 Peering Portal - One-Click Installer (Master Server)
# ==============================================================================
# Installs the portal to /opt/dn42-portal with zero on-server compilation
# (all frontend assets are pre-built and tracked in the repository).
#
# Usage: sudo bash install.sh
# ==============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/akira3143/dnpeer_portal}"
INSTALL_DIR="${INSTALL_DIR:-/opt/dn42-portal}"
SERVICE_NAME="dn42-portal"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root (e.g. sudo bash install.sh)" >&2
  exit 1
fi

echo "==============================================================================="
echo "       AkiLab DN42 Peering Portal - Master Server Installer"
echo "==============================================================================="

# 1. Prerequisites
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install Node.js >= 20 first (https://nodejs.org)" >&2
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[ERROR] Node.js >= 20 required (current: $(node -v))" >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "[ERROR] git not found. Install git first." >&2
  exit 1
fi
echo "[1/7] Prerequisites OK (node $(node -v), git $(git --version | cut -d' ' -f3))"

# 2. Fetch source (clone or update)
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[2/7] Updating existing repository..."
  git -C "$INSTALL_DIR" pull --ff-only origin main || git -C "$INSTALL_DIR" pull --ff-only origin master
else
  echo "[2/7] Cloning repository to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# 3. Install dependencies (runtime only, zero build)
echo "[3/7] Installing dependencies (npm ci --omit=dev)..."
cd "$INSTALL_DIR"
npm ci --omit=dev

# 3b. Register dnp management CLI globally
if ! command -v dnp >/dev/null 2>&1; then
  npm link --no-fund --no-audit >/dev/null 2>&1 || ln -sf "$INSTALL_DIR/bin/dnp.js" /usr/local/bin/dnp
fi

# 4. Environment file
if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo "[4/7] Generating .env ..."
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | xxd -p -c64)
  {
    echo "NODE_ENV=production"
    echo "PORT=4242"
    echo "HOST=127.0.0.1"
    echo "AUTH_JWT_SECRET=$JWT_SECRET"
    echo ""
    echo "# Telegram Bot Notifications (Optional)"
    echo "TELEGRAM_BOT_TOKEN="
    echo "TELEGRAM_CHAT_ID="
  } > "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  echo "    .env created. Edit $INSTALL_DIR/.env to set Telegram credentials if needed."
else
  echo "[4/7] .env already exists, skipping."
fi

# 5. DN42 registry clone (authoritative SSH key source)
REGISTRY_DIR="$INSTALL_DIR/server/data/registry"
if [ ! -d "$REGISTRY_DIR/.git" ]; then
  echo "[5/7] Cloning DN42 registry (one-time, ~50MB)..."
  mkdir -p "$REGISTRY_DIR"
  git clone --depth 1 https://git.dn42.dev/dn42/registry "$REGISTRY_DIR"
else
  echo "[5/7] DN42 registry already present."
fi

# 6. Initialize admin account (password login)
AUTH_FILE="$INSTALL_DIR/server/data/auth_users.json"
if [ ! -s "$AUTH_FILE" ]; then
  echo "[6/7] Initializing admin account..."
  ADMIN_ASN=""
  while [ -z "$ADMIN_ASN" ]; do
    printf "Admin ASN: "
    read -r ADMIN_ASN
    ADMIN_ASN=$(echo "$ADMIN_ASN" | tr -cd '0-9')
    [ -z "$ADMIN_ASN" ] && echo "    Admin ASN is required."
  done
  printf "Admin password (min 8 chars): "
  stty -echo
  read -r ADMIN_PASS
  stty echo
  echo ""
  if [ -z "$ADMIN_PASS" ] || [ "${#ADMIN_PASS}" -lt 8 ]; then
    echo "[ERROR] Password must be at least 8 characters." >&2
    exit 1
  fi
  ADMIN_PASS="$ADMIN_PASS" ADMIN_ASN="$ADMIN_ASN" node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(process.env.ADMIN_PASS, salt, 64).toString("hex");
    const users = { [process.env.ADMIN_ASN]: {
      asn: parseInt(process.env.ADMIN_ASN, 10),
      asName: "ADMIN",
      role: "admin",
      salt, hash,
      createdAt: new Date().toISOString()
    }};
    fs.writeFileSync(process.argv[1], JSON.stringify(users, null, 2) + "\n");
  ' "$AUTH_FILE"
  echo "    Admin account created for AS$ADMIN_ASN."
else
  echo "[6/7] auth_users.json already exists, skipping."
fi

# 7. Install systemd unit and start
echo "[7/7] Installing systemd service..."
sed "s|WorkingDirectory=.*|WorkingDirectory=$INSTALL_DIR|" \
  "$INSTALL_DIR/deploy/dn42-portal.service" > "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
sleep 2
systemctl --no-pager --lines=0 status "$SERVICE_NAME" || true

echo ""
echo "==============================================================================="
echo "  Installation complete."
echo "  Portal backend : http://127.0.0.1:4242  (bind a reverse proxy for public access)"
echo "  Service manage : systemctl status|restart $SERVICE_NAME"
echo "  Logs           : journalctl -u $SERVICE_NAME -f"
echo "  Registry sync  : auto (on-demand + every 30min in-process)"
echo "==============================================================================="

#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# AkiLab DN42 Looking Glass Proxy Standalone Deployer (scripts/deploy-lgproxy.sh)
#
# Installs bird-lgproxy and creates a systemd service listening on 127.0.0.1:5000
# (or configured LISTEN_ADDR / LISTEN_PORT).
# ==============================================================================

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root (e.g. sudo bash $0)." >&2
  exit 1
fi

LISTEN_ADDR="${LISTEN_ADDR:-127.0.0.1}"
LISTEN_PORT="${LISTEN_PORT:-5000}"

echo "==============================================================================="
echo "       AkiLab DN42 BIRD Looking Glass Proxy Deployer"
echo "==============================================================================="
echo "Target binding: ${LISTEN_ADDR}:${LISTEN_PORT}"

# 1. Install bird-lgproxy
echo "[1/3] Checking and installing bird-lgproxy..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q || true

if ! command -v bird-lgproxy >/dev/null 2>&1; then
  apt-get install -y -q bird-lgproxy || {
    echo "Warning: bird-lgproxy package not found directly in apt sources."
    echo "Please verify that the Debian/Ubuntu bird-lg repository or deb is configured."
  }
fi

# 2. Generate systemd unit
echo "[2/3] Writing /etc/systemd/system/bird-lgproxy.service..."
cat << EOF > /etc/systemd/system/bird-lgproxy.service
[Unit]
Description=BIRD Looking Glass Proxy (AkiLab DN42)
After=network.target bird.service bird6.service
Wants=bird.service

[Service]
Type=simple
ExecStart=/usr/bin/bird-lgproxy -listen ${LISTEN_ADDR}:${LISTEN_PORT}
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

# 3. Reload systemd & start
echo "[3/3] Enabling and starting bird-lgproxy service..."
systemctl daemon-reload
systemctl enable --now bird-lgproxy || true

echo "==============================================================================="
echo "✓ bird-lgproxy service configured and started."
echo "  Listening on: http://${LISTEN_ADDR}:${LISTEN_PORT}"
echo "  Check status with: systemctl status bird-lgproxy"
echo "==============================================================================="


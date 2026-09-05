#!/usr/bin/env bash
# ==============================================================================
# AkiLab DN42 Probe Agent - One-Click Installer (Edge Node)
# ==============================================================================
# Installs probe-agent.js + systemd units on an edge node (JP-2 / HK-1 / US-LA1).
# The agent reports WG ports, BGP session states (birdc show protocols) and
# heartbeats to the portal master every 5 minutes.
#
# Usage (on the edge node):
#   sudo PORTAL_MASTER_URL=https://<your-portal-domain> bash install-probe.sh
#   # Optional auto-claim: append CLAIM_NODE_ID=JP-2 CLAIM_TOKEN=<token>
#   # (token is generated on the master with: dnp probe JP-2)
# ==============================================================================
set -euo pipefail

AGENT_DIR="/opt/dn42-probe"
REPO_RAW="https://raw.githubusercontent.com/akira3143/dnpeer_portal/main"
ENV_FILE="/etc/default/dn42-probe"
MASTER_URL="${PORTAL_MASTER_URL:-}"
CLAIM_NODE_ID="${CLAIM_NODE_ID:-}"
CLAIM_TOKEN="${CLAIM_TOKEN:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root (e.g. sudo bash install-probe.sh)" >&2
  exit 1
fi

if [ -z "$MASTER_URL" ]; then
  echo "[ERROR] PORTAL_MASTER_URL is required." >&2
  echo "        Usage: sudo PORTAL_MASTER_URL=https://<portal-domain> bash install-probe.sh" >&2
  exit 1
fi

echo "==============================================================================="
echo "       AkiLab DN42 Probe Agent - Edge Node Installer"
echo "==============================================================================="

# 1. Install agent
echo "[1/4] Downloading probe-agent.js..."
mkdir -p "$AGENT_DIR"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$REPO_RAW/scripts/probe-agent.js" -o "$AGENT_DIR/probe-agent.js"
else
  wget -q "$REPO_RAW/scripts/probe-agent.js" -O "$AGENT_DIR/probe-agent.js"
fi
chmod 644 "$AGENT_DIR/probe-agent.js"

# 2. Environment defaults
echo "[2/4] Writing $ENV_FILE ..."
{
  echo "# AkiLab DN42 Probe Agent environment"
  echo "PORTAL_MASTER_URL=$MASTER_URL"
  echo "CLAIM_NODE_ID=$CLAIM_NODE_ID"
  echo "CLAIM_TOKEN=$CLAIM_TOKEN"
  echo "NODE_ID="
  echo "NODE_TOKEN="
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# 3. Download systemd units
echo "[3/4] Installing systemd units..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$REPO_RAW/deploy/dn42-probe.service" -o /etc/systemd/system/dn42-probe.service
  curl -fsSL "$REPO_RAW/deploy/dn42-probe.path"  -o /etc/systemd/system/dn42-probe.path
  curl -fsSL "$REPO_RAW/deploy/dn42-probe.timer" -o /etc/systemd/system/dn42-probe.timer
else
  wget -q "$REPO_RAW/deploy/dn42-probe.service" -O /etc/systemd/system/dn42-probe.service
  wget -q "$REPO_RAW/deploy/dn42-probe.path"  -O /etc/systemd/system/dn42-probe.path
  wget -q "$REPO_RAW/deploy/dn42-probe.timer" -O /etc/systemd/system/dn42-probe.timer
fi

# 4. Enable and start
echo "[4/4] Enabling probe timer (5min interval + WG file-change trigger)..."
systemctl daemon-reload
systemctl enable --now dn42-probe.timer dn42-probe.path
systemctl start dn42-probe.service || true

echo ""
echo "==============================================================================="
echo "  Probe agent installed."
echo "  Manual run : systemctl start dn42-probe.service"
echo "  Logs       : journalctl -u dn42-probe.service -f"
if [ -z "$CLAIM_NODE_ID" ]; then
  echo ""
  echo "  NOTE: no CLAIM_NODE_ID/CLAIM_TOKEN given. The agent will auto-register"
  echo "        with its local WireGuard public key; add the node on the master"
  echo "        first (dnp probe <NODE_ID>) so the registration can complete."
fi
echo "==============================================================================="

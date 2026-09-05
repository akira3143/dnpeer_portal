#!/usr/bin/env bash
# ==============================================================================
# AkiLab DN42 Probe Agent - One-Click Uninstaller (Edge Node)
# ==============================================================================
# Usage: sudo bash uninstall-probe.sh [--purge]
#   (--purge also removes /opt/dn42-probe and /etc/default/dn42-probe)
# ==============================================================================
set -euo pipefail

AGENT_DIR="/opt/dn42-probe"
ENV_FILE="/etc/default/dn42-probe"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root (e.g. sudo bash uninstall-probe.sh)" >&2
  exit 1
fi

echo "Stopping probe timer, path watcher and service..."
systemctl disable --now dn42-probe.timer 2>/dev/null || true
systemctl disable --now dn42-probe.path 2>/dev/null || true
systemctl disable --now dn42-probe.service 2>/dev/null || true

rm -f /etc/systemd/system/dn42-probe.service
rm -f /etc/systemd/system/dn42-probe.path
rm -f /etc/systemd/system/dn42-probe.timer
systemctl daemon-reload

if [ "$PURGE" -eq 1 ]; then
  echo "Removing $AGENT_DIR and $ENV_FILE..."
  rm -rf "$AGENT_DIR"
  rm -f "$ENV_FILE"
else
  echo "Keeping $AGENT_DIR (identity state preserved)."
  echo "Use 'sudo bash uninstall-probe.sh --purge' to remove everything."
fi

echo "Done. Probe agent uninstalled."

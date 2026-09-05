#!/usr/bin/env bash
# ==============================================================================
# AkiLab DN42 Peering Portal - One-Click Uninstaller (Master Server)
# ==============================================================================
# Stops and removes the portal service. By default keeps /opt/dn42-portal
# (sessions, ledger, tokens). Use --purge to remove everything.
#
# Usage: sudo bash uninstall.sh [--purge]
# ==============================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/dn42-portal}"
SERVICE_NAME="dn42-portal"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root (e.g. sudo bash uninstall.sh)" >&2
  exit 1
fi

echo "Stopping and disabling $SERVICE_NAME..."
systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true

rm -f "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload

if [ "$PURGE" -eq 1 ]; then
  echo "Removing $INSTALL_DIR (all data including sessions, ledger, tokens)..."
  rm -rf "$INSTALL_DIR"
else
  echo "Keeping $INSTALL_DIR (data preserved)."
  echo "Use 'sudo bash uninstall.sh --purge' to remove everything."
fi

echo "Done. $SERVICE_NAME uninstalled."

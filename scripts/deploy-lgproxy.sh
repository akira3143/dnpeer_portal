#!/usr/bin/env bash
# ==============================================================================
# AkiLab DN42 Looking Glass Proxy Deployer (Go implementation)
# ==============================================================================
# Downloads the prebuilt Go binary bird-lgproxy-go (github.com/xddxdd/bird-lg-go)
# and runs it as a systemd service on 127.0.0.1:5000.
#
# Usage: sudo bash deploy-lgproxy.sh
# ==============================================================================
set -euo pipefail

VERSION="1.4.8"
LISTEN_ADDR="${LISTEN_ADDR:-127.0.0.1}"
LISTEN_PORT="${LISTEN_PORT:-5000}"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root (e.g. sudo bash $0)." >&2
  exit 1
fi

# Detect architecture for the release asset name
case "$(uname -m)" in
  x86_64) ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  armv7l) ARCH="arm" ;;
  i386|i686) ARCH="386" ;;
  *) echo "[ERROR] Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

DOWNLOAD_URL="https://github.com/xddxdd/bird-lg-go/releases/download/v${VERSION}/bird-lgproxy-go-v${VERSION}-linux-${ARCH}.tar.gz"

echo "==============================================================================="
echo "       AkiLab DN42 Looking Glass Proxy Deployer (Go binary)"
echo "==============================================================================="
echo "Target binding: ${LISTEN_ADDR}:${LISTEN_PORT}"
echo "Download URL : ${DOWNLOAD_URL}"

# 1. Download and extract the prebuilt binary
echo "[1/3] Downloading bird-lgproxy-go v${VERSION} (${ARCH})..."
TMPDIR_DL=$(mktemp -d)
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "$TMPDIR_DL/lgproxy.tar.gz"
else
  wget -q "$DOWNLOAD_URL" -O "$TMPDIR_DL/lgproxy.tar.gz"
fi
tar -xzf "$TMPDIR_DL/lgproxy.tar.gz" -C "$TMPDIR_DL"

# Locate the extracted binary inside the tarball
LGP_BIN=$(find "$TMPDIR_DL" -maxdepth 2 -type f \( -name "bird-lgproxy-go" -o -name "bird-lgproxy" -o -name "lgproxy-go" \) | head -n 1)
if [ -z "$LGP_BIN" ]; then
  echo "[ERROR] Could not locate bird-lgproxy binary inside the tarball." >&2
  echo "Contents:"; find "$TMPDIR_DL" -maxdepth 2 -type f | sed 's/^/  /' >&2
  exit 1
fi

install -m 755 "$LGP_BIN" /usr/local/bin/bird-lgproxy
rm -rf "$TMPDIR_DL"
echo "    Installed: /usr/local/bin/bird-lgproxy ($(/usr/local/bin/bird-lgproxy --version 2>/dev/null || echo 'version flag n/a'))"

# 2. Generate systemd unit
echo "[2/3] Writing /etc/systemd/system/bird-lgproxy.service..."
cat << EOF > /etc/systemd/system/bird-lgproxy.service
[Unit]
Description=BIRD Looking Glass Proxy (Go, AkiLab DN42)
After=network.target bird.service bird6.service
Wants=bird.service

[Service]
Type=simple
ExecStart=/usr/local/bin/bird-lgproxy --listen ${LISTEN_ADDR}:${LISTEN_PORT} --bird /run/bird/bird.ctl
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

# 3. Reload systemd & start
echo "[3/3] Enabling and starting bird-lgproxy service..."
systemctl daemon-reload
systemctl enable --now bird-lgproxy || true
sleep 2
systemctl --no-pager --lines=3 status bird-lgproxy || true

echo ""
echo "==============================================================================="
echo "  bird-lgproxy deployed."
echo "  Endpoint : http://${LISTEN_ADDR}:${LISTEN_PORT}"
echo "  Verify   : curl -s \"http://${LISTEN_ADDR}:${LISTEN_PORT}/api/bird?cmd=show%20protocols%20all\""
echo "==============================================================================="

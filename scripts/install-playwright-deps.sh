#!/usr/bin/env bash
set -euo pipefail

SUDO=""
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "This script requires root privileges (or sudo)." >&2
    exit 1
  fi
fi

YARN_SOURCE="/etc/apt/sources.list.d/yarn.list"
YARN_DISABLED="/etc/apt/sources.list.d/yarn.list.disabled-by-hvy"
RESTORE_YARN=0

if [ -f "$YARN_SOURCE" ]; then
  $SUDO mv "$YARN_SOURCE" "$YARN_DISABLED"
  RESTORE_YARN=1
fi

restore_sources() {
  if [ "$RESTORE_YARN" -eq 1 ] && [ -f "$YARN_DISABLED" ]; then
    $SUDO mv "$YARN_DISABLED" "$YARN_SOURCE"
  fi
}
trap restore_sources EXIT

$SUDO apt-get update
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  libasound2t64 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libatspi2.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libwayland-client0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb-dri3-0 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  libxrender1 \
  libxshmfence1 \
  libxss1 \
  libxtst6 \
  fonts-liberation \
  ca-certificates

npx playwright install chromium

echo "Playwright system dependencies and Chromium browser installed."

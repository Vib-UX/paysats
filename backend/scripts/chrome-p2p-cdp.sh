#!/usr/bin/env bash
# Start Chrome with CDP so Patchright can attach (P2P_CHROME_CDP_URL=http://localhost:9222).
# Quit all Chrome windows first, then:
#   chmod +x scripts/chrome-p2p-cdp.sh && ./scripts/chrome-p2p-cdp.sh
#
# Override defaults:
#   P2P_CHROME_USER_DATA_DIR  (default: ~/Library/Application Support/Google/Chrome)
#   P2P_CHROME_PROFILE_DIRECTORY (default: Profile 10)

set -euo pipefail
PORT="${P2P_CHROME_DEBUG_PORT:-9222}"
UD="${P2P_CHROME_USER_DATA_DIR:-$HOME/Library/Application Support/Google/Chrome}"
PD="${P2P_CHROME_PROFILE_DIRECTORY:-Profile 10}"

exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "--remote-debugging-port=${PORT}" \
  "--user-data-dir=${UD}" \
  "--profile-directory=${PD}"

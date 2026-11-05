#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
# including ports, remain AGPLv3; serving them over a network requires releasing their source.
#
# Boot the Carbon dev stack in a Claude Code cloud container (or any root Linux
# box with Docker installed) so an agent can use the ERP a few minutes after
# the session starts. Idempotent and quick: the stack itself boots in the
# background and this script returns at once.
#
#   scripts/cloud-dev.sh            # from the repo root, or the SessionStart hook
#   CARBON_DEV_APPS=erp,mes scripts/cloud-dev.sh
#
# What it does:
#   1. Puts Node 24 first on PATH when the box has an older default
#      (/opt/node24 in the Claude container), and persists that for the session.
#      Sets BOT_PROTECTION=none for the session, so the login form posts without
#      the Cloudflare Turnstile widget a local stack otherwise shows.
#   2. Installs dependencies when node_modules is missing.
#   3. Starts `pnpm dev` (crbn up --no-portless) detached, unless one is running.
#      crbn starts dockerd itself, mints every required env value into .env.local
#      (no .env needed) and seeds test@carbon.ms, which the login bypass accepts.
#   4. Points agent-browser at the preinstalled Chrome when both exist.
#
# The log is ~/.carbon/logs/crbn-up.log; `crbn status` shows the stack.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

env_file="${CLAUDE_ENV_FILE:-}"
persist() {
  # Export for this script and, when Claude Code gives us its env file, for
  # every later command of the session.
  export "$1=$2"
  if [ -n "$env_file" ]; then
    printf 'export %s=%q\n' "$1" "$2" >> "$env_file"
  fi
}

# --- 1. Node 24.22.1+ (what packages/dev/bin/crbn requires) --------------------
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  printf '%s\n' "24.22.1" "$(node -v | sed 's/^v//')" | sort -V -C
}
if ! node_ok; then
  for candidate in /opt/node24/bin "$HOME/.nvm/versions/node"/v24*/bin; do
    if [ -x "$candidate/node" ]; then
      persist PATH "$candidate:$PATH"
      break
    fi
  done
fi
if ! node_ok; then
  echo "cloud-dev: Node 24.22.1+ is required and none was found (see .nvmrc)" >&2
  exit 1
fi

# No login bot check: a local stack uses Cloudflare's Turnstile test keys, and
# the bypass login and agent-browser must post the form without that widget
# (the container's proxy may not reach challenges.cloudflare.com at all).
persist BOT_PROTECTION none

# --- 2. Dependencies -----------------------------------------------------------
if [ ! -x node_modules/.bin/crbn ]; then
  echo "cloud-dev: installing dependencies"
  corepack enable >/dev/null 2>&1 || true
  pnpm install --prefer-offline
fi

# --- 3. The stack, detached ----------------------------------------------------
mkdir -p "$HOME/.carbon/logs"
log="$HOME/.carbon/logs/crbn-up.log"
if pgrep -f "packages/dev/src/main.ts up" >/dev/null 2>&1; then
  echo "cloud-dev: crbn up is already running (log: $log)"
else
  echo "cloud-dev: starting the dev stack in the background (log: $log)"
  CARBON_DEV_APPS="${CARBON_DEV_APPS:-erp}" CARBON_DEV_YES=1 \
    setsid nohup pnpm dev >"$log" 2>&1 < /dev/null &
fi

# --- 4. agent-browser (the /auth, /test and /smoke-test skills) ----------------
if command -v agent-browser >/dev/null 2>&1 && [ -z "${AGENT_BROWSER_EXECUTABLE_PATH:-}" ]; then
  for chrome in "${CHROME_PATH:-}" /usr/bin/google-chrome /usr/bin/chromium /opt/pw-browsers/chromium/chrome; do
    if [ -n "$chrome" ] && [ -x "$chrome" ]; then
      persist AGENT_BROWSER_EXECUTABLE_PATH "$chrome"
      break
    fi
  done
fi

cat <<MSG
cloud-dev: the ERP will answer on http://localhost:3000 once the stack is up
  (a cold boot takes 2-6 minutes; a request made earlier waits for it).
  Sign in as test@carbon.ms — no magic link, no bot check.
  Progress: tail -f $log   State: crbn status
MSG

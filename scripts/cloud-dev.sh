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
#   scripts/cloud-dev.sh --prepare  # the environment's Setup script: no stack
#   scripts/cloud-dev.sh --prepare --database   # the same, plus a migrated database
#
# Set SESSION_SECRET in the cloud environment’s secret settings before booting.
#
# What it does:
#   1. Puts Node 24 first on PATH when the box has an older default
#      (/opt/node24 in the Claude container), and persists that for the session.
#      Sets BOT_PROTECTION=none for the session, so the login form posts without
#      the Cloudflare Turnstile widget a local stack otherwise shows.
#   2. Installs dependencies when node_modules is missing.
#   3. Starts `crbn up --no-portless` detached, unless one is running, with
#      CARBON_DEV_CLOUD=1. That switch turns on the container-only steps of
#      crbn (a developer's own `pnpm dev` never sets it): start dockerd and
#      start the dev servers while the
#      database migrates, warm up Vite and allow any host. It seeds
#      test@carbon.ms, which the login bypass accepts. `--no-regen` skips the
#      type and swagger regeneration: a fresh volume applies every migration,
#      and the committed types already match the committed migrations (the
#      Database types workflow fails a pull request where they differ). It
#      saves about 30 s per container.
#   4. Points agent-browser at the preinstalled Chrome, and installs agent-browser
#      when it is missing (in the background, so the session does not wait). The
#      /auth, /test and /smoke-test skills drive the browser through it; Chrome
#      itself is in the container (/usr/bin/google-chrome adds --no-sandbox for
#      root), agent-browser is not.
#
# --prepare is for the environment's Setup script (cloud environment menu, Edit):
#
#   cd carbon && [ -f scripts/cloud-dev.sh ] && bash scripts/cloud-dev.sh --prepare || true
#
# It does steps 1 and 2, installs agent-browser, starts dockerd, and pulls the images the default worktree
# stack and crbn-shared boot (including the `mail` profile), in parallel, skipping
# any that are present. The environment keeps the result, so a new session finds
# the images and the stack boots without the ~50 s pull. No dev server starts.
#
# --database also boots the whole stack once, through the ERP's login page and
# app shell, so the Docker volumes hold the migrations, the RLS policies and the
# test@carbon.ms user and Vite has pre-bundled the ERP's dependencies (its cache
# is apps/erp/node_modules/.vite, inside the node_modules the environment
# keeps). It then stops everything and keeps the volumes and the cache. A new
# session migrates only what its branch added, skips the seed and
# skips the dependency pre-bundling (about
# 15 s). The first run takes a couple of minutes, so it belongs in a Setup
# script, which runs once and is kept.
#
# The log is ~/.carbon/logs/crbn-up.log; `packages/dev/bin/crbn status` shows the stack.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

# The agent-browser CLI the UI-verification skills use (see step 4).
AGENT_BROWSER_VERSION="${AGENT_BROWSER_VERSION:-0.41.2}"

prepare=0
database=0
for arg in "$@"; do
  case "$arg" in
    --prepare) prepare=1 ;;
    --database) database=1 ;;
    *) echo "cloud-dev: unknown option $arg" >&2; exit 2 ;;
  esac
done
if [ "$database" = 1 ] && [ "$prepare" = 0 ]; then
  echo "cloud-dev: --database goes with --prepare" >&2
  exit 2
fi

env_file="${CLAUDE_ENV_FILE:-}"
# The same exports for a shell the session did not start (run by hand).
shell_env="$HOME/.carbon/cloud-dev.env"
mkdir -p "$HOME/.carbon"
: > "$shell_env"
persist() {
  # Export for this script and, when Claude Code gives us its env file, for
  # every later command of the session.
  export "$1=$2"
  printf 'export %s=%q\n' "$1" "$2" >> "$shell_env"
  if [ -n "$env_file" ]; then
    printf 'export %s=%q\n' "$1" "$2" >> "$env_file"
  fi
}
# Run by hand, nothing passes the exports on to the caller's shell.
env_hint() {
  [ -n "$env_file" ] || echo "cloud-dev: for this shell's PATH and settings: source $shell_env"
}

# --- 1. Node 24.22.1+ (what packages/dev/bin/crbn requires) --------------------
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  printf '%s\n' "24.22.1" "$(node -v | sed 's/^v//')" | sort -V -C
}
if ! node_ok; then
  for candidate in /opt/node24/bin "$HOME/.nvm/versions/node"/v24*/bin; do
    if [ -x "$candidate/node" ] &&
       printf '%s\n' "24.22.1" "$("$candidate/node" -v | sed 's/^v//')" | sort -V -C; then
      persist PATH "$candidate:$PATH"
      break
    fi
  done
fi
if ! node_ok; then
  echo "cloud-dev: Node 24.22.1+ is required and none was found (see .nvmrc)" >&2
  exit 1
fi

# Global agent-browser installs need a bin directory on PATH.
persist PNPM_HOME "${PNPM_HOME:-$HOME/.local/share/pnpm}"
mkdir -p "$PNPM_HOME"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) persist PATH "$PNPM_HOME:$PATH" ;;
esac

# No login bot check: a local stack uses Cloudflare's Turnstile test keys, and
# the bypass login and agent-browser must post the form without that widget
# (the container's proxy may not reach challenges.cloudflare.com at all).
persist BOT_PROTECTION none
# The container-only steps of crbn up (see the header).
persist CARBON_DEV_CLOUD 1

# agent-browser's Chrome (step 4), set whether or not the CLI is installed yet,
# so a session that installs it later finds Chrome.
for chrome in "${AGENT_BROWSER_EXECUTABLE_PATH:-}" "${CHROME_PATH:-}" /usr/bin/google-chrome /usr/bin/chromium /opt/pw-browsers/chromium/chrome; do
  if [ -n "$chrome" ] && [ -x "$chrome" ]; then
    persist AGENT_BROWSER_EXECUTABLE_PATH "$chrome"
    break
  fi
done

# --- 2. Dependencies -----------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "cloud-dev: installing dependencies"
  corepack enable >/dev/null 2>&1 || true
  pnpm install --prefer-offline
fi

# --- Images (--prepare only) ---------------------------------------------------
pull_images() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "cloud-dev: docker is not installed; no images to pull"
    return 0
  fi
  # crbn's own dockerd start and image list: the images a default `crbn up`
  # boots, pulled when missing, retried while the registry throttles.
  if pnpm exec tsx --eval '
    import { ensureDockerRunning, pullDefaultImages } from "./packages/dev/src/services/compose.ts";
    ensureDockerRunning()
      .then(() => pullDefaultImages(process.cwd()))
      .then(
        () => process.exit(0),
        (e) => { console.error(`cloud-dev: ${e.message}`); process.exit(1); }
      );
  '; then
    echo "cloud-dev: stack images are present"
  else
    echo "cloud-dev: some images did not pull; crbn up will pull them" >&2
  fi
}

# Sign in as the dev bypass user and open the app, so the service router and
# the app shell are compiled before the first real request. The login page
# must already answer.
warm_app() {
  local jar url ok=1
  jar=$(mktemp)
  curl -sf -o /dev/null -c "$jar" -b "$jar" --max-time 600 \
    -d email=test@carbon.ms http://localhost:3000/login &&
    url=$(curl -sf -o /dev/null -L -w '%{url_effective}' -c "$jar" -b "$jar" \
      --max-time 600 http://localhost:3000/x) &&
    [[ $url != */login* ]] && ok=0
  rm -f "$jar"
  return "$ok"
}
export -f warm_app

crbn_up_running() {
  # This checkout's crbn up, not another worktree's: compare working
  # directories. Node only: a shell whose command line merely mentions it
  # (a pgrep loop) is not one.
  local pid
  for pid in $(pgrep -f "packages/dev/src/main.ts up" 2>/dev/null); do
    [ "$(basename "$(readlink "/proc/$pid/exe" 2>/dev/null)")" = node ] &&
      [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$(pwd -P)" ] && return 0
  done
  return 1
}

# Boot the stack once, end to end: the services migrate and seed the database,
# the ERP dev server pre-bundles its dependencies, and the login page and the
# app shell are served. Then stop everything, keeping the volumes and Vite's
# cache. A failure is not fatal: the first real boot does the same work.
bake_database() {
  # A stack this checkout already runs would answer the probes below.
  if crbn_up_running; then
    echo "cloud-dev: stopping the running crbn up first"
    packages/dev/bin/crbn down || true
  fi
  echo "cloud-dev: booting the stack once to migrate and seed the database and warm Vite"
  local log="$HOME/.carbon/logs/bake.log" pid ok=0 started=$SECONDS
  mkdir -p "$HOME/.carbon/logs"
  CARBON_DEV_APPS=erp CARBON_DEV_YES=1 packages/dev/bin/crbn up --no-portless --no-regen \
    >"$log" 2>&1 < /dev/null &
  pid=$!
  # The login page waits for the database phase, so it answers when all of it is done.
  until curl -sf -o /dev/null --max-time 120 http://localhost:3000/login; do
    if ! kill -0 "$pid" 2>/dev/null || [ $((SECONDS - started)) -gt 900 ]; then break; fi
    sleep 2
  done
  warm_app && ok=1
  # Ctrl+C for crbn: it stops the dev server and the containers. A background
  # job of a script may have SIGINT ignored, so fall back to TERM and KILL.
  kill -INT "$pid" 2>/dev/null || true
  for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 3
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    # crbn up did not run its teardown: stop the containers and its dev servers.
    packages/dev/bin/crbn down || true
  fi
  wait "$pid" 2>/dev/null || true
  if [ "$ok" = 1 ]; then
    echo "cloud-dev: database migrated and seeded, Vite warmed"
  else
    echo "cloud-dev: the bake failed (see $log); the first boot will do the work instead" >&2
    return 1
  fi
}

if [ "$prepare" = 1 ]; then
  if ! command -v agent-browser >/dev/null 2>&1; then
    echo "cloud-dev: installing agent-browser $AGENT_BROWSER_VERSION"
    pnpm add --global "agent-browser@$AGENT_BROWSER_VERSION" ||
      echo "cloud-dev: agent-browser did not install; the UI skills will not run" >&2
  fi
  pull_images
  if [ "$database" = 0 ]; then
    echo "cloud-dev: environment prepared (dependencies and images); no stack started"
  elif bake_database; then
    echo "cloud-dev: environment prepared (dependencies, images, database and Vite cache); no dev server left running"
  else
    echo "cloud-dev: environment prepared (dependencies and images; no database or Vite cache)"
    env_hint
    exit 1
  fi
  env_hint
  exit 0
fi

# --- 3. The stack, detached ----------------------------------------------------
mkdir -p "$HOME/.carbon/logs"
log="$HOME/.carbon/logs/crbn-up.log"
if crbn_up_running; then
  echo "cloud-dev: crbn up is already running (log: $log)"
else
  echo "cloud-dev: starting the dev stack in the background (log: $log)"
  # Every log line starts with the seconds since this boot began, so a session
  # can read where the time went. A second loop asks for the login page until
  # it is served and logs that as the boot's total (the request waits for the
  # database phase, so it is the time a user would wait).
  CARBON_DEV_APPS="${CARBON_DEV_APPS:-erp}" CARBON_DEV_YES=1 \
    setsid nohup bash -c '
      start=$SECONDS
      stamp() { while IFS= read -r line; do printf "[%4ds] %s\n" $((SECONDS - start)) "$line"; done; }
      {
        echo "cloud-dev: boot started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        packages/dev/bin/crbn up --no-portless --no-regen &
        crbn=$!
        (
          until curl -sf -o /dev/null --max-time 600 http://localhost:3000/login; do
            # A failed boot must not leave this loop polling: it would write into
            # the log of the next boot.
            if ! kill -0 "$crbn" 2>/dev/null; then
              echo "cloud-dev: crbn up exited before the login page was served"
              exit 0
            fi
            [ $((SECONDS - start)) -gt 1800 ] && { echo "cloud-dev: no login page after 30 min"; exit 0; }
            sleep 2
          done
          echo "cloud-dev: first page served (GET /login)"
          if warm_app; then
            echo "cloud-dev: app page served (GET /x as test@carbon.ms)"
          else
            echo "cloud-dev: could not open /x as test@carbon.ms"
          fi
        ) &
        wait "$crbn"
        echo "cloud-dev: crbn up exited with status $?"
      } 2>&1 | stamp
    ' >"$log" 2>&1 < /dev/null &
fi

# --- 4. agent-browser (the /auth, /test and /smoke-test skills) ----------------
if ! command -v agent-browser >/dev/null 2>&1; then
  # In the background: the stack takes minutes to come up, the install seconds.
  echo "cloud-dev: installing agent-browser $AGENT_BROWSER_VERSION in the background (log: $HOME/.carbon/logs/agent-browser-install.log)"
  setsid nohup pnpm add --global "agent-browser@$AGENT_BROWSER_VERSION" \
    >"$HOME/.carbon/logs/agent-browser-install.log" 2>&1 < /dev/null &
fi

cat <<MSG
cloud-dev: the ERP will answer on http://localhost:3000 once the stack is up
  (a cold boot takes 2-6 minutes; once the dev server listens, about 40 s in,
  a request waits for the database instead of failing).
  Sign in as test@carbon.ms — no magic link, no bot check.
  Progress: tail -f $log   State: packages/dev/bin/crbn status
MSG
env_hint

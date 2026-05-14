#!/usr/bin/env bash
# Idempotent one-time setup: adds <repo>/packages/dev/bin to PATH and installs
# the `crbn()` shell function (so `crbn go <branch>` can mutate the caller's
# cwd).
#
# Run from the repo root:
#     ./setup.sh                # install
#     source ./setup.sh         # install + activate in current shell
#     ./setup.sh --uninstall    # remove
#
# When sourced we delegate to a child process for the actual install, then
# source the rc back in the caller. This keeps `set -e`/`exit` from leaking
# into the user's interactive shell (which closes the tab on the first
# expected non-zero exit, e.g. when re-running on an already-installed rc).

# ---------------------------------------------------------------------------
# Sourced detection (bash + zsh)
# ---------------------------------------------------------------------------

__crbn_setup_sourced=0
if [[ -n "${BASH_SOURCE[0]:-}" && "${BASH_SOURCE[0]}" != "${0:-}" ]]; then
  __crbn_setup_sourced=1
fi
if [[ -n "${ZSH_EVAL_CONTEXT:-}" && "$ZSH_EVAL_CONTEXT" == *:file* ]]; then
  __crbn_setup_sourced=1
fi

# When sourced: spawn child to install (no option/exit leakage), then source
# the rc into THIS shell so PATH + crbn() take effect immediately.
if (( __crbn_setup_sourced )); then
  # In bash: BASH_SOURCE[0] is the sourced file. In zsh: $0 is the sourced
  # file (when FUNCTION_ARGZERO is set, the default).
  __crbn_setup_script="${BASH_SOURCE[0]:-$0}"

  bash "$__crbn_setup_script" "$@"; __crbn_setup_rc=$?
  if (( __crbn_setup_rc != 0 )); then
    unset __crbn_setup_sourced __crbn_setup_script __crbn_setup_rc
    return "$__crbn_setup_rc" 2>/dev/null
  fi

  # Activate in the current shell only on install paths (not --uninstall/help).
  case "${1:-}" in
    ""|install)
      __crbn_setup_target="${RC_FILE:-}"
      if [[ -z "$__crbn_setup_target" ]]; then
        case "${SHELL:-}" in
          */zsh)  __crbn_setup_target="$HOME/.zshrc"  ;;
          */bash) __crbn_setup_target="$HOME/.bashrc" ;;
          *)
            if   [[ -f "$HOME/.zshrc"  ]]; then __crbn_setup_target="$HOME/.zshrc"
            elif [[ -f "$HOME/.bashrc" ]]; then __crbn_setup_target="$HOME/.bashrc"
            else __crbn_setup_target="$HOME/.zshrc"
            fi
            ;;
        esac
      fi
      if [[ -f "$__crbn_setup_target" ]] && grep -qF "# >>> carbon dev cli (managed by setup.sh) >>>" "$__crbn_setup_target"; then
        # shellcheck disable=SC1090
        source "$__crbn_setup_target"
        printf '\n  \033[1;36mcrbn\033[0m active in this shell. try: \033[1;36mcrbn\033[0m\n\n'
      fi
      unset __crbn_setup_target
      ;;
  esac

  unset __crbn_setup_sourced __crbn_setup_script __crbn_setup_rc
  return 0 2>/dev/null
fi

# ---------------------------------------------------------------------------
# Direct invocation: real work happens here.
# ---------------------------------------------------------------------------

set -euo pipefail

SENTINEL_OPEN="# >>> carbon dev cli (managed by setup.sh) >>>"
SENTINEL_CLOSE="# <<< carbon dev cli <<<"

# Output helpers — colors when stdout is a TTY.
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  C_BOLD=$(tput bold); C_DIM=$(tput dim); C_RESET=$(tput sgr0)
  C_GREEN=$(tput setaf 2); C_YELLOW=$(tput setaf 3); C_CYAN=$(tput setaf 6); C_RED=$(tput setaf 1)
else
  C_BOLD=""; C_DIM=""; C_RESET=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_RED=""
fi

ok()    { printf '%s✓%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
info()  { printf '%s•%s %s\n' "$C_CYAN"   "$C_RESET" "$*"; }
warn()  { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail()  { printf '%s✗%s %s\n' "$C_RED"    "$C_RESET" "$*" >&2; }
hdr()   { printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
kbd()   { printf '%s%s%s' "$C_BOLD$C_CYAN" "$*" "$C_RESET"; }
dim()   { printf '%s%s%s' "$C_DIM" "$*" "$C_RESET"; }

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null \
    || { fail "not inside a git repo (cd into the carbon checkout first)"; exit 1; }
}

to_shell_path() {
  local path="$1"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      if command -v cygpath >/dev/null 2>&1; then
        cygpath -u "$path"
      else
        printf '%s\n' "$path"
      fi
      ;;
    *)
      printf '%s\n' "$path"
      ;;
  esac
}

detect_rc() {
  if [[ -n "${RC_FILE:-}" ]]; then printf '%s\n' "$RC_FILE"; return; fi
  case "${SHELL:-}" in
    */zsh)  printf '%s\n' "$HOME/.zshrc" ;;
    */bash) printf '%s\n' "$HOME/.bashrc" ;;
    *)
      if   [[ -f "$HOME/.zshrc"  ]]; then printf '%s\n' "$HOME/.zshrc"
      elif [[ -f "$HOME/.bashrc" ]]; then printf '%s\n' "$HOME/.bashrc"
      else printf '%s\n' "$HOME/.zshrc"
      fi
      ;;
  esac
}

block_for() {
  local repo="$1"
  local shell="$2"
  cat <<EOF
$SENTINEL_OPEN
export PATH="$repo/packages/dev/bin:\$PATH"
crbn() {
  # Wrap \`checkout\` so the trailing \`cd '<path>'\` on stdout becomes an
  # actual cd in the caller's shell. \`--up\` execs into \`crbn up\` and would
  # clobber the captured stdout, so bypass capture there.
  if [[ "\${1:-}" == "checkout" ]]; then
    local arg
    for arg in "\$@"; do
      if [[ "\$arg" == "--up" ]]; then
        command crbn "\$@"
        return \$?
      fi
    done
    local out
    out="\$(command crbn "\$@")" || return \$?
    [[ -n "\$out" ]] && eval "\$out"
  else
    command crbn "\$@"
  fi
}
# Tab completion (generated by \`crbn complete $shell\`).
if command -v crbn >/dev/null 2>&1; then
  source <(crbn complete $shell 2>/dev/null) || true
fi
$SENTINEL_CLOSE
EOF
}

uninstall() {
  local rc; rc="$(detect_rc)"
  hdr "Uninstall"
  if [[ ! -f "$rc" ]]; then info "no rc file at $(dim "$rc") — nothing to do";
  elif ! grep -qF "$SENTINEL_OPEN" "$rc"; then
    info "no crbn block found in $(dim "$rc") — nothing to do"
  else
    local tmp; tmp="$(mktemp)"
    awk -v sopen="$SENTINEL_OPEN" -v sclose="$SENTINEL_CLOSE" '
      $0 == sopen { skip=1; next }
      skip && $0 == sclose { skip=0; next }
      !skip
    ' "$rc" > "$tmp"
    mv "$tmp" "$rc"
    ok "removed crbn block from $(dim "$rc")"
    info "open a new shell to clear PATH and the crbn() function"
  fi

  uninstall_proxy_daemon
}

LAUNCHD_PLIST="/Library/LaunchDaemons/dev.portless.proxy.plist"

# Install portless globally. Prefer pnpm, fall back to npm. Surface pnpm's
# missing-global-bin-dir hint the CLI does in packages/dev/src/services/portless.ts
# so the user gets the same actionable error in both entry points.
install_portless_global() {
  hdr "Installing portless"
  info "Required for *.dev hostname routing on :443."

  if command -v pnpm >/dev/null 2>&1; then
    local out
    if out=$(pnpm add -g portless@latest 2>&1); then
      ok "portless installed via pnpm"
      return 0
    fi
    if grep -q "ERR_PNPM_NO_GLOBAL_BIN_DIR" <<<"$out"; then
      warn "pnpm has no global bin dir configured. Run \`pnpm setup\`, open a new shell, then re-run \`./setup.sh\`."
      printf '%s\n' "$out" >&2
      return 1
    fi
    printf '%s\n' "$out" >&2
    warn "pnpm install failed — falling back to npm"
  fi

  if command -v npm >/dev/null 2>&1; then
    if npm install -g portless@latest; then
      ok "portless installed via npm"
      return 0
    fi
    fail "npm install -g portless@latest failed"
    return 1
  fi

  fail "no pnpm or npm on PATH — install one of them and re-run"
  return 1
}

# Install portless as a LaunchDaemon (macOS) so the :443 proxy starts at boot
# and crash-restarts. Sidesteps the per-`crbn up` sudo prompt cycle for
# `proxy start` (writing /etc/hosts via `portless hosts sync` still needs
# sudo on first run only — our CLI skips it when hosts are already in sync).
install_proxy_daemon() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    info "non-macOS — skipping LaunchDaemon install"
    return 0
  fi

  if [[ -f "$LAUNCHD_PLIST" ]]; then
    info "LaunchDaemon already installed at $(dim "$LAUNCHD_PLIST")"
    return 0
  fi

  local portless_bin
  portless_bin="$(command -v portless || true)"
  if [[ -z "$portless_bin" ]]; then
    install_portless_global
    portless_bin="$(command -v portless || true)"
    if [[ -z "$portless_bin" ]]; then
      warn "portless still not on PATH after install attempt — skipping boot-start. Install manually, then re-run \`./setup.sh\`."
      return 0
    fi
  fi

  hdr "Boot-start portless proxy"
  info "Installs $(dim "$LAUNCHD_PLIST") so :443 survives reboots."
  info "One sudo prompt now, none on every \`crbn up\` after that."
  printf '\n  %s\n' "$(kbd "ctrl-c to skip")"
  read -r -p "  press enter to continue " _

  local plist_tmp
  plist_tmp="$(mktemp)"
  cat > "$plist_tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.portless.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>$portless_bin</string>
    <string>proxy</string>
    <string>start</string>
    <string>--foreground</string>
    <string>--port</string>
    <string>443</string>
    <string>--https</string>
    <string>--tld</string>
    <string>dev</string>
    <string>--skip-trust</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/portless.out.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/portless.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>$(dirname "$portless_bin"):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF

  # Stop any current foreground/daemon proxy first so the LaunchDaemon can
  # bind :443 cleanly. Ignore errors — proxy may not be running.
  sudo "HOME=$HOME" portless proxy stop >/dev/null 2>&1 || true

  if ! sudo install -m 644 -o root -g wheel "$plist_tmp" "$LAUNCHD_PLIST"; then
    rm -f "$plist_tmp"
    fail "failed to write $LAUNCHD_PLIST"
    return 1
  fi
  rm -f "$plist_tmp"

  if ! sudo launchctl bootstrap system "$LAUNCHD_PLIST"; then
    fail "launchctl bootstrap failed — proxy may still be running; check \`sudo launchctl print system/dev.portless.proxy\`"
    return 1
  fi

  ok "portless LaunchDaemon installed; proxy starts at boot"

  run_portless_trust
}

# LaunchDaemon plist runs with --skip-trust, and the CLI's ensureProxyPrivileges
# only triggers trust as a side-effect of fixing a privilege issue — neither
# path runs trust on its own. Users who pre-installed portless never end up
# with the CA in their keychain, so *.dev TLS fails in the browser.
# `portless trust` is idempotent.
run_portless_trust() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi
  hdr "Trust portless CA"
  info "Installs root CA into system keychain so *.dev TLS is trusted."
  if ! sudo "HOME=$HOME" portless trust; then
    warn "portless trust failed — browsers may show cert warnings until you run \`sudo portless trust\` manually."
    return 0
  fi
  ok "portless CA trusted"
}

uninstall_proxy_daemon() {
  if [[ "$(uname -s)" != "Darwin" ]] || [[ ! -f "$LAUNCHD_PLIST" ]]; then
    return 0
  fi
  info "removing LaunchDaemon"
  sudo launchctl bootout "system/dev.portless.proxy" 2>/dev/null || true
  sudo rm -f "$LAUNCHD_PLIST"
  ok "LaunchDaemon removed"
}

install() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Linux*|Darwin*) ;;
    *)
      fail "Unsupported environment: $(uname -s). crbn requires WSL or Git Bash on Windows; macOS/Linux otherwise."
      exit 1
      ;;
  esac

  local repo repo_shell rc
  repo="$(repo_root)"
  repo_shell="$(to_shell_path "$repo")"
  rc="$(detect_rc)"
  mkdir -p "$(dirname "$rc")"
  touch "$rc"

  hdr "Install"
  info "repo: $(dim "$repo")"
  info "rc:   $(dim "$rc")"

  local refreshed=0
  if grep -qF "$SENTINEL_OPEN" "$rc"; then
    # Strip the existing managed block so we can rewrite it. Lets users pull
    # newer setup.sh and re-run install to refresh wrapper logic without an
    # explicit --uninstall step.
    local tmp; tmp="$(mktemp)"
    awk -v sopen="$SENTINEL_OPEN" -v sclose="$SENTINEL_CLOSE" '
      $0 == sopen { skip=1; next }
      skip && $0 == sclose { skip=0; next }
      !skip
    ' "$rc" > "$tmp"
    mv "$tmp" "$rc"
    refreshed=1
  fi

  local shell="zsh"
  case "${SHELL:-}" in
    */bash) shell="bash" ;;
    */fish) shell="fish" ;;
  esac

  {
    printf '\n'
    block_for "$repo_shell" "$shell"
    printf '\n'
  } >> "$rc"

  if (( refreshed )); then
    ok "refreshed crbn block in $rc"
  else
    ok "appended crbn block to $rc"
  fi

  install_proxy_daemon || true

  hdr "Activate"
  printf '  Open a new shell, or run:\n\n'
  printf '      %s\n\n' "$(kbd "source $rc")"
  printf '  Or activate without re-running setup:\n\n'
  printf '      %s\n' "$(kbd "source ./setup.sh")"

  hdr "Verify"
  printf '  %s\n' "$(dim "which crbn   # -> $repo_shell/packages/dev/bin/crbn")"
  printf '  %s\n\n' "$(dim "crbn         # -> help")"
}

case "${1:-}" in
  ""|install) install ;;
  --uninstall|uninstall) uninstall ;;
  -h|--help)
    cat <<'USAGE'
Usage:
  ./setup.sh                  install crbn into your shell rc
  source ./setup.sh           install AND activate in the current shell
  ./setup.sh --uninstall      remove the managed block
  RC_FILE=/path/to/rc ./setup.sh    override target rc file
USAGE
    ;;
  *)
    fail "unknown arg '$1'"
    exit 2
    ;;
esac

#!/usr/bin/env bash
# install-skills.sh — Symlink .ai/ rules and skills into AI tool harnesses
#
# Source of truth: .ai/rules/ and .ai/skills/
# Targets: .claude/ (Claude Code) and .codex/ (Codex/OpenAI)
#
# Runs automatically via `pnpm prepare` or manually: `pnpm install-skills`
#
# Usage:
#   install-skills.sh                     # default tiers + all rules
#   install-skills.sh --with <tiers>      # default + extra tiers (comma-separated)
#   install-skills.sh --all               # all tiers + all rules
#   install-skills.sh --skills-only       # skills only (no rules)
#   install-skills.sh --rules-only        # rules only (no skills)
#   install-skills.sh --list              # show tier catalog
#   install-skills.sh --clean             # remove all symlinks
#   install-skills.sh --help              # show usage

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AI_DIR="$REPO_ROOT/.ai"
TIERS_JSON="$AI_DIR/skills/tiers.json"

INSTALL_RULES=true
INSTALL_SKILLS=true
MODE=""        # "" = default tiers, "with" = default + extra, "all" = everything
EXTRA_TIERS=""
CLEAN=false
LIST=false

# ── Parse args ───────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --skills-only)  INSTALL_RULES=false;  shift ;;
    --rules-only)   INSTALL_SKILLS=false; shift ;;
    --all)          MODE="all";           shift ;;
    --clean)        CLEAN=true;           shift ;;
    --list)         LIST=true;            shift ;;
    --with)
      MODE="with"
      shift
      EXTRA_TIERS="${1:-}"
      [ -n "$EXTRA_TIERS" ] || { echo "error: --with requires tier names" >&2; exit 1; }
      shift
      ;;
    --help|-h)
      sed -n '2,/^$/{ s/^# //; s/^#//; p; }' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────

prepare_harness() {
  local dir="$1"
  mkdir -p "$dir"
  find "$dir" -maxdepth 1 -type l -delete 2>/dev/null || true
}

link_rules() {
  local harness_dir="$1/rules"
  prepare_harness "$harness_dir"

  local count=0
  local rel_prefix
  # Calculate relative path from harness rules dir to .ai/rules
  rel_prefix="$(python3 -c "import os; print(os.path.relpath('$AI_DIR/rules', '$harness_dir'))" 2>/dev/null || echo "../../.ai/rules")"

  for rule in "$AI_DIR"/rules/*.md; do
    [ -f "$rule" ] || continue
    local name
    name=$(basename "$rule")
    ln -sfn "$rel_prefix/$name" "$harness_dir/$name"
    count=$((count + 1))
  done

  local harness_name
  harness_name=$(basename "$1")
  echo "  ✓ $count rules → .$harness_name/rules/"
}

link_skills() {
  local harness_dir="$1/skills"
  local skills_list="$2"  # newline-separated skill names, or "ALL"
  prepare_harness "$harness_dir"

  local count=0
  local rel_prefix
  rel_prefix="$(python3 -c "import os; print(os.path.relpath('$AI_DIR/skills', '$harness_dir'))" 2>/dev/null || echo "../../.ai/skills")"

  for skill_dir in "$AI_DIR"/skills/*/; do
    [ -d "$skill_dir" ] || continue
    local name
    name=$(basename "$skill_dir")
    [ -f "$skill_dir/SKILL.md" ] || continue

    # Filter by tier if not ALL
    if [ "$skills_list" != "ALL" ]; then
      echo "$skills_list" | grep -qx "$name" || continue
    fi

    ln -sfn "$rel_prefix/$name" "$harness_dir/$name"
    count=$((count + 1))
  done

  local harness_name
  harness_name=$(basename "$1")
  echo "  ✓ $count skills → .$harness_name/skills/"
}

# ── Tier resolution ──────────────────────────────────────────────────────────

resolve_skills() {
  # If no tiers.json, install all skills
  if [ ! -f "$TIERS_JSON" ]; then
    echo "ALL"
    return
  fi

  local selected_tiers=""

  case "$MODE" in
    "all")
      # All tiers
      selected_tiers=$(python3 -c "
import json, sys
d = json.load(open('$TIERS_JSON'))
for t in d.get('tiers', {}):
    print(t)
" 2>/dev/null) || { echo "ALL"; return; }
      ;;
    "with")
      # Default + extra
      selected_tiers=$(python3 -c "
import json, sys
d = json.load(open('$TIERS_JSON'))
defaults = d.get('default', [])
extras = '$EXTRA_TIERS'.split(',')
for t in set(defaults + extras):
    if t in d.get('tiers', {}):
        print(t)
    else:
        print(f'warning: unknown tier \"{t}\"', file=sys.stderr)
" 2>/dev/null) || { echo "ALL"; return; }
      ;;
    *)
      # Default tiers only
      selected_tiers=$(python3 -c "
import json
d = json.load(open('$TIERS_JSON'))
for t in d.get('default', []):
    print(t)
" 2>/dev/null) || { echo "ALL"; return; }
      ;;
  esac

  # Collect skill names from selected tiers
  local skills=""
  skills=$(python3 -c "
import json, sys
d = json.load(open('$TIERS_JSON'))
tiers = sys.stdin.read().strip().split('\n')
seen = set()
for t in tiers:
    for s in d.get('tiers', {}).get(t, {}).get('skills', []):
        if s not in seen:
            seen.add(s)
            print(s)
" <<< "$selected_tiers" 2>/dev/null) || { echo "ALL"; return; }

  if [ -z "$skills" ]; then
    echo "ALL"
  else
    echo "$skills"
  fi
}

# ── List mode ────────────────────────────────────────────────────────────────

if $LIST; then
  if [ ! -f "$TIERS_JSON" ]; then
    echo "No tiers.json found — all skills install by default."
    echo ""
    echo "Skills:"
    for s in "$AI_DIR"/skills/*/; do
      [ -f "$s/SKILL.md" ] || continue
      echo "  $(basename "$s")"
    done
  else
    python3 -c "
import json
d = json.load(open('$TIERS_JSON'))
defaults = set(d.get('default', []))
for tier, info in d.get('tiers', {}).items():
    marker = ' (default)' if tier in defaults else ''
    desc = info.get('description', '')
    print(f'\n{tier}{marker}: {desc}')
    for s in info.get('skills', []):
        print(f'  {s}')
" 2>/dev/null || echo "error: could not parse tiers.json" >&2
  fi
  exit 0
fi

# ── Clean mode ───────────────────────────────────────────────────────────────

if $CLEAN; then
  for harness in "$REPO_ROOT/.claude" "$REPO_ROOT/.codex"; do
    if [ -d "$harness/rules" ]; then
      find "$harness/rules" -maxdepth 1 -type l -delete 2>/dev/null || true
      echo "  ✓ Cleaned $(basename "$harness")/rules/"
    fi
    if [ -d "$harness/skills" ]; then
      find "$harness/skills" -maxdepth 1 -type l -delete 2>/dev/null || true
      echo "  ✓ Cleaned $(basename "$harness")/skills/"
    fi
  done
  exit 0
fi

# ── Install ──────────────────────────────────────────────────────────────────

echo "Installing from .ai/ →"

SKILLS_LIST=""
if $INSTALL_SKILLS; then
  SKILLS_LIST=$(resolve_skills)
fi

for harness in "$REPO_ROOT/.claude" "$REPO_ROOT/.codex"; do
  harness_name=$(basename "$harness")

  if $INSTALL_RULES; then
    link_rules "$harness"
  fi

  if $INSTALL_SKILLS; then
    link_skills "$harness" "$SKILLS_LIST"
  fi
done

echo "Done."

#!/usr/bin/env bash
# install-skills.sh — Symlink .ai/ rules and skills into AI tool harnesses
#
# Source of truth: .ai/rules/ and .ai/skills/
# Targets: .claude/ (Claude Code) and .codex/ (Codex/OpenAI)
#
# Runs automatically via `pnpm prepare` or manually: `pnpm install-skills`
#
# Usage:
#   install-skills.sh                     # install all rules + all skills
#   install-skills.sh --skills-only       # skills only (no rules)
#   install-skills.sh --rules-only        # rules only (no skills)
#   install-skills.sh --list              # show available skills
#   install-skills.sh --clean             # remove all symlinks
#   install-skills.sh --help              # show usage

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AI_DIR="$REPO_ROOT/.ai"

INSTALL_RULES=true
INSTALL_SKILLS=true
CLEAN=false
LIST=false

# ── Parse args ───────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --skills-only)  INSTALL_RULES=false;  shift ;;
    --rules-only)   INSTALL_SKILLS=false; shift ;;
    --clean)        CLEAN=true;           shift ;;
    --list)         LIST=true;            shift ;;
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
  prepare_harness "$harness_dir"

  local count=0
  local rel_prefix
  rel_prefix="$(python3 -c "import os; print(os.path.relpath('$AI_DIR/skills', '$harness_dir'))" 2>/dev/null || echo "../../.ai/skills")"

  for skill_dir in "$AI_DIR"/skills/*/; do
    [ -d "$skill_dir" ] || continue
    local name
    name=$(basename "$skill_dir")
    [ -f "$skill_dir/SKILL.md" ] || continue

    # Guard: frontmatter must start on line 1 and its name must match the dir.
    # (A comment above the frontmatter breaks description parsing in harnesses.)
    if [ "$(head -n 1 "$skill_dir/SKILL.md")" != "---" ]; then
      echo "  ⚠ $name: SKILL.md does not start with '---' frontmatter on line 1" >&2
    else
      local fm_name
      fm_name=$(sed -n '2,10s/^name:[[:space:]]*//p' "$skill_dir/SKILL.md" | head -n 1)
      if [ -n "$fm_name" ] && [ "$fm_name" != "$name" ]; then
        echo "  ⚠ $name: frontmatter name '$fm_name' does not match directory name" >&2
      fi
    fi

    ln -sfn "$rel_prefix/$name" "$harness_dir/$name"
    count=$((count + 1))
  done

  local harness_name
  harness_name=$(basename "$1")
  echo "  ✓ $count skills → .$harness_name/skills/"
}

# ── List mode ────────────────────────────────────────────────────────────────

if $LIST; then
  echo "Skills:"
  for s in "$AI_DIR"/skills/*/; do
    [ -f "$s/SKILL.md" ] || continue
    echo "  $(basename "$s")"
  done
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

for harness in "$REPO_ROOT/.claude" "$REPO_ROOT/.codex"; do
  if $INSTALL_RULES; then
    link_rules "$harness"
  fi

  if $INSTALL_SKILLS; then
    link_skills "$harness"
  fi
done

echo "Done."

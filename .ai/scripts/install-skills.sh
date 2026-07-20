#!/usr/bin/env bash
# install-skills.sh — Copy rules and skills into other AI tool harnesses
#
# Source of truth: .claude/rules/ and .claude/skills/ (tracked in git)
# Targets: .codex/ (Codex/OpenAI) — regenerated copies, gitignored
#
# Runs automatically via `pnpm prepare` or manually: `pnpm install-skills`
#
# Usage:
#   install-skills.sh                     # install all rules + all skills
#   install-skills.sh --skills-only       # skills only (no rules)
#   install-skills.sh --rules-only        # rules only (no skills)
#   install-skills.sh --list              # show available skills
#   install-skills.sh --clean             # remove all copied harness dirs
#   install-skills.sh --help              # show usage

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_DIR="$REPO_ROOT/.claude"

# Harnesses to generate from the .claude/ source of truth.
TARGETS=("$REPO_ROOT/.codex")

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

copy_tree() {
  local src="$1"      # .claude/rules or .claude/skills
  local dest="$2"     # .codex/rules or .codex/skills
  local label="$3"    # "rules" or "skills"
  local harness_name="$4"

  rm -rf "$dest"
  mkdir -p "$dest"

  local count=0
  if [ "$label" = "rules" ]; then
    for rule in "$src"/*.md; do
      [ -f "$rule" ] || continue
      cp "$rule" "$dest/$(basename "$rule")"
      count=$((count + 1))
    done
  else
    for skill_dir in "$src"/*/; do
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

      cp -R "$skill_dir" "$dest/$name"
      count=$((count + 1))
    done
  fi

  echo "  ✓ $count $label → $harness_name/$label/"
}

# ── List mode ────────────────────────────────────────────────────────────────

if $LIST; then
  echo "Skills:"
  for s in "$SOURCE_DIR"/skills/*/; do
    [ -f "$s/SKILL.md" ] || continue
    echo "  $(basename "$s")"
  done
  exit 0
fi

# ── Clean mode ───────────────────────────────────────────────────────────────

if $CLEAN; then
  for harness in "${TARGETS[@]}"; do
    for label in rules skills; do
      if [ -d "$harness/$label" ]; then
        rm -rf "$harness/$label"
        echo "  ✓ Cleaned $(basename "$harness")/$label/"
      fi
    done
  done
  exit 0
fi

# ── Install ──────────────────────────────────────────────────────────────────

echo "Installing from .claude/ →"

for harness in "${TARGETS[@]}"; do
  harness_name=$(basename "$harness")
  if $INSTALL_RULES; then
    copy_tree "$SOURCE_DIR/rules" "$harness/rules" "rules" "$harness_name"
  fi
  if $INSTALL_SKILLS; then
    copy_tree "$SOURCE_DIR/skills" "$harness/skills" "skills" "$harness_name"
  fi
done

echo "Done."

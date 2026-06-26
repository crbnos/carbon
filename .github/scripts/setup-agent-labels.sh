#!/usr/bin/env bash
#
# Create/update the agent:* labels the outer loop (the OpenClaw orchestrator,
# acting as the `carbon-agent` machine user) drives. These are the GitHub-side
# state machine for autonomous work — see llm/outer-loop/01-openclaw-plan.md §4.
#
# Idempotent: `gh label create --force` updates an existing label's color and
# description instead of erroring, so this is safe to re-run.
#
# Usage:
#   .github/scripts/setup-agent-labels.sh [owner/repo]
# Defaults to the current repo. Requires `gh` authenticated with issues:write.
set -euo pipefail

REPO="${1:-}"
repo_arg=()
[ -n "$REPO" ] && repo_arg=(--repo "$REPO")

create() {
  gh label create "$1" --color "$2" --description "$3" --force "${repo_arg[@]}"
}

# name                         color    description
create "agent:working"             "1d76db" "carbon-agent holds the lease on this issue (a loop is in flight)"
create "agent:needs-grooming"      "fbca04" "Candidate for the agent groomer to flesh into a buildable spec"
create "agent:groomed"             "0e8a16" "Spec + acceptance criteria proposed by the agent; safe to assign to carbon-agent"
create "agent:needs-decomposition" "d93f0b" "Epic-sized; the agent proposed a breakdown — needs a human to split"
create "agent:blocked"             "b60205" "The loop returned blocked/error, or binding synthesis refused — needs a human"

echo "agent:* labels synced."

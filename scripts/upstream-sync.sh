#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
TRUNK_BRANCH="${TRUNK_BRANCH:-trunk}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"

git fetch "$UPSTREAM_REMOTE" --prune --tags

# Refresh trunk from upstream
if git show-ref --verify --quiet "refs/heads/$TRUNK_BRANCH"; then
  git switch "$TRUNK_BRANCH"
  git reset --hard "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
else
  git switch -c "$TRUNK_BRANCH" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
fi

# Rebase your main on top of fresh trunk
git switch "$MAIN_BRANCH"
git rebase "$TRUNK_BRANCH"

# Push if fast-forward or after rebase
git push origin "$MAIN_BRANCH" --force-with-lease
echo "✔ Synced: $MAIN_BRANCH on top of $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"

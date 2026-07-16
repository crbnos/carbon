# Task: Rebase loop/1031 onto origin/main

## Context
PR #1068 (`loop/1031` branch, accounting period close lifecycle) has merge conflicts after PRs #1084, #1085, #1086, #1087 merged into main. The branch has ~30 commits on top of the old base.

## Goal
Rebase `loop/1031` onto `origin/main` and force-push to unblock the PR.

## Steps

1. Make sure you are in /home/openclaw/carbon
2. Run `git fetch origin main`
3. Checkout the branch: `git checkout loop/1031`
4. Run `git rebase origin/main`
5. Resolve conflicts as they arise:
   - `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json` — this is a generated file. Whenever it conflicts, accept THEIRS (`git checkout --theirs <file>`) and then regenerate: `cd /home/openclaw/carbon && node -e "require('./scripts/generate-tool-metadata.js')"` if the script exists, or simply accept theirs and continue. Actually, just accept theirs for this file always.
   - Any other conflicts: use your judgment. The loop/1031 branch contains the accounting period close feature — prefer keeping that work when it conflicts with minor UX fixes from PR #1087.
6. After rebase completes with no conflicts: `git push origin loop/1031 --force-with-lease`
7. Confirm the push succeeded and the PR is no longer DIRTY/CONFLICTING.

## Important
- Do NOT run `crbn up` or start any docker builds — this is a rebase only, no building needed.
- Do NOT change the PR itself (title, description, labels). Only push the rebased branch.
- After a successful push, confirm with: `cd /home/openclaw/carbon && gh pr view 1068 --json mergeStateStatus,reviewDecision`

## Success Criteria
- `gh pr view 1068 --json mergeStateStatus` shows `"CLEAN"` or `"BLOCKED"` (not `"DIRTY"` or `"CONFLICTING"`)
- Branch pushed successfully

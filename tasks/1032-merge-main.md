# Task: Merge origin/main into loop/1032 and resolve conflicts (PR #1096)

## Context
- Working directory: /home/openclaw/carbon (currently on branch loop/1032)
- PR #1096 is CONFLICTING (DIRTY merge state) — 27 commits behind main
- All CI checks on PR #1096 are green; just needs a clean rebase/merge
- Issue: #1032 (document approvals for JEs, payments, purchase invoices, memos + SoD reporting)

## Task
1. cd /home/openclaw/carbon
2. git fetch origin main
3. git merge origin/main
4. Resolve any merge conflicts carefully:
   - For conflicts in tool-metadata.json: take the union of both sides (don't drop any tools)
   - For conflicts in migrations: keep both sides' content (they're additive)
   - For conflicts in TypeScript files: merge carefully, preserving both sets of changes
   - For conflicts in pnpm-lock.yaml: run `pnpm install` to regenerate
5. git add -A && git commit -m "Merge remote-tracking branch 'origin/main' into loop/1032"
6. git push origin loop/1032
7. Run typecheck to verify: `pnpm --filter @carbon/erp typecheck` (if it passes quickly)
   - If typecheck fails due to unrelated issues on main, note it but still push
8. After push, verify: `gh pr checks 1096 --repo crbnos/carbon` to ensure CI kicks off

## Success
- Branch pushed clean to origin
- PR #1096 no longer shows DIRTY/CONFLICTING

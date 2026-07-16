# Task Brief: PR #1098 CodeRabbit Review Feedback

## Context
PR #1098: `fix/procedure-modal-close-cancel` — "fix: procedure modal X doesn't close on direct nav; add Cancel button"

You are working in the worktree at `/home/openclaw/carbon-worktrees/loop-1098-feedback`.
The branch is `fix/procedure-modal-close-cancel`.

## Objective
Fix 3 CodeRabbit review comments on this PR. All are in doc/spec files (not runtime code). Make all 3 fixes, commit, and push.

---

## Fix 1: Escape AC references in daily notes (Minor — markdown correctness)

**File:** `.ai/daily-notes/2026-07-06.md` — line ~38

**Problem:** `AC[4][5]` and `AC[1][2][3]` are being parsed as undefined reference links by markdownlint.

**Fix:** Wrap them in backticks so they render as code spans, not links.

Find the line containing `AC[4][5]` and `AC[1][2][3]` and rewrite those tokens as `` `AC[4][5]` `` and `` `AC[1][2][3]` ``.

Current text (approximately):
```
inner loop stalled after 7 slices verifying AC[4][5] (resilient.ts structured logging — already correct) but never built health endpoint (AC[1][2][3])
```
Should become:
```
inner loop stalled after 7 slices verifying `AC[4][5]` (resilient.ts structured logging — already correct) but never built health endpoint (`AC[1][2][3]`)
```

---

## Fix 2: Escape `$periodId` in binding.loop.md verification command (Minor — shell correctness)

**File:** `.ai/runs/1031-resume/binding.loop.md` — line ~94

**Problem:** The shell command includes `periods.$periodId.close.tsx` which will cause shell expansion of `$periodId` (unset → empty string or error).

**Fix:** Escape the `$` so the literal filename is passed:

Change:
```
apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx
```
To:
```
apps/erp/app/routes/x+/accounting+/periods.\$periodId.close.tsx
```

---

## Fix 3: Make agent_chat_message_part index UNIQUE (Major — data integrity)

**File:** `.ai/specs/in-app-agent.md` — line ~143-145

**Problem:** A plain index on `("messageId", "orderIndex")` doesn't prevent duplicate positions, allowing ambiguous ordering on retries or concurrent inserts.

**Fix:** Change the plain index to a UNIQUE index:

Change:
```sql
CREATE INDEX "agent_chat_message_part_messageId_idx"
  ON "agent_chat_message_part" ("messageId", "orderIndex");
```
To:
```sql
CREATE UNIQUE INDEX "agent_chat_message_part_messageId_orderIndex_idx"
  ON "agent_chat_message_part" ("messageId", "orderIndex");
```

---

## Steps

1. `cd /home/openclaw/carbon-worktrees/loop-1098-feedback`
2. Verify you are on branch `fix/procedure-modal-close-cancel`
3. Apply all 3 fixes above to the exact files
4. Run: `git diff` to verify the changes look correct
5. Commit: `git commit -am "docs: fix CodeRabbit review comments (escape AC refs, \$periodId, unique index)"`
6. Push: `git push origin fix/procedure-modal-close-cancel`
7. Output a brief summary of what was changed and confirm push succeeded

Do NOT modify any runtime code files. Only touch the 3 doc/spec files listed.

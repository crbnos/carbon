---
name: execute
description: Execute an approved implementation plan from .ai/plans/ task by task, running each task's verification and committing per task via the check-and-commit gate. Use when asked to "execute the plan", "implement the plan", or after /plan approval. Do not use without an approved plan file — run /plan first — and do not use it to redesign; a plan gap means stop and re-plan.
---

# execute — run an implementation plan

Input: an approved plan at `.ai/plans/{date}-{slug}.md`. Output: working,
verified, committed code on the feature branch, with the plan's Progress
checklist fully checked off.

Your job is to follow the plan exactly — not to improve it. Deviations are
blockers, not judgment calls.

**Announce at start:** "Using the execute skill — implementing the plan at
{path}."

## Step 1: Load and sanity-check

1. Read the whole plan file. Confirm: you are on the branch it names, the spec
   it references exists, and its task dependencies are consistent.
2. If anything is missing or contradictory → **STOP** and report before touching
   code.

## Step 2: Per-task loop

For each unchecked task, in dependency order:

1. **Read the task** and every file it lists (including the precedent file for
   UI tasks).
2. **Do exactly the steps.** Exact paths, exact code, exact commands. If the
   task says "copy from precedent X", open X and match its structure and idiom.
3. **Run the task's Verify block** and compare against the expected output. A
   verification you didn't run counts as failed.
4. **Commit via `/check-and-commit`** (it runs the gates, stages the task's
   files specifically, and writes a conventional commit). One commit per task.
5. **Check the task off** in the plan file's Progress list.

Reminders that override anything the plan forgot:

- After any migration is applied: `pnpm run generate:types` BEFORE typechecking.
- Typecheck only per package: `pnpm exec turbo run typecheck --filter=<pkg>`.
  Never run a whole-repo typecheck.
- Never rebuild or reset the database to make a task pass — stop and report.

## Step 3: Blockers — when to STOP

Stop immediately and report (do not guess, do not improvise) when:

- A verification fails and one focused fix attempt doesn't make it pass.
- The plan has a gap: missing step, wrong path, unstated decision.
- An escape hatch condition in the plan triggers.
- You are about to touch a file the task lists as out of scope.

Report format: what happened, exact command + output, what you tried, 1–2
options if you have them. After the human resolves it, resume the loop. If the
plan itself is wrong, go back to `/plan` and update the plan file first — never
push through with an unplanned design change.

Red flags — thinking any of these means you are improvising; STOP instead:

- "the plan is close enough, I'll adapt this step"
- "I'll run all the verifications together at the end"
- "this extra fix is obviously needed" (out-of-scope is a blocker, not a favor)
- "the verification failed but the code looks right"

## Step 4: Parallel tasks (optional)

Tasks marked independent may be dispatched to subagents — one task per subagent,
each given the full task text verbatim plus the branch name. Never let two
subagents touch the same file. Verify and commit each result through the same
per-task loop; you (the main agent) run the gates, not the subagent.

## Step 5: Finish

After the last task:

1. Full test pass: `pnpm test` (turbo scopes caching; this one is safe repo-wide).
2. For anything user-facing: browser-verify with `/test` (boots on the running
   `crbn up` stack, logs in, drives the changed flows). A UI change without a
   passing browser check is **not done** — if the stack can't boot, the work is
   BLOCKED, not complete.
3. Review your own diff with `/self-review`.
4. Report:

```markdown
## Implementation complete
**Plan:** .ai/plans/{date}-{slug}.md (all tasks checked)
**Branch / commits:** {branch}, {N} commits
**Tests:** {X added, all passing — command + result}
**Browser verification:** {flows verified via /test, or explicit N/A for non-UI}
**Deviations from plan:** {none, or list with reasons}
**Ready for:** PR
```

Open a PR only if the user asked for one.

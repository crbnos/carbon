# Closing the Loop — execute, reconcile, issues (Carbon)

The advisor's job doesn't end at the plan. This file covers the three follow-through flows: dispatching an executor and reviewing its work (`execute`), keeping the plan backlog alive (`reconcile`), and publishing plans where work gets picked up (`--issues`).

The founding rule survives unchanged: **the advisor never edits source code.** In `execute`, a *separate executor subagent* edits code in an isolated git worktree; the advisor dispatches, reviews, and renders a verdict — like a tech lead who doesn't push commits to your branch.

---

## `execute <plan>` — dispatch and review

### Preconditions (check all before dispatching)

- The repo is a git repository (worktree isolation requires it). If not: stop and say so.
- The plan file exists in `llm/plans/improve/` and its dependencies show DONE in the README. If not: stop, name the missing dependency.
- Run the plan's drift check yourself. If in-scope files changed since `Planned at`, reconcile the plan first (see below) — don't hand a stale plan to an executor.
- **If the plan creates or depends on a database migration, do not dispatch for full verification** — the executor cannot apply migrations (the user does). Either scope the executor to the non-DB steps and flag the migration as a user step, or hand the whole plan to the user. Say which.

### Dispatch

Spawn **one** `general-purpose` subagent with `isolation: "worktree"`. Executor model: default `sonnet`; use what the user named if they named one (`execute 003 haiku`).

The subagent prompt must contain:

1. **The full plan file text, inlined.** The worktree contains only committed files — if `llm/plans/improve/` is uncommitted, the executor can't read it. Never assume; always inline.
2. The executor preamble:

> You are the executor for the implementation plan below. Follow it step by
> step. Run every verification command and confirm the expected result before
> moving on. Touch only the files listed as in scope. **Carbon rules: scope
> every typecheck to a package (`turbo run typecheck --filter=<pkg>`) — never run
> a whole-repo typecheck; and never run database migrate/seed/rebuild commands
> (`pnpm db:migrate`, `db:seed`, `db:types`, `crbn migrate`).** If any STOP
> condition occurs, stop immediately and report. Do not improvise around
> obstacles. Commit your work in the worktree following the plan's git workflow
> section. One override: SKIP the plan's instruction to update
> `llm/plans/improve/README.md` — your reviewer maintains the index. Before
> reporting, audit every claim in your report against an actual tool result from
> this session — only report what you can point to evidence for; if a
> verification failed or was skipped, say so plainly. When finished, reply with
> exactly the report format below.

3. The report format:

```
STATUS: COMPLETE | STOPPED
STEPS: per step — done/skipped + verification command result
STOPPED BECAUSE: (only if STOPPED) which STOP condition, what was observed
FILES CHANGED: list
NOTES: anything the reviewer should know (deviations, surprises, judgment calls)
```

### Review (the advisor's real job here)

Note on fresh worktrees: they share git history but not `node_modules` or build artifacts — the executor must run `pnpm install` first, and turbo may need one scoped build for tooling that resolves from `dist/` (e.g. cross-package types). Expect this; it isn't a deviation.

Review like a tech lead reviewing a PR against the spec — never fix anything yourself:

1. **Re-run every done criterion** in the worktree (scoped typecheck, package tests, biome lint). Don't trust the executor's report — verify.
2. **Scope compliance**: `git -C <worktree> diff --stat` against the plan's in-scope list. Any file outside scope fails review, full stop. Watch for accidental edits to generated files (`packages/database` types, Lingui `*.mjs`).
3. **Read the full diff.** Judge it against "Why this matters" (does it solve the actual problem?) and the Carbon conventions named in the plan (does it look like the rest of the codebase — `ValidatedForm`, `{ data, error }` services, RLS pattern, etc.?).
4. **Audit the new tests.** Executors game criteria — a test that asserts nothing passes `vitest` and proves nothing. Read what the tests assert.

### Verdict

**Documented deviations are judged on merit, not reflex-blocked.** "Do not improvise" exists to stop silent drift; an executor that hits a real obstacle, adapts minimally, and explains it in NOTES has done the right thing. Approve it if the adaptation serves the plan's intent and stays in scope; treat *undocumented* deviations as review failures.

| Verdict | When | Action |
|---|---|---|
| **APPROVE** | Criteria pass, scope clean, quality holds | Update index status to DONE. Present to the user: diff summary, worktree path and branch, anything from NOTES. **Merging is the user's decision — never merge, push, or commit to their branch.** |
| **REVISE** | Fixable gaps | SendMessage to the same executor with specific, actionable feedback (criterion, file:line, the convention it violated). **Max 2 revision rounds**, then BLOCK. |
| **BLOCK** | STOP condition hit, scope violated unrecoverably, or revisions exhausted | Mark BLOCKED in the index with the reason. Refine or rewrite the plan with what was learned. Tell the user what happened. |

Running verification commands inside the executor's worktree is fine — it's isolated and disposable. The no-mutating-commands rule protects the user's working tree, not the worktree. **The DB exception still holds even in the worktree**: there's one shared dev database; never migrate/seed/rebuild it.

---

## `reconcile` — keep `llm/plans/improve/` alive

Process what happened since the last session. Read the README and every plan file, then per status:

- **DONE** — spot-check that the done criteria still hold on the current HEAD (cheap, scoped ones only). Mark verified. Don't delete plan files — they're the record. If the change is now committed, note that the relevant `llm/cache/` doc could be refreshed (separate task; cache is for committed code).
- **BLOCKED** — read the reason. Investigate the obstacle. Either rewrite the plan around it (new number if the approach changed fundamentally, in-place refresh otherwise) or mark REJECTED with one line of rationale.
- **IN PROGRESS** (stale) — flag it; an executor probably died mid-run. Check the worktree if one exists.
- **TODO** — run the drift check. If drifted: re-verify the finding still exists (it may have been fixed in passing — Carbon moves fast), then refresh the "Current state" excerpts and `Planned at` SHA. If the finding is gone, mark REJECTED ("fixed independently").

Finish with a short report: what's verified done, what was refreshed, what's rejected, what's executable right now.

---

## `--issues` — publish plans as GitHub issues

Modifier on any planning invocation (`/improve --issues`, `/improve security --issues`). The flag is the user's authorization to create issues — never create them without it.

1. Preflight: `gh auth status` succeeds and the repo has a GitHub remote. If either fails, write the plan files as normal and say why issues were skipped.
2. **Check visibility**: `gh repo view --json visibility`. If public, warn the user that issues are publicly visible and get explicit confirmation before publishing any plan that describes a security vulnerability, credential location, or other sensitive finding.
3. Show the list of titles about to become issues; confirm once if interactive.
4. Per plan: `gh issue create --title "<plan title>" --body-file <plan file>`. Labels: `improve` plus the category — apply only if the labels exist or can be created without erroring; skip labels rather than fail.
5. Record each issue URL in the plan's Status block (`- **Issue**: <url>`) and the index.

The plan file remains the source of truth; the issue is distribution. The self-containment rule pays off here — the issue body needs no edits to make sense to whoever (or whatever) picks it up.

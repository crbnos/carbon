# Overnight execution run — 2026-10-09

Brad asked for continuous, autonomous work overnight: finish every plan and implement it. He said to bypass confirmations and to use the recommended option when blocked.

## Executor brief (every executor agent reads this first)

**Repository:** `/Users/barbinbrad/conductor/workspaces/carbon/kelowna`, branch `projects-wbs-research-spec`. Never switch branches. Never push.

**Database:** this worktree has its own stack (Postgres on `localhost:60387`).
- 🛑 The shell exports `SUPABASE_DB_URL` for port 54322, another worktree's database. Before any command, run `export SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:60387/postgres`. Without it, the backup check and the authz tests read the wrong database or skip.
- Run `pnpm db:migrate:new <name> </dev/null`. With a pipe on stdin it hangs and leaves an empty file.
- Before the authz tests, run `pnpm exec turbo run build --filter=@carbon/config`.
- Apply migrations with `pnpm db:migrate`. Regenerate types with `pnpm run generate:types`.
- There is no `psql` binary. Where a plan says `psql "$SUPABASE_DB_URL" -c "…"`, run `/tmp/kpsql -c "…"` instead (a docker wrapper).
- Never run `crbn reset`, `crbn down --purge`, `supabase db reset` or anything that rebuilds or wipes the database.

**How to execute a task:**
1. Read `.claude/skills/execute/SKILL.md` and `.claude/skills/check-and-commit/SKILL.md` once. Follow them.
2. Read the plan's *Rules for the executor* and the files it says to read.
3. Do the tasks you were given, in order. Read each task fully before you edit.
4. Run the task's **Verify** commands. Fix failures before you continue.
5. Run Biome on the files you changed (`pnpm exec biome check --write <files>`) and the scoped typecheck the task names.
6. Tick the task's box in the plan's *Progress* list.
7. Commit the task alone: `git add <the task's files and the plan>`, then a conventional commit (`feat(projects): …`, `feat(service): …`). End the message with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

**When the plan and the code disagree:**
1. Search for the quoted code first. Line numbers drift.
2. If the plan's intent is clear, adapt to the real code with the smallest change. Record the deviation under a `## Execution notes` heading at the end of the plan, one bullet per deviation.
3. If a prerequisite artifact is missing, or a task cannot meet its intent, stop that task. Report it with the evidence. Do not invent a large redesign.

**Never:**
- `git stash` (the stash is shared with other worktrees).
- `--no-verify` on a commit, unless a pre-commit hook fails for a reason outside your change (a dataset check on an unrelated dataset, an unreachable service). Then record it in the plan's execution notes.
- Edit generated files by hand (`packages/database/src/types.ts`, swagger, generated authz migrations).
- Query in a loop, use JavaScript `Date`, or construct a database client in a `*.service.ts`.

**Browser verification tasks** (the last task of each plan): skip them during the overnight run. Record "Browser verification deferred" in the execution notes. Leave the box unticked.

**Report back** in STE-80: the tasks done, the commit hashes, every deviation, and any task you stopped.

## Execution order

1. Projects 1a → 1b → 1c.
2. Field service A → B → C → D.
3. Projects 2a → 2b → 3.
4. Project billing 4a → 4b.
5. Government contracting 5a → 5b → 5c → 5d.

## Log

| Time | Plan | Tasks | Result |
|---|---|---|---|
| 01:40 | — | specs, research and plans committed (`31c08fa359`) | done |
| 02:20 | Projects 1a | Tasks 1–10 | done (`9a2ccc3bd1`…`d13d3e68b2`); `@carbon/ee` typecheck waits for Task 25 |
| 02:25 | Plans 4a, 4b, 5a–5d | written | committed |
| 03:00 | Projects 1a | Tasks 25, 11–15, 24 | done (`61fabb33f1`…`e91a3157de`); typecheck green |
| 03:25 | Projects 1a | Tasks 16–19 | done (`3d8f5237bb`…`a70669a821`) |
| 03:55 | Projects 1a | Tasks 20–23 + scrap fix | done (`bd371e2f97`…`3b4c6c22b9`); server-functions suite 416 passed |
| 07:25 | Projects 1a fixes, 1b | catalog + `@carbon/jobs` typecheck fixes; 1b Tasks 6–13 | done (`3068cfbfbc`…`7cee2a64c2`); server-functions 429, erp 1974 |
| 04:25 | Projects 1a | Tasks 27, 26, 28–31 | done |
| 05:05 | Projects 1a | Tasks 32–36 | done |
| 05:55 | Projects 1a | Tasks 37–43 | done |
| 06:20 | Projects 1a | Tasks 44–46; 47 deferred | done — Phase 1a implemented |
| 06:45 | Projects 1b | fixes + Tasks 1–5 | done |
| 07:40 | Projects 1b | fixes + Tasks 6–13 | done |
| 08:20 | Projects 1b | Tasks 14–20 | done |
| 09:05 | Projects 1b | fix + Tasks 21–26 | done |
| 09:55 | Projects 1b | Tasks 27–31; 32 deferred | done — Phase 1b implemented |
| 10:30 | Projects 1c | Tasks 1–7 | done |
| 11:20 | Projects 1c | Tasks 8–13; 14 deferred | done — Phase 1c implemented |

## Follow-ups found during execution

- A receipt still makes an inspection lot for a stocked item that the project consumes at receipt (Phase 1a Task 21).
- `POSTING_POLICY` syncs `Timesheet` and `Project Issue` journals to external ledgers by default, as `Maintenance Event` does. Confirm with Brad.
- Shared-database test races: `post-charge-transaction.test.ts`, `preview-asset-capitalization.test.ts`, `rows.test.ts` and `get-accounting-period.test.ts` fail sometimes in full runs and pass alone.
- Phase 1b Task 12: the remaining-life Straight Line applies only to assets with a late capital cost. Confirm with Brad before it applies to every asset (it would change existing schedules).
- Remaining-life Straight Line applies only to assets with a late cost; every other asset keeps its old schedule (Phase 1b Task 12). Brad to confirm.
- `shouldRevalidate` on the Elements route skips the reload after a preference save (Phase 1b Task 21). Brad to confirm against `coding-conventions.md`.
- `Template.tsx` in `packages/documents` (Ask First) now passes its font to children so italic text cannot crash a PDF (Phase 1b Task 20).
- Restoring a backup into another company does not rewrite ids inside the baseline snapshot and change request JSON columns (Phase 1c).
- Re-applying a demo dataset over a company with contract invoice lines fails in the wipe (`customerContractInvoiceLine_parent_check`); a contracts issue, found in Phase 1a Task 45.
- `projects.mdx` is about 2,600 words, over the docs skill's 1,500-word entity page limit.
- New UI strings from every phase need one `/translate` pass at the end of the run.

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
| 10-09 pm | Field service A | Tasks 1–30; 31 deferred | done — Phase A implemented |
| 10-09 pm | Field service B | fixes + Tasks 1–12; 13 deferred | done — Phase B implemented |
| 10-09 pm | Field service C | Tasks 1–10; 11 deferred | done — Phase C implemented |
| 10-10 | Field service D | backflush fix + Tasks 1–7; 8 deferred | done — spec moved to `implemented/` |
| 10-10 | Projects 2a | Tasks 1–20 + Charge-at-receipt fix; 21 deferred | done — Phase 2a implemented |
| 10-10 | Projects 2b | Tasks 1–15; 16 deferred | done (`1e210d03c9`…`e61caf22dc`, then `d51585c203`) — Phase 2b implemented |
| 10-11 | Projects 3 | Tasks 1–17 + return fix; 18 deferred | done (`03b7c24044`…`16e1cb00da`) — Phase 3 implemented; Task 16's dataset check ran without its database layer |
| 10-11 | Tree canvas (Flow-style) | Tasks 1–8; 9 deferred | done (`dbdaed7797`…`628fae0cbb`) |
| 10-11 | Project billing 4a | Tasks 14–20; 21 deferred | done (`81265037b3`…`4a48f33082`, then the docs commit) — Phase 4a implemented |
| 10-11 | Project billing 4a, 4b | 4a Tasks 1–20, 21 deferred; 4b Tasks 1–13, 14 deferred | done (4a from `3d42be0094`; 4b `129e0b9dc7`…`1223834483`, then the docs commit) — Phase 4 implemented, spec moved to `implemented/` |
| 10-11 | Merge origin/main (`a4a1e15ba2`) + always-post | Phase 2b of `.ai/runs/2026-10-11-merge-origin-main.md` | done (`344624656d`, `1397e61049`, `b39ead1e74`, `63e77ba0bc`, then the docs commit) — the project and service journals follow main's always-post rule; `db:check:backups` passes with no skip |
| 10-11 | Fixes + Government contracting 5a | Project Issue relief fix, `no-unguarded-submit` fix; 5a Tasks 13–15, Task 16 partial | done (`3e64d06a7b`, `69a4e31a9f`, `6701ae72aa`, `14f7d679e4`, `6745de7a4b`, `30900e12ac`) — Task 16 step 3 (Log time, service time) stopped: it needs a design decision, see the 5a plan's execution notes |
| 10-11 | Government contracting 5a | Task 16 step 3 (add mode), the note fix, the void reversal line fix; Tasks 17–20 | done (`0f4efe50e1`, `44cac82fc0`, `1bc9994652`, `8d4d9fd68c`, `4b80e31c38`, `03b721ce45`, `266b5b5e4c`) — server-functions 773, erp 2,204, ee project-revenue 15 pass; browser checks deferred |
| 10-11 | Cutover fixes + Government contracting 5a | Brad's 4 cutover decisions (opening project WIP, fixed assets at the cutover, project issue re-cost, payback refusal message); Log time Draft in DCAA mode; 5a Tasks 21–24 | done (`b5cf4c65a8`, `81392d3d0c`, `c008470da5`, `014cf941cd`, `c6affee4d3`, `87ad9a777e`, `518b2bb84b`, `e2d19401d6`, `9641b0017e`, `90add5b7ad`) — server-functions 778, erp 2,204, ee project-revenue 16 pass; browser checks deferred |
| 10-11 | Government contracting 5a | Tasks 25–30 | done (`f4610cf5a4`, `f0f2f483b0`, `0e6acb255e`, `43291cb094`, `21eeb14335`, `3ff3865649`) — server-functions 782+, erp 2,207, jobs 951 pass; browser checks deferred |
| 10-11 | Government contracting 5a | Tasks 1–34 complete (this session: the close check fix, Tasks 31–34, a conformance log fix); Task 35 deferred | done (`9efe6a2846`, `b8317f52ca`, `f02dedc5ec`, `73367da2b7`, `38e2432b8a`, `8cadcd27de`) — Phase 5a implemented; database 518 (incl. the new live-database close-count test), erp 2,211, checks 300 pass; `db:check:datasets` 4/4, `db:check:backups` restorable; browser verification deferred |
| 10-11 | Government contracting 5b | Tasks 1–21; Task 22 deferred | done (Tasks 1–14 `8c9c33f586`…`fd019340f6`; Tasks 15–21 `d326c0cfad`, `b2bc052f67`, `8a58013837`, `e256e61b57`, `4435b43e32`, `bfd9c9f921`, `4c7b364f84`) — Phase 5b implemented; ee 2,023, server-functions 795, checks 300 pass; `db:check:datasets` all four and `db:check:backups` pass. 🛑 `pnpm --filter erp build` fails on 2 Phase 3 imports in `packages/planning` (`@carbon/ee/plan.server`, `@carbon/ee/pegging.server`), not on 5b; see the 5b plan's Task 20 note |
| 10-11 | ERP build fix + Government contracting 5c | build fix; 5c Tasks 1–8 | done (`d06d673703`; 5c `424dc3a384`, `1bd0c6bab7`, `870d973fe3`, `4af81025e4`, `373a3576a8`, `d13ad61116`, `92edba6d97`, `a26dba857f`) — `@carbon/planning` imports no `.server` module: every `runMrp` caller injects `planningGroupMrpDeps`. `pnpm --filter erp build` passes. planning 338, ee 2,039, jobs 952, database 518 pass; `db:check:datasets` all four and `db:check:backups` pass. 5c Tasks 9–23 are not started |

## Follow-ups found during execution

Brad resolved 4 items on 2026-10-10, so they are gone from this list:
1. Payback accounting: fixed in `ef9483c0e8`.
2. Remaining-life Straight Line: it stays as built.
3. External ledger sync: one rule, with all 5 project and service journal types off by default (`f065898e05`).
4. A technician without `service_update` charges only their own open visit: it stays as built.

Open:
- Government contracting 5c: until Task 14 ships the `earned-value-closed` evaluator, the close checklist on this branch's database shows "Close earned value for the period" as an open required task. A user can skip it. Tasks 9–23 of the 5c plan are not started.
- A receipt still makes an inspection lot for a stocked item that the project consumes at receipt (Phase 1a Task 21).
- Shared-database test races: `post-charge-transaction.test.ts`, `preview-asset-capitalization.test.ts`, `rows.test.ts`, `get-accounting-period.test.ts` and `calculate-cogs.test.ts` fail sometimes in full runs and pass alone.
- ~~The merge with main left 5 open questions on the accounting cutover.~~ Resolved: question 5 was fixed earlier, and Brad accepted the recommendations for 1 to 4 on 2026-10-11 (`b5cf4c65a8`, `81392d3d0c`, `c008470da5`, `014cf941cd`). `.ai/runs/2026-10-11-merge-origin-main.md` → *Open questions for Brad* records each one.
- `shouldRevalidate` on the Elements route skips the reload after a preference save (Phase 1b Task 21), and the Tree canvas adds a skip on a `root` change (Task 6). Brad to confirm both against `coding-conventions.md`.
- `Template.tsx` in `packages/documents` (Ask First) now passes its font to children, so italic text cannot crash a PDF (Phase 1b Task 20).
- Restoring a backup into another company does not rewrite ids inside the baseline snapshot and change request JSON columns (Phase 1c).
- Re-applying a demo dataset over a company with contract invoice lines fails in the wipe (`customerContractInvoiceLine_parent_check`). This is a contracts issue, found in Phase 1a Task 45.
- `projects.mdx` is over the docs skill's 1,500-word limit for an entity page, and Phase 3 added a *Planning groups* section.
- Run `/translate` once for the whole branch before the PR. Every phase left new UI strings with an empty `msgstr` in the other locales.
- Projects 2a: a posted project stock transfer has no void.
- Projects 3 Task 16: run `pnpm db:check:datasets` when the stack is up. Only its first layer (the validator) ran: the worktree's Postgres container no longer exists (its `pgdata` volume does), so the tier SQL that seeds the Star Tracker group has not run against a database.
- Projects 3 Task 14: a group segment can get a Transfer from common stock with the group id as `toProjectId`. Applying it fails on the project FK.
- Tree canvas: the browser check (Task 9) is deferred. The plan's execution notes list 2 visual risks:
  1. the edges over the box tint: card-to-box edges should draw above the boxes (`getElevatedEdgeZIndex` adds the child's `internals.z`), and box-to-box edges have `zIndex: 1`. Nobody has seen it in a browser;
  2. a `root` change skips only the Elements route's own loader. The parent layouts still run theirs, so Task 9 point 5 ("no loader request") can see those requests.
- Audit log: 16 tables in `auditConfig` have no `events: true` entry in `attachments.ts`, so they have no event triggers and their changes never reach the audit log: `customerBankAccount`, `supplierBankAccount`, `rentalAgreement`, `rentalAgreementLine`, `projectElement`, `projectElementLabel`, `projectElementMaterial`, `projectElementLabor`, `projectElementCost`, `projectElementLink`, `changeOrder`, `changeOrderAffectedItem`, `changeOrderSupersession`, `changeOrderActionTask`, `pricingRule`, `accountingPeriod`. Project billing Task 14 fixed `projectBillableItem` only. A test that every audited table has `events: true` would stop this from coming back.
- Project billing 4a: the contract line billing page already has **Generate Billable Items** (Task 16). A user does not have to wait for the invoice run to see items for rows that the job SQL wrote. No follow-up is needed for it.
- Project billing 4a: in the Draft setup grid (`ContractProductsGrid`), the quantity and rate cells of a Time & Materials or Cost Plus line stay editable. `upsertContractLine` saves 1 and 0 whatever the cell says, so the cell shows a value that does not save.
- Project billing 4a: an MCP `sales_upsertContractLine` can create a Cost Plus line without the `PROJECT_REVENUE` check. The ee generator still bills nothing for it (P1). Brad to decide if the service needs the check too.
- Project billing 4a: the browser check (Task 21) is deferred. Check the points in the plan's Task 21, and the UI points in the 4a hand-off.
- `projects.mdx` should link to the new `project-billing.mdx` page once the page is cut to its word limit.
- Project billing 4b: through MCP or the API, the close checklist's revenue run preview leaves out the Percent Complete rows. The 3 MCP tools that reach `getPeriodRunPreview` cannot take functions, so they pass no synthesizers. The ERP close page and every run call site include them.
- Project billing 4b: the browser check (Task 14) is deferred. Check the points in the plan's Task 14 and the UI points in the 4b hand-off.
- Project billing 4b: the revenue run page's **Amount** sums every line, so it adds the cost relief and the loss provision to the revenue.
- A void's reversal `projectLedger` row has no `journalLineId` (`reverseProjectLedgerRows`, and the reversal rows in `post-production-event`). If the revenue run relieved the original row, the reversal is never relieved, so Project WIP stays credited by that amount. Before a relief, the two rows net to 0 and nothing is wrong. **Fixed:** each reversal row now stores the void journal's line that negates its original line (see the 5a plan's execution notes).

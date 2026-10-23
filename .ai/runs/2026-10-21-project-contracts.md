# Project contracts — run log

**Spec:** .ai/specs/2026-10-21-project-contracts.md
**Plan:** .ai/plans/2026-10-21-project-contracts.md
**Branch:** projects-wbs-research-spec (behind main by 106 commits; not merged)

## Result

Tasks 1 to 19 are done and committed. Task 20 (browser verification) is BLOCKED.

## Verification run

| Check | Result |
|---|---|
| `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions --filter=@carbon/database --filter=@carbon/content --filter=docs` | 6 of 6 pass |
| ERP vitest: sales, projects, accounting, purchasing, service | 565 pass, 8 skipped (before the review fixes); 500 pass after (sales, projects, accounting) |
| `@carbon/database` `contract-schedule.test.ts` | 43 pass |
| `@carbon/server-functions` `post-customer-contract` tests (local DB, port 64215) | 21 pass |
| `pnpm db:check:datasets` (port 64215) | 4 of 4 datasets apply |
| `@carbon/checks` `run.test.ts` | 19 violations, all in files this run did not touch (issue-sync engine, `shared.server.ts`, `seed-data.ts`); 0 in this run's files |
| `linguito check`, `check-glossary.mjs` | pass (advisory hits only) |

## Task 20 — BLOCKED

At about 02:53 the worktree's compose stack restarted on new host ports (Postgres 64215,
Kong 64216). `.env.local` and the portless routes still name the old ports (59504, 59505),
so `https://api.projects-wbs-research-spec.dev` returns 502 and the ERP cannot load data.
Two `crbn up` processes from 00:09 and 00:11 are still running. Per the memory note
"Stopping crbn up tears down shared stack", this run did not restart `crbn up` or touch
Docker. Fix: restart `crbn up` for this worktree, then run `/test` on the acceptance
criteria of the spec. Demo records: satellite projects OB2 and PVP are Contract projects
with no project contract (Billing empty state; "New Project Contract").

## Self-review

Two defects found and fixed (`de67a8eda7`, `7dafcc282d`): a project billed by a line but
not named in its contract's header showed "No project contract"; an amended Fixed Price
line was counted twice in Funded. Follow-ups fixed in the same pass: the Contract card
counts only this project's lines; Approvals opens the Billing tab when only billing waits;
the Review gaps use the line's own project, as Confirm does; project contract redirects go
to Project Contracts; the run's lines are paged (`5c2ffc2606`).

## Section 10 assumptions (Task 21, 2026-10-22)

Readers of `project.projectStock`, and what each does when a job's output sits in
a project's stripe while `projectStock` is false (D33):

- `complete_job_to_inventory` (`20261011163015`): writes the output to the stripe only
  when `projectStock` is true; otherwise common stock. Task 27 changes this.
- `chargeNumberError` (`projects.server.ts:4787`): refuses `receiveToProjectStock`
  without the flag. Task 26 changes this.
- `getStockOwnerProjects` (`projects.service.ts:4625`): the stock owner pickers and the
  inventory owner filter list flagged projects only. **The stripe has no owner to pick:
  the prototype cannot be filtered or transferred.**
- `$id.scan.$lineId.tsx:73` (bin move scan): offers lots of flagged projects only.
  **The prototype cannot be moved between bins.**
- `inventory.service.ts:3795`: treats only flagged projects' jobs as stripe-drawing.
- `mrp.ts:299` and `:320`, `mrp-segment-views.sql:187`, `project-material-mrp-demand.sql:54`:
  MRP segments are flagged projects only. **A stripe on an unflagged project is not a
  segment, so MRP cannot net it correctly.**
- `picking-schedule-project-stripe.sql:38,175`: picks from the stripe only for flagged
  projects.
- `purchasing+/planning.tsx:151`, `production+/planning.tsx:152`: the Segment column
  lists flagged projects only.
- `job+/update.tsx:393`: **saving the job form sets `receiveToProjectStock` from the
  project's flag, so editing a Build job on an unflagged project silently turns it off.**
- `post-receipt/index.ts:1788-2137`: receipts stripe only for flagged projects (by
  design; D33 keeps it).
- The project close guard: no reader of `projectStock` found for Close.

DCAA: `post-production-event` has 0 reads of `timekeepingControls` (confirmed). The rule
(`government-contracting.md`) applies DCAA controls to timesheet entries only; production
labor is not mentioned. The gap of spec 10.6 holds.

**Result: STOP.** D33 as written leaves a stripe that 6 readers cannot see. D33 needs a
new decision (see the report to Brad).

## Open items for Brad

1. Glossary hrefs: point `fixed-price` at `/docs/reference/project-billing#fixed-price-billing-events`
   and `project-contract` at `#project-contracts`? (`docs/content/AGENTS.md` → Ask First.)
2. The backup manifest (`packages/jobs/manifests/schema.json`) has no `billingBasis`: the
   check compares against main's manifest and fails on 5 tables this branch lacks. A backup
   taken before this migration restores every contract as `Schedule`. Regenerate the manifest
   after merging main, and decide whether a restore should derive the basis from the lines.
3. Merging main: main moves the contract engine into `sales.service.ts` and drops the module
   barrels. Use the `resolving-merge-conflicts` skill.
4. Known gaps kept: amend, cancel and renewal re-plan a Fixed Price line's remaining billing
   events into one row; the burden run has no journal preview; the Review step has no
   overlap (P7) gap — Confirm still refuses it.

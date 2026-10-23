# Project accounting fixes — implementation plan

Source: `.ai/runs/2026-10-22-project-accounting-audit.md` (finding ids below). Branch
`projects-port-main`. Every fix is test-first: a database (or pure) test that fails for the
reason in the finding, then the minimal fix, then the scoped suite.

Out of scope until Brad decides: D11 (WIP at project close), A6 (revenue on Funding-limit
holds), B2 (amend `change` of a partly invoiced Fixed Price line — main's behaviour too).

## Progress

Wave 1 (disjoint files, in parallel)
- [x] R — revenue run: A1 (run with Cost Relief / Loss Provision cannot post), A2 (two lines on
      one subtree: per-line date windows for cost, relief and progress; P7 overlap check covers
      Fixed lines), A3 (an earlier month after a later month's row), A4 (Loss Provision booked
      twice in a zero-revenue month), B1-CostPlus (generator lower bound = line start)
- [x] J — C1 `closeJob` must not write off project-charged WIP lines
- [x] B — B1 (T&M backfill lower bound = line start), B3 (`takeWithinFunding` takes later credits)
- [x] E — burden: E4 (deactivated pool reverses its year), E5 (earlier-period re-run undoes later
      burden / true-up), E1–E3 (rate-run base agrees with the applied targets), E2 (billing
      honours the absorbed-overhead offset)

Wave 2
- [x] C — C2 (Option A, approved 2026-10-22: `projectLedger.relocatesReceiptCharge` zero-net pair) (Charge at receipt: the issue, TS and SQL paths, writes no second row), C3 (issue
      Return at the issue's unit cost)
- [x] D — D2 (reversals copy the original's account and unallowable flag), D3 (labor transfer
      moves the booked amount)

Gates (after each wave, by the lead, nothing running in parallel)
- [x] `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/utils`
- [x] Biome on changed files
- [x] the project accounting database suites (51 files) + touched unit suites
- [x] one commit per item, specific files only

## Rules for every agent

- Work only in `/Users/barbinbrad/conductor/workspaces/carbon/kelowna-port`, only in the files of
  your item. Do NOT commit, stash, or run `git add` (the lead commits; lint-staged stashes
  unstaged work of parallel agents). No `db:migrate`, `crbn`, or docker changes in wave 1.
- Database tests: `cd apps/erp && set -a && source ../../.env.local && set +a && npx vitest run <path>`.
- Follow `.claude/rules/numeric-precision.md` (no raw rounding), `date-handling.md` (no JS Date),
  `database-patterns.md` (no N+1, Kysely transactions), SPDX headers on new files
  (`pnpm --filter @carbon/checks license-headers`).
- Update the rule/AGENTS text the fix makes stale, in the same change.

## Execution notes

- Commits: 6b6f3251d2 (C1), 2b5239cbe3 (B1, B3), e469cd83eb (E1–E5), db8c728934 (A1–A4,
  Cost Plus dates), then the reversals/returns commit (C3, D2, D3, C5, D10).
- Lead override in R: ledger row ownership is "latest start on or before the posting date, else the
  earliest line" (not strictly the line's own dates), so a single line still owns cost posted before
  its start and nothing is stranded in WIP. Pinned by `lib/project-revenue-run.test.ts`.
- f808d82bdc (C2, migration `20261023011138`). Datasets 4/4 apply; backups restorable.
- Left open: E6 (concurrent burden runs need a
  lock across the community posting function), and the three decisions (D11, A6, B2).
- Gates: typecheck erp/ee/utils green; Biome clean on changed files; 183 files / 2103 tests green.
  Pre-existing, unrelated: `packages/utils` status-colors and ERP `method-import-guards` "refuses a Draft
  an editor activates" fail at `a0c98f0560` too.

# Bugfix run: accounting PR review corrections

- Date: 2026-09-08 (America/New_York)
- Mode: fully-autonomous
- Request: after making the PR, wait for the coderabbit review, and then solve the problems
- Phase plan: root-cause [existing nuclear evidence plus CodeRabbit triage] · instrument [only if an unproven runtime finding needs it] · fix [after CodeRabbit review] · test [red-to-green and targeted browser verification where applicable] · commit [update requested PR; user authorization persists]

## Decisions

- Create PR from current committed state before further fixes; PR #1599 created and branch pushed
- No automatic GitHub review comments; use PR updates and code changes within requested scope
- Prepare disjoint fix slices while waiting; no production edits before completed CodeRabbit review
- Existing stopped PostgreSQL container is scoped to this branch/workspace and retains pgdata; start it without recreating/resetting anything
- Keep original journal metadata roles; no additional production schema role column or legacy migration machinery

## Phase log

- root-cause: nuclear report contains exact repro evidence for M1/M4/M5 and code-backed M2/M6/M8; provider contract uncertainties retained as such
- baseline: 84 SQL report cases pass (`.context/accounting/nuclear-review/review-fix-sql-baseline.log`)
- baseline: 15 live payment/memo/concurrency tests pass (`.context/accounting/nuclear-review/review-fix-transactions-baseline.log`)
- CodeRabbit: review 5149438993 received on 2026-09-09 at 03:29:45Z; six inline findings and 34 review-body findings classified against the code.

## Outcome

In progress; PR https://github.com/crbnos/carbon/pull/1599


## Verified corrections

- Mixed-sign AR/AP controls: live posting first produced applied 110/fictitiousFX 20 for a net90 invoice; signed reduction now posts90/FX 0 and reports reconcile.
- Original IC controls: changing defaults first lost the original control; the exhaustive selector now relieves its original account.
- Memo void: consumed memo originally voided with its consumer still Posted; now fails atomically until the applying payment is voided. Draft reservations do not falsely count as consumption.
- Missing memo principal: SQL formerly treated NULL consumed principal as zero; affected memos are excluded from current open reports, while earlier historical cutoffs remain valid.
- Root integration: 20 live transaction/concurrency tests; four SQL suites (88 report reconciliation cases plus explicit unknown-principal assertions); 126 runtime edge tests and 46 typed pure helper tests; 177 utils tests pass.
- Types regenerated from the existing local database; workflow catalog generated and checked; four demo datasets and real backup compatibility check pass. Backup check requires the tracked local runner so its inherited environment points at this workspace.

No database reset, provider writes, GitHub review comments or merge occurred.


## Final gates before commit

| Gate | Outcome |
| --- | --- |
| Local migration + generate:types | PASS; existing schema current, both edited branch migrations reapplied inside one transaction; regenerated types unchanged |
| Workflow catalog generation/check | PASS |
| Biome + diff whitespace | PASS |
| Database/utils/ERP/EE typechecks | PASS |
| ERP focused tests | 186 tests across9 files PASS; full reporting slice also198 tests across7 files PASS (overlapping) |
| EE provider tests | 928 tests across62 files PASS; final document-type scope change59 source tests PASS |
| Utilities | 177 tests PASS |
| Edge helpers | 126 runtime tests PASS;46 typed pure helper tests PASS (overlapping) |
| Payment builder | 30 tests PASS, including2 new distinct-target-rate AR/AP cases (28 overlap runtime suite) |
| Real posting transactions | 20 payment/memo/concurrency tests PASS |
| SQL | Shipping backfill, settlement constraints,88 report reconciliation cases plus unknown-principal assertions, and7 intercompany elimination scenarios PASS |
| RLS/defaults SQL | Child-only policy and atomic combined UPDATE proof PASS; tracked in accounting-defaults-report-access.test.sql |
| ERP production build | PASS; existing unrelated assembler callback node:crypto/browser and chunk-size warnings remain |
| Translations | 27 existing messages corrected across11 locales; extraction reports0 missing; compilation PASS |
| Dataset/backup compatibility | Four datasets PASS; live schema restorable against main manifest |

All40 CodeRabbit findings have dispositions in [the review resolution](../reviews/2026-09-08-accounting-review.md). Two suggestions conflict with tested accounting invariants; the generated Swagger2 nullable suggestion remains an inherited generator limitation. Independent integration source review found no new blocker. Provider transport remains mocked; browser testing was not repeated in this correction pass.

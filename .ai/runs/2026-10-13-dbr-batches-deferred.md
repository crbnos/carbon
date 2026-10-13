# Bugfix run: Demand-Based Reorder batches are Deferred right after they are raised

- Date: 2026-10-13
- Mode: fully-autonomous
- Request: "When raising a PO, the date on the suggestion appears to be 1 month earlier than it should. When you raise it, you immediately then get a suggestion to defer it by 1 month."
- Phase plan: root-cause [done earlier in session — HIGH] · instrument [skip — deterministic repro] · fix [run] · test [skip — pure logic, regression test covers it] · commit [run — user asked for a PR]

## Decisions

- Batch dates: each batch is due in the week its share of the demand is needed (user choice) — matches the reschedule check — 2026-10-13
- Scope: only `computePlanningOrders` (Demand-Based Reorder branch). Its only caller is `generatePlanningActions`; the drawer re-split (`splitIntoOrders`) round-trips per week because batches keep their order (full batches first, remainder last).

## Phase log

- root-cause: HIGH. The Demand-Based Reorder branch dates every batch in the first short week. `deriveChangeActions` judges each PO line by the first demand it covers, so later batches read as early and get a Defer.

- fix: `computePlanningOrders` Demand-Based Reorder branch dates each batch at the first week the projection, plus every earlier batch, is under safety stock; batches sharing a week spread across its days in sizing order, across windows too. Red→green: 2 sizing tests + 1 planning test failed before (all batches in p1; 2 Defers), pass after.
- fuzz (3,000 random items, scratch test, deleted): Demand-Based Reorder Defers 4,300 → 0. Fixed Reorder Quantity / Maximum Quantity counts unchanged. Demand-Based Reorder Decreases 431 → 498: all on items with a minimum, multiple, batch or max; previously masked by the Defer (one action per order). Existing behavior, not new.
- gates: biome PASS · typecheck(@carbon/utils, @carbon/planning) PASS · test(@carbon/utils 734, @carbon/planning 324) PASS · erp planning tests (10 files, 118) PASS
- test: skipped — pure logic, regression tests cover it

## Outcome

- Committed `ab4a68fcf8`; PR #1912 (https://github.com/crbnos/carbon/pull/1912)

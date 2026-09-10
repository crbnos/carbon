# Bugfix run: accounting report completeness

- Date: 2026-09-09
- Mode: fully-autonomous
- Request: Fix E2E findings 1, 3, 4; this slice owns report/history findings 4.
- Phase plan: root-cause satisfied by verified browser/API/DB evidence; instrument skipped (HIGH confidence); fix with regression tests; browser verify after root's migration batch; commit skipped (root owns integration).

## Root cause

HIGH: actual capped PostgREST tests proved unpaged payment and invoice history truncation. Actual inactive-account test proved the balance RPC's active-only tree/grid filters drop historical balances. Unknown companies parameter bypasses membership-in-group validation in all three report loaders.

## Planned files

- New SQL regression and forward migration for inactive-account balance RPCs.
- Existing report loader regression plus balance-sheet/income-statement/trial-balance scope checks.
- New history regression and only getInvoiceSettlements/getInvoiceSettlementsForInvoice function bodies in invoicing.service.ts.
- Relevant report guidance/playbook freshness after verification.

## Verification

Run each new regression red before production edits. Root applies all agents' migrations and regenerates types together. Then run SQL green and browser/accounting history tests under real max_rows=1000; restore original config and close session.

## Fix progress

- Reporting/history regressions reproduced first: 8 application-history failures, 6 scope failures, and inactive historical balance missing in the SQL RPC.
- History now pages settlements with embedded parent statuses and stable ordering. Target memo labels are included for refunds. Scope loaders reject unavailable companies (404) and failed company lookup (error redirect).
- New history + existing settlement + report suites: 83 tests passed after implementation.
- Historical migration removes active-only filtering from all three reporting RPCs and the period-close snapshot writer. The new SQL regression invokes the actual snapshot writer with inactive leaves and ancestors.
- Root expanded this slice to the six refund subledger RPCs. Refund regression failed before SQL changes with aging total 0 instead of 50. New cases cover AR/AP cash direction, party isolation, partial/full FX refunds with exact 55.01 memo principal, Draft/Voided/future payments, and unknown target principal.
- Unknown memo principal retains the existing branch contract: omit the malformed memo rather than reconstructing principal from rounded base; it does not raise a report error. Root explicitly confirmed preserving this contract. Tie-out variance remains the signal for resulting subledger/GL disagreement.
- Root applied both migrations and is running shared type generation. SQL green and capped browser proof are pending; runtime currently under memory pressure.


## Outcome

READY — both new migrations applied by root, all historical snapshot cases and 106 AR/AP report cases pass; 83 scoped ERP tests pass. Actual authenticated browser with hard cap 1,000 verifies complete payment/invoice histories, inactive child/All Companies balances, full two-period CSV parity (1,061 rows), and invalid scope 404. Local ERP restart/proxy fallback recovered runtime resource failures; the synthetic invoice fixture needed its missing shipment companion row. Cap and owned account activity restored, browser closed, session secret deleted. Full evidence: `.context/accounting/e2e-20260909/fix-reports-results.md`. Shared typecheck/full gates and commits remain root-owned.

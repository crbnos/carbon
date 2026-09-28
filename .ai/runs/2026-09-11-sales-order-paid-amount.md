# Bugfix run: Sales order paid amount

- Date: 2026-09-11
- Mode: fully-autonomous
- Request: "we made another try recently to fix the paid amount on the sales invoice summary but it's still showing 0 and it should show the full amount"
- Phase plan: root-cause [run] · instrument [skip — cause proven statically] · fix [run] · test [run — user-facing summary] · commit [skip — not requested]

## Decisions

- instrument: skip — the screenshots and invoice Payments panel prove that the summary should use settlement `appliedAmount`.
- browser test: run if the local ERP stack is available after scoped automated gates.
- commit: skip — the user did not request a commit.

## Phase log

- root-cause: HIGH — the recent sales-order summary reads payment-source `sourceAmount`, while the invoice Payments panel and requested summary semantics use invoice-target `appliedAmount`.
- fix: replaced the payment-source amount with `appliedAmount` and converts that base principal into the invoice/order currency.
- regression: RED proved the summary used `sourceAmount` (80) instead of `appliedAmount` (75); GREEN passed 3/3 focused invoice-summary tests.
- gates: biome PASS with two pre-existing warnings in untouched lines · ERP typecheck PASS after local React Router type generation · sales module tests PASS (23/23).
- browser test: SKIP — this workspace has no `.env.local`/`ERP_URL` and no local ERP process; the only running ERP processes belong to other workspaces.
- commit: SKIP — not requested.

## Outcome

- READY

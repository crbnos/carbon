# Accounting priorities 1 and 2 — executed E2E verification

Date: 2026-09-09. Branch: `assess-issue-against-code`, HEAD `84abeb3e3d`. Concurrent uncommitted workspace edits in `AccountMapping.tsx` and the generated tool-manifest digest were preserved; this test run did not modify production source.

**Verdict: the core posting and consolidation corrections have substantial live coverage, but accounting is not ready for rollout.** Real browser, authenticated ERP routes, edge posting endpoints, PostgreSQL and the live Rillet sandbox exposed additional failures. Issue statuses and unit tests were not used as substitutes for execution.

The user authorized `/test`, direct database/API setup and live Rillet verification. All test documents were uniquely prefixed and owned. The existing database was not reset. Rillet was configured only on Carbon Development; Xero and QuickBooks were not configured and have no live verification result.

## Final test matrix

| Priority area | Result | Evidence and observed behavior |
|---|---|---|
| Rillet connection, accounts, subsidiary | PASS | Sandbox key validated; chart and USD subsidiary returned by the real API. |
| Rillet USD invoice, tax rounding and retry | PASS | 20 × 1.99 at 8.25% produced gross 43.08 and tax 3.28; retry reused the same remote invoice. |
| Rillet document shipping/account provenance | PASS with fixture mapping | Valid invoice gross 126, tax 11 and total shipping 15 used the original mapped shipping revenue code. Current default Shipping Revenue itself lacks a mapping. |
| Rillet foreign bills | FAIL | Current adapter's directed currency pair is rejected with HTTP 400. Reversed pair and reciprocal rate accepted and independently booked USD 100 for both EUR 80 and EUR 120. |
| Rillet foreign AR base normalization | FAIL / provider behavior gap | AR_ONLY uses provider FX despite an explicit rate probe; Carbon base 100 became 93.02, 139.53 or 116.28. |
| Rillet revenue GL parity | UNRESOLVED | Independent GL books invoice net to Deferred Revenue 2160, although line revenue account codes are correct. Recognition workflow has not been proven to reproduce Carbon's immediate revenue posting. |
| Rillet ordinary USD AR/AP payments | PASS with fixture bank mapping | Actual Carbon posting/event/operation drain created one remote payment each; invoices/bills became PAID; retries reused/skipped the same IDs. |
| Rillet invoice/bill/payment void | FAIL in Carbon adapter | Local payment void leaves remote documents PAID and returns Skipped/manual remediation. Local invoice and bill voids are treated as already-pushed/idempotent; remote balances stay open. Native Rillet DELETE endpoints successfully reversed owned uncleared AR/AP payments and deleted owned unpaid invoices/bills. |
| Rillet inventory journal and reversal | PASS | Actual remote journal/reversal entries netted to zero by account. |
| Customer payment creation, invoice settlement and void | PASS | Browser created EUR 120.80/rate 0.8, staged base 151 and FX 0, posted Paid, then exact reversal. |
| Customer and supplier discount/write-off | PASS via UI routes | Customer cash 975 + discount 20 + write-off 5 closes base 1000; supplier 90 + 5 + 5 closes 100. Correct account classes and exact voids. |
| Prior on-account credit and FX | PASS | EUR 50 settled base 25 using original source rate 1 and invoice rate 2; FX gain 25. Source-void guard and consumer-void restoration passed. |
| High-rate ordinary credit payment | PASS | EUR 160.01/rate 16000: manual base 0.01 consumes EUR 160; final EUR 0.01 consumes base 0, FX 0. Both voids restore principal and carrying. |
| High-rate memo credit | FAIL on final cent | Customer and supplier first EUR 160/base 0.01 applications succeed; final EUR 0.01/base 0 stages correctly but posting rejects the remaining principal. |
| Supplier debit memo lifecycle | PASS | Credit 30 against invoice 50 leaves 20; source void blocked while consumed; consumer void restores balances. |
| Customer/supplier refunds | FAIL | Bank/control GL signs are correct, but AR/AP reconciliation diverges by the refund amount; refund application route also rejects the party/target. |
| Published settlement API | FAIL | Valid scoped API call returns 422 because `createdBy` is not injected. Equivalent authenticated UI action passes. |
| Sales tax, shipping, mixed signs and original accounts | PASS | Base 151 = revenue 123 + shipping 15 + tax 13. Signed fixture base 96.30 = revenue 75 + shipping 13 + tax 8.30. Settlement/void and changed-default reversal reconcile exactly. |
| Direct and receipt-owned purchase posting | PASS | Conversion factor 5, tax/freight, signed lines, zero PPV, original AP settlement, and invoice void preserving receipt-owned cost layers. |
| Actual fractional intercompany match/elimination | PASS | Both sides retain 300.015; real matching and balanced elimination pass. Half external realization leaves deferred margin 60.0075; regeneration is stable. |
| Intercompany tax/shipping and fixed-asset account | PASS | Complete captured controls/revenue/COGS used; external tax excluded from revenue; asset profit eliminated against the actual asset account. |
| Child-only reports, parent CTA, monthly CSV parity | PASS | User has only subsidiary access. Foreign report assets/equity 160, income 120, parent CTA 40, root 0. Identity and All Companies match CSV. |
| Inactive historical accounts | FAIL | Deactivating historical Cash and its parent removes assets 80 while retaining income 80; CSV copies the error and consolidation refuses the unbalanced subsidiary. |
| Defaults and new-company setup | PASS | Shipping Revenue seeded as an active revenue leaf. Save/reload and alternate account passed; invalid same-as-sales and cross-group mappings rejected without partial writes. |
| Large chart/open-invoice paging | PASS under actual cap 1000 | Reports retained 1,061 balance-sheet CSV rows from 1,111 chart accounts. Draft payment loader retained all 1,005 invoices and 1,105 settlement adjustments: first balance 895, total open 10,935. |
| Posted payment/invoice application paging | FAIL | With actual PostgREST cap 1000, 1,105 effective applications display as 1,000 and incorrectly show 105 unapplied. Invoice application loader likewise aggregates only 1,000. |
| Unrelated report company parameter | FAIL on explicit rejection | Returns an empty HTTP 200 report instead of rejecting an out-of-group selection. No cross-group balances were disclosed. |
| Fixed-asset invoice void master state | KNOWN FAILURE | GL reverses, but asset remains Active with acquisition cost 100; pre-existing lifecycle gap reproduced. |

## Fix next

1. **Rillet fidelity and setup.** Correct bill FX direction to document → subsidiary currency with reciprocal Carbon rate. Decide and implement an AR_ONLY FX/revenue-recognition policy that reconciles provider books with Carbon; accepting a remote document is insufficient. Propagate invoice/bill lifecycle states (`RilletTransactionSyncer.pushToAccounting` in `shared.ts` currently returns idempotently before loading the changed local document) and implement provider cash-payment deletion/reversal for supported payment states and retain explicit errors for unsupported states. Map Shipping Revenue and map Bank–Cash to a Rillet bank-linked GL account.
2. **Memo residual arithmetic.** In `packages/database/supabase/functions/post-payment/post-payment-transaction.ts`, round the remaining document principal after subtracting prior memo consumption before comparison. `160.01 - 160` becomes approximately `0.00999999999999`, so the exact staged `0.01` is incorrectly rejected. Prove final post and both voids through the UI/API again for customer credit and supplier debit memos.
3. **Refund lifecycle and subledger.** Carry customer/supplier identity independently of Receipt/Disbursement through application loading/staging, memo targets, aging and tie-out. Current posting uses the corrected signs, but subledgers omit opposite-direction cash. Customer refund 50 caused AR variance −50; supplier refund 30 caused AP variance −30. Voiding each restored variance 0.
4. **Historical report inclusion.** Remove active-only filtering from historical balance calculations while keeping current account selection rules separate. Reject report company parameters outside the authorized group rather than showing an empty report. `accountTreeBalancePeriodSeries` still filters root/child accounts in migration `20260809151458_balance-rpc-period-series.sql` (lines 73, 85 and 130); the live RPC matches the branch source. Verify inactive leaf and ancestor, balance-sheet root, consolidation and CSV together.
5. **Complete API paging and audit authors.** Paginate `getInvoiceSettlements` and `getInvoiceSettlementsForInvoice`, and any equivalent unpaged application loaders; rerun under actual cap 1000. Fix published `replaceInvoiceSettlements` auth injection so `createdBy` reaches the transaction. Verify the API key path separately from session-authenticated UI actions.
6. Track fixed-asset acquisition-state reversal as the already-known separate lifecycle issue.

## Rillet verification boundaries

The live adapter and actual sync factory/event drain were exercised; reads of returned documents and `/reports/journal-entries` independently checked amounts and accounts. Dedicated owned mappings were used to continue tests after discovering configuration gaps. These mappings do not prove the user's unmapped defaults work. Final configuration was re-read: Shipping Revenue 4040 is still unmapped; Bank–Cash 1010 maps to a GL account without a bank link. The sandbox bank-linked codes returned were 11111 and 21110.

This run primarily verifies outbound providers; it does not establish a new Rillet-origin inbound webhook round trip. Foreign/discount/write-off/prior-credit-funded outbound payments are explicitly skipped by current integration code; they were not counted as successful synchronization. AR_ONLY provider FX and deferred revenue behavior need a defined accounting contract, not just a payload change assumed from local tests. JPY was accepted at its currency precision; BHD lacked a provider FX rate and therefore did not complete a live round trip. Cleared payment reversal is not covered by the successful native deletion of UNCLEARED test payments.

Native payment, invoice and bill deletion was exercised as an API capability probe and cleanup after preserving proof that Carbon itself skipped void propagation. A final independent journal report confirmed that all five named deleted payment/invoice/bill entries were absent (`rillet-native-cleanup-gl.json`). This does not change the adapter's FAIL verdict.

## Reproduction evidence

All paths below are relative to this workspace. Detailed evidence is gitignored and retained for local inspection; no credentials are embedded in this report.

- Customer/root fixtures: `.context/accounting/e2e-20260909/payments-fixtures.json` and `customer-fixtures.json`.
- Ordinary FX/precision: `payments-{normal-posted,normal-voided,high-first,high-final,high-restored}-evidence.json`; `payments-source-guard.json`.
- Sales/discount assertions: `sales-posted.log`, `discount-posted.log`; `customer-fixtures.json` retains original/reversal account rows and explicit expected/actual checks.
- Memo failure: `memo-final.log`; `customer-fixtures.json` contains exact edge error and staged `sourceAmount=0.01`, `appliedAmount=0`; screenshot `.ai/scratch/e2e/accounting-20260909/memo-final.png` and adjacent snapshot.
- Customer refund: `customer-fixtures.json` → `refund.post` retains before/after tie-out and bank/control GL. Owned refund and memo were voided afterward to isolate later tests; original failure evidence remains.
- Purchasing/IC: `.context/accounting/e2e-20260909/purchase-ic-results.md` and its linked evidence JSON. Real PO creation/finalization, receipt, posting, scoped API dispatch and authenticated application routes are distinguished there.
- Reports/defaults: `.context/accounting/e2e-20260909/reports-results.md`, `reports-verification.json`, `reports-identity-child-inactive.json`, `reports-defaults-*`, `reports-child-rls-evidence.json`.
- Paging: `reports-postgrest-cap-evidence.json`, `reports-posted-payment-applications-capped.json`, screenshot `.ai/scratch/e2e/accounting-reports/reports-posted-payment-truncated-20260909.png`.
- Rillet: [adjudicated live results](../../.context/accounting/e2e-20260909/rillet-results.md), `rillet-fixtures.json`, `rillet-*-push.json`, remote document snapshots and independent ledger summaries under `.context/accounting/e2e-20260909/`; the linked Rillet results document gives the adjudicated probe outcomes and primary API documentation.

The actual PostgREST row cap was temporarily set to 1000, independently verified against 1,105 rows, then restored to its prior unset value (again verified as 1,105 returned). A malformed settlement beyond the first page made the draft loader fail closed and was removed afterward. The bulk invoice detail render hit an error with the synthetic fixture, so its truncation verdict is based on the real loader result; the posted-payment truncation was directly visible in the browser.

Local runtime failures (intermittent TLS/proxy requests, bypass login delay, early snapshots before completed requests), corrected fixture assumptions and test-script import problems were separated from product failures. Evidence histories can include failed setup attempts; the matrix above records final adjudicated outcomes.

## Repeatable verification

Successful UI sequences were cached in `.ai/playbooks/accounting-posting-corrections.md` and the reports/purchasing/provider playbooks written for this run. All dedicated browser sessions are closed, and the reports session credential file was removed. Root verification used:

```text
pnpm exec tsx .context/accounting/e2e-20260909/payments-prepare.ts
pnpm exec tsx .context/accounting/e2e-20260909/payments-assert.ts normal-posted
pnpm exec tsx .context/accounting/e2e-20260909/payments-assert.ts normal-voided
pnpm exec tsx .context/accounting/e2e-20260909/payments-assert.ts high-first
pnpm exec tsx .context/accounting/e2e-20260909/payments-assert.ts high-final
pnpm exec tsx .context/accounting/e2e-20260909/payments-assert.ts high-restored
pnpm exec tsx .context/accounting/e2e-20260909/customer-check.ts sales-posted
pnpm exec tsx .context/accounting/e2e-20260909/customer-check.ts discount-posted
pnpm exec tsx .context/accounting/e2e-20260909/sales-void.ts
pnpm exec tsx .context/accounting/e2e-20260909/customer-finish.ts mixed-settled
```

These scripts reference owned stateful fixtures and phases; rerunning an earlier phase after later voids will correctly fail its status expectations. Recreate fresh fixtures for a full new run. They are not a substitute for the documented browser actions between assertions.

Final local cleanup verification: root company receivables subledger/GL both 850 with variance 0; all temporarily changed defaults restored. Completed root cash, discount, refund and signed-line payment fixtures are Voided. The failed final customer memo payment remains Draft for reproduction; its preceding partial application remains Posted. Owned purchase test AP subledger/GL both 0, temporary API keys deleted, and its browser session closed.

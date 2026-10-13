# Accounting PR nuclear self-review

PR: https://github.com/crbnos/carbon/pull/1599 · Branch: `assess-issue-against-code` · Base: `origin/main`

Second review pass, run in thermo-nuclear mode after the CodeRabbit round recorded in
[2026-09-08-accounting-review.md](2026-09-08-accounting-review.md). Eight cluster reviewers read
the full branch diff (142 files, ~22.7k insertions); every finding below was re-verified against
source before being accepted. Fixes are tracked in
[the correction plan](../plans/2026-09-09-accounting-nuclear-review-fixes.md).

## Confirmed defects, fixed in this pass

| # | Defect | Evidence |
|---|---|---|
| 1 | `reconcileDocument` concentrated the whole document rounding residual on one component, so that component's tax no longer matched its own `taxPercent`. QBO's `tax = net × percent` preflight then refused the invoice with a message blaming the customer's QuickBooks configuration. | 20 × $1.99 @ 8.25% → one line got $0.24 tax on $1.99 net (12.06% vs a stated 8.25%). Randomised sweep: 1.6% of invoices blocked; some produced a negative tax on positive revenue, which Xero accepts and posts. Fixed with largest-remainder allocation (`distributeRoundingResidual`). |
| 2 | The two halves of an intercompany trade rounded at different scales — seller at settlement precision, buyer at internal `SCALE` — while `generate_intercompany_matches` pairs them on exact NUMERIC equality. | 3 × 100.005 stored 300.02 vs 300.015 → permanently `Unmatched`, eliminations never run. Regression introduced by this branch; the merge base had both at `SCALE`. |
| 3 | Refund applications (Disbursement→customer, Receipt→supplier) were refused outright, though the schema, the composer and `payments.mdx:14` all support them. | `cashIn !== isAR` threw before any application was inspected. The merge base explicitly decoupled the two axes "so refunds work". Restored per the user's decision. |
| 4 | A float tie between the stored `convertedUnitPrice` mirror and the converted extension made ~0.5% of FX invoices permanently unsyncable on all three providers. | `qty 2, unitPrice 2.81, rate 0.9137`. Now derives the unit price from the reconciled net, and still refuses when no representable price reproduces it. |
| 5 | Rillet serialised money at a hard-coded 2 decimals on the payment and item paths. | JPY payment → `"1000.00"`; BHD lost its third decimal. `toRilletMoney`'s `decimalPlaces = 2` default removed. |
| 6 | The on-account credit control description was built independently in two files, with a silent fallback to today's default control account on any drift. | A credit booked to intercompany receivables would be drawn against regular AR — original stays credited, default goes negative, no error. Centralised in `shared/accounting-posting.ts`. |
| 7 | The AR/AP tie-out and aging disagreed on party-less payments, so the tie-out reported a permanent non-zero variance — the one thing it exists to prove. | Tie-out had no `customerId`/`supplierId` predicate; aging did. |
| 8 | `fxGainLossAmount` became plain-nullable and is summed without `COALESCE` at six sites. | One explicitly-null row erased that settlement's principal from both tie-out and aging. `SET NOT NULL` added; regenerated types are now non-nullable. |

## Also fixed

Dead `updateDefaultBalanceSheetAccounts` (zero callers, unvalidated partial write) and
`updateDefaultIncomeAccounts` (test-only) — both still reachable as MCP `WRITE` tools, i.e. the
half-save path this branch set out to eliminate. Dead `getSettledInvoiceStatus` and its two
baselined raw-rounding violations. 21 discarded-conversion validation sites replaced with named
`assertExchangeRate` / `assertCurrencyDecimals`. A tautological defaults test whose fixture
short-circuited before the write. Stale `payments.mdx` (settlement field table, a factually wrong
CHECK sentence, the FX-plug sentence), `accounting.mdx` (shipping revenue), a missing glossary
term, and three unsupported `packages/utils/AGENTS.md` claims. Unrelated regeneration churn in
`events.generated.ts` reverted.

## Checked and cleared

The removal of `× invoiceExchangeRate` from sales posting is **correct**, though two independent
reviewers flagged it as a suspected bug. `convertedUnitPrice = unitPrice * exchangeRate`
(`20250507143421_sales-invoice.sql:152`) and `balance = amount_document / exchangeRate`
(`…030026.sql:67`) together prove `unitPrice` is base and `exchangeRate` is foreign-per-base; the
merge base had it backwards. A `COMMENT ON COLUMN` on `salesInvoiceLine.unitPrice`, mirroring the
ones this branch added for `payment.totalAmount` and `memo.amount`, would settle it permanently.

## Open — not addressed in this pass

**The highest-leverage item: CI runs almost none of this branch's evidence.** `apps/erp` and
`packages/database` have no `test` script, so `turbo run test` skips both, and there is no Deno
job in `.github/workflows/`. Roughly 7,400 of the ~10,900 new test lines are unenforced. The
DB-backed regressions additionally fail hard rather than skip without `SUPABASE_DB_URL`.

Also open: the review's full Risks section (invoice-poster TOCTOU and row locks, purchase-side
fixed-asset writes outside the Kysely transaction, payment-UI stale `rows` state and raw engine
errors shown to users, `new.tsx` loader/action asymmetry, `getCompanyHasOpenCredits` regression,
unbounded `FOR UPDATE`, Xero's explicit `CurrencyRate: 1` reversal and 3-decimal refusal, inbound
Xero `taxPercent` 100×, two questionable new MCP tools), and the structural items (edge-function
extraction, the 3,188-line `invoicing.service.ts` and 6,849-line `accounting.ee.service.ts`
splits, duplicated currency-decimals loaders).

## Premise

`sourceAmount` has no backfill, deliberately. Three further findings depend on that: historical
partially-paid invoices reverting to full balance, fully-paid invoices reappearing as open, and
`payment-syncer` silently skipping every pre-existing payment. The user confirmed accounting is
unused, so the no-backfill design stands. **If that premise ever stops holding for any deployment,
those three become live data-correctness defects.**

# Accounting Posting Corrections

> Status: implemented and verified locally
> Author: Codex, with Brad
> Date: 2026-09-07
> Local implementation and browser verification are complete. Connected-provider limits remain explicit below.
> Implementation plan: [Accounting Posting Corrections](../plans/2026-09-07-accounting-posting-corrections.md).

## TLDR

Correct three verified accounting defects: separate collected sales tax and customer shipping from ordinary sales postings; normalize transaction FX across invoices, payments, credits, reports, and accounting integrations; and correct consolidation's currency translation adjustment (CTA), account selection, and report rollups. Add `accountDefault.salesShippingRevenueAccount`, seed a Shipping Revenue account under Revenue, and backfill company defaults. **The user explicitly authorizes assuming accounting has no users yet.** Implement one corrected monetary contract directly; do not build legacy calculation versions, historical restatement tools, or an accounting cutover workflow.

## Problem Statement

The [code-based readiness audit](../plans/improve/2026-09-07-accounting-readiness-audit.md) checked the implementation behind [#1060](https://github.com/crbnos/carbon/issues/1060), rather than relying on issue statuses. This spec selects the posting/FX/consolidation corrections from that audit. Source baseline: `0a9aef2444b04f0a0f0ade6f99dcd8e60aa3ec30`.

| Verified defect | Source and consequence |
| --- | --- |
| Sales posting credits the gross charge to `salesAccount` | [post-sales-invoice](../../packages/database/supabase/functions/post-sales-invoice/index.ts), line calculation near 318 and revenue postings near 419/516: merchandise, add-ons, shipping, and tax are combined. Tax inflates revenue; shipping cannot be reported separately. |
| Already-base invoice amounts receive another FX multiplication | Sales posting near 344 and [purchase posting](../../packages/database/supabase/functions/post-purchase-invoice/index.ts) near 832. An economic base amount of 100 at foreign/base rate 1.10 becomes GL 110. This is an extra conversion of a base field, not a universal rate-squared error. Receipt matching can consequently manufacture PPV. |
| Payments, credits, and provider adapters disagree about denomination | [payment builder](../../packages/database/supabase/functions/post-payment/build-payment-journal.ts), [invoicing service](../../apps/erp/app/modules/invoicing/invoicing.service.ts), and [document-costing conversion](../../packages/ee/src/accounting/core/document-costing.ts). Payment cash is multiplied to base; invoice-base applications are compared with payment-currency totals; base costing lines are divided to foreign currency. |
| Consolidation treats Expense as a credit-side balance | `translateCompanyBalances` in [accounting.ee.service.ts](../../apps/erp/app/modules/accounting/accounting.ee.service.ts), near 4464: balanced Cash 80 / Revenue 100 / Expense 20 at identity rates produces CTA −40 instead of 0. |
| CTA is assigned by account number after report aggregation | [balance-sheet route](../../apps/erp/app/routes/x+/reports+/balance-sheet.tsx), `applyCtaByBucket`: hardcoded `3200` ignores the configured default; changing the leaf after service rollups leaves parent totals stale. |
| IC control capture includes only one journal row | Sales posting near 1286 and purchase posting near 2100 capture only the first IC receivable/payable row. A multiline invoice's other control postings cannot be eliminated from those captures. |

Already-correct behavior is the starting point: purchase line generated amounts divide supplier amounts to base; receipt header shipping already divides to base; the September consolidation RPC already returns an explicit target/source pair. Do not reintroduce earlier versions of those implementations.

## Proposed Solution

### Scope and prior specifications

This is a correction to the current accounting implementation, not a declaration of full accounting compliance. France and e-invoicing are explicitly excluded. Also excluded: new tax determination/recoverability rules, tax returns, tax-coded memo lines, actual carrier-cost accruals, cross-currency payment allocation, new refund workflows, unrealized-FX revaluation, posted CTA journals, historical equity layers, fiscal-year retained-earnings redesign, NCI, and other workstreams in #1060.

This spec supersedes the corrective design in [July FX normalization](2026-07-02-exchange-rate-convention-normalization.md), including its unresolved amount contract and proposed historical migration policy. It implements only the sales-posting separation overlapping [multi-jurisdiction tax](2026-07-03-multi-jurisdiction-tax.md), and the demonstrated reporting defects overlapping [FX/consolidation completeness](2026-07-04-fx-consolidation-completeness.md). It preserves the delivered [currency store refactor](2026-09-02-currency-exchange-rate-refactor.md).

Research: [Accounting Posting Corrections](../research/accounting-posting-corrections.md), including primary SAP, NetSuite, Xero, QuickBooks, and Rillet references. The source inventory above takes precedence over older research's descriptions of Carbon.

### Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Adoption and history | Assume no accounting users; replace incorrect formulas directly | Explicit user decision. No version discriminator, legacy arithmetic branch, correction-journal workbench, or migration of old posted balances. This does not require deleting operational data or resetting a database. |
| Customer shipping | Separate company default pointing to a Revenue leaf | Explicit user decision; consistent with NetSuite shipping-income assignment. It remains revenue, but is separate from product/service sales. |
| Sales tax | Credit existing `salesTaxPayableAccount` | Collected tax is a liability. Retain current tax bases and rates. |
| Purchase tax and freight | Preserve existing capitalization/expense classification while fixing denomination | Recoverability cannot be inferred from an amount; the broader tax spec owns that policy. |
| Transaction quotation | `r = document currency units / company base currency unit` | Matches current generated columns and currency-store contract. Document → base divides; base → document multiplies. |
| Payment and memo amounts | `payment.totalAmount`, processor fee, and `memo.amount` are in their document currency | Matches provider payment amounts and the remittance/credit amount shown to users. |
| Settlement amounts | Principal, discount, and write-off remain target-document carrying amounts in company base currency | Invoice views already deduct these fields from base balances. Make labels and all producers consistent. |
| FX credits | Attribute on-account consumption to its original payment | A party-level total cannot identify the historical rate of the credit being released. Extend the existing settlement primitive instead of adding a parallel credit ledger. |
| Currency eligibility | Cash applications require matching payment/invoice currency codes; differing rate snapshots are supported | Existing code accepts different currencies without enough information to calculate them. Refuse that unsupported input. Memo applications additionally retain the current equal-rate requirement. |
| CTA | Natural-sign translation residual, posted to the configured report account in the calculated statement | CTA reflects translation differences. Source imbalance is an error, not a reserve. No new journal-posting subsystem. |
| Tenant boundaries and RLS | Accounts are group-scoped; defaults, invoices, payments, and settlements are company-scoped | Follow actual schema, not generic table assumptions. Validate all referenced accounts/payments against those boundaries; retain existing RLS and permission scopes. No new table. |
| Services and transactions | Existing module services; Supabase reads return their normal data/error results; monetary writes use existing Kysely transactions | Preserve the established interface conventions, batch fetches, row locks, and atomic posting. Instantiate DB clients only in server/route code. |
| UI and permissions | Extend existing defaults form and payment composer using existing controls, validators, route actions, and permission gates | No new configuration surface or authorization model. |
| Compatibility | Add columns; preserve route/function/event names and existing field identities | Correct the unused accounting contract without renaming public surfaces. Update all affected callers and generated types together. No production dependency. |

### Sales posting breakdown

Calculate one named breakdown in company base currency before branching into supported direct, order-linked, stock/service, fixture, or fixed-asset sales posting. Sales raw `unitPrice`, `shippingCost`, `addOnCost`, and `nonTaxableAddOnCost` are base amounts; `converted*` values are document amounts. `taxPercent` is a fractional rate, e.g. `0.10` for 10%. G/L Account lines are purchase-only in the current model; this spec does not add them to sales.

For each normal sales line, with `q` quantity and `h` allocated header shipping:

```text
merchandiseBase = q × unitPrice
salesRevenueBase = merchandiseBase + addOnCost + nonTaxableAddOnCost
shippingRevenueBase = shippingCost + h
salesTaxBase = (merchandiseBase + shippingCost + addOnCost) × taxPercent
grossReceivableBase = salesRevenueBase + shippingRevenueBase + salesTaxBase

DR Receivables                 grossReceivableBase
CR Sales                       salesRevenueBase
CR Shipping Revenue            shippingRevenueBase
CR Sales Tax Payable            salesTaxBase
```

Preserve the current tax treatment: line shipping and taxable add-ons participate in the taxable base; non-taxable add-ons and header shipping do not. Do not introduce a new header-shipping tax switch. Preserve current allocation weights for header shipping, the equal-share fallback when all eligible weights are zero, and a deterministic residual assignment so allocations total the header charge exactly. Missing required mappings fail before writes; zero components do not create empty journal lines.

Use existing precision helpers and source invoice rounding policy. Monetary totals, provider boundaries, and editable amounts use the relevant currency's configured decimals; prices, rates, allocations, and internal ledger amounts retain internal precision. Do not globally round to two decimals or change tax calculations merely to make the journal balance. The decomposition must reconcile to the authoritative invoice view total at the same precision.

Fixed-asset disposal uses consideration attributable to the asset for sale proceeds and gain/loss. Exclude tax and separately posted shipping from those proceeds; retain gross receivables and the existing acquisition/depreciation removal and separate gain/loss accounts. Preserve the distinction between a direct invoice disposal and monetary enrichment of a disposal already owned by a shipment.

Every split row retains document references, source-line dimensions, company, and period. Preserve alignment of inserted journal lines and dimension/capture metadata; do not assume two rows per invoice line. Intercompany capture includes both `salesAccount` and `salesShippingRevenueAccount` in the existing Revenue role. Capture **every** actual IC receivable/payable journal row as Control on both seller and buyer, while retaining the first line as the existing trade matching anchor. Tax liability is not captured as Revenue. Preserve per-trade elimination, buyer cost treatment, and the existing shipment/receipt ownership of inventory and COGS postings.

Voids negate the actual recorded lines, including shipping/tax and disposal entries. Reversals never recalculate from today's account defaults or rate. Journal-reversal coverage here does not imply a general asset-lifecycle void repair; the current sales-invoice void does not restore asset state. In particular, do not reactivate a shipment-disposed asset as a consequence of changing invoice tax/shipping arithmetic.

### FX contract and settlement algebra

| Field/boundary | Denomination and rule |
| --- | --- |
| Sales raw line amounts and header shipping | Company base; no second conversion when journaling |
| Sales `converted*` fields | Invoice currency; raw base × rate |
| Purchase `supplier*` amounts | Supplier/invoice currency; divide once to derive base |
| Purchase unprefixed generated amounts | Already company base; preserve generated amounts during posting |
| `salesInvoices` / `purchaseInvoices` totals and balances | Company base; do not multiply in aging, tie-outs, or control reconciliation |
| Payment total / withheld fee | Payment currency; divide by payment snapshot to post cash/fee |
| Memo amount | Memo currency; divide by memo snapshot to post its control/reason accounts |
| Settlement applied / discount / write-off | Target carrying base; post control relief without another rate multiplication |
| Settlement `sourceAmount` | Principal consumed in the funding source's document currency; preserve it independently of rounded base relief |
| Settlement `fxGainLossAmount` | Company base; positive gain, negative loss, same signed result as the journal |
| Consolidation RPC rate | Presentation currency per source-company base currency; **multiply** local balances |

For a normal cash application, let `A` be target-base principal, `D` discount, `W` write-off, `ri` invoice foreign/base snapshot, and `rp` payment foreign/base snapshot. Payment and invoice currency codes must match.

```text
invoiceControlReliefBase = A + D + W
appliedDocumentAmount = sourceAmount  // economically A × ri, before base rounding
cashFundingBase = appliedDocumentAmount ÷ rp
AR realized gain = cashFundingBase − A
AP realized gain = A − cashFundingBase
grossBankBase = payment.totalAmount ÷ rp
feeBase = fee.amount ÷ rp
newOnAccountDocument = payment.totalAmount − sum(current-cash appliedDocumentAmount)
newOnAccountBase = newOnAccountDocument ÷ rp
```

Discount/write-off relief uses its recorded target-base amount and generates no independent FX. Processor fees affect net bank/fee postings, not the customer's gross settlement. Sum the rounded per-application FX results into the journal's gain/loss lines, with deterministic internal-precision residual handling; the stored settlement values must reconcile to that journal.

Read currency codes and rate snapshots from authoritative locked source/target rows at posting. Submitted rates are not trusted. Positive, finite rates are required, and same-base-currency documents use identity. Fix both calculation and validation: invoice caps use target-base amounts; funding caps and auto-apply compare amounts in a common, explicitly labeled currency.

The equations describe economic amounts before rounding. Persist document principal as `sourceAmount` before rounding carrying-base relief; never reconstruct it from rounded `appliedAmount × ri`. Allocate in document currency at its configured decimals, preserve internal precision for base, and use authoritative source document totals for full-payment seeding. Full application consumes the exact remaining document amount, with deterministic carrying-base rounding reconciliation; an internal sub-unit residual must not leave a fully settled invoice visibly open. At a rate of 16000, document 160.01 converts to base 0.010000625: rounding base to internal scale and converting back produces 160.00, so the second stored amount is necessary.

Purchase invoices must agree with receipt-side base valuation, including header freight and supplier-to-inventory UOM conversion. Identical receipt/invoice price, rate, freight, and quantity produce zero PPV. True price differences remain PPV; different posting snapshots must not be mistaken for an extra conversion of base values.

Memo availability is authoritatively `memo.amount - sum(effective memo-source sourceAmount)` in memo currency; divide that remainder by the memo snapshot for base display. Memo-to-invoice applications remain GL-neutral only with matching currency and rate, as supported today. Preserve staged/posted/voided status gates, party checks, and balance-increasing/reducing memo direction. Do not infer tax from a memo's gross amount.

### On-account credit funding

Add `invoiceSettlement.sourcePaymentId` for a prior payment funding a current payment's application. `paymentId` continues to identify the current/applying payment and controls when the settlement becomes effective. NULL `sourcePaymentId` means current cash; a non-NULL value means consumption of the named prior posted payment's unapplied credit.

Split an invoice application into funding rows when necessary. Allocate current payment cash first, then eligible previous payments oldest-first by posting date and ID. All funding sources must have the same company, party, side, and document currency. Keep the existing per-invoice composer UX by aggregating rows for display; assign each discount/write-off once, not to every funding row.

For a credit-funded principal `A`, consume the persisted `sourceAmount` units of the source payment's currency and release `sourceAmount / rs` base from its on-account control balance, where `rs` is that source payment's snapshot. Before rounding, `sourceAmount = A × ri`; after rounding, the independently recorded amounts govern. Realized FX is derived from this released carrying value versus `A`, using the AR/AP sign above. The current payment's rate must not revalue an earlier credit. Cash totals and fees exclude credit-funded rows.

For source payment `s`, available document credit is `s.totalAmount` minus the sum of stored `sourceAmount` on effective settlements where `(paymentId = s.id AND sourcePaymentId IS NULL) OR sourcePaymentId = s.id`. A row is effective only while its applying payment is Posted; apply the relevant cutoff in as-of queries. Exclude rows the applying payment funded from someone else's credit when calculating its own unused cash. Spendable document credit is the sum of the sources' remaining document amounts, never a base total multiplied by the new payment's rate.

Serialize consumption by locking sources in a deterministic order, recheck their remaining amounts, and persist funding rows/FX/journal/status in the same transaction. Move journal construction inside that transaction after locks; the current pre-transaction builder call cannot establish authoritative funding. Voiding the applying payment releases its allocations and reverses its recorded journal. Refuse voiding a source payment while an effective downstream application consumes it. Existing valid base-currency credit behavior remains supported, including a zero-cash payment applying existing credit.

This does not add refund or memo-target payment UI. Keep unsupported combinations explicit at service/posting boundaries; retain correct directional arithmetic in the reusable journal builder rather than interpreting `Receipt` alone as AR.

### Provider boundaries

Update provider consumers in the same delivery as posting normalization. Account-costed AP bill replay must convert base journal lines to document currency by multiplication and preserve signed variance lines, account mappings, dimensions, and total reconciliation. Apply each provider's named precision contract.

| Boundary | Required behavior |
| --- | --- |
| Shared `toTransactionCurrencyLines` | Base × Carbon rate; residue targets the document total, not a total calculated with the old inverse formula |
| Xero | `CurrencyRate = r`; keep correctly converted unit prices. Export tax/shipping/add-ons and header totals in document currency with the corresponding sales/shipping mapping. Fractional `taxPercent` receives no extra `/100`. Do not duplicate native tax postings with an extra explicit tax charge. |
| QuickBooks Online | Home-per-foreign `ExchangeRate = 1/r`; invert inbound rates before storing Carbon snapshots. Monetary payloads still use document currency. |
| Rillet bills | Send a schema-valid `exchange_rate` object with explicit base/target/date/string rate; the existing scalar is invalid under current documentation. Independently verify the directed pair with provider evidence; a self-authored serializer fixture does not prove its arithmetic direction. |
| Rillet AR_ONLY invoices | Keep the existing scope. Its documented create schema has no custom `exchange_rate` field; do not invent one or promise matching provider base translation. Preserve document components, native tax, and the shipping product/account mapping. |
| Inbound payment applications | Keep remote payment total in payment currency; resolve invoice rate/currency and convert applied document amount to target base. Remove the invented target rate 1. Reject unsupported currency pairs before writes. |

Preserve existing provider capability gates, including unsupported FX payment paths. Do not build additional provider features. Existing AR invoice adapters are item-based while AP bill adapters replay account-costed postings: test the real paths separately. Newly required Shipping Revenue mappings must produce the existing actionable unmapped-account error when absent. Preserve mapping identities and retry/idempotency behavior.

Use the existing item syncers to provision/reuse QBO Service and Rillet ONE_TIME shipping helpers mapped to Shipping Revenue, under a separate `shippingItem` mapping identity; no fake local inventory item. Native tax must remain outside revenue. QBO tax export resolves compatible existing remote sales tax codes/rates and fails with an actionable preflight warning if missing, ambiguous, or unsupported. This mapping does not create tax codes or change Carbon's tax determination.

### AR/AP carrying balances

Aging and tie-out `openInBase` use the original posted invoice control carrying
amount less effective principal, discount, and write-off relief. They do not
rederive carrying from rounded document money: a 100.004 control at r0.8 remains
100.004 base even when the document total rounds to 80. Source-payment carrying
uses original rounded gross less recorded A+FX (AR) or A−FX (AP) releases.
Document eligibility is independent; preserve positive document remainders with
zero remaining base as visible rows with `openInBase=0`. The invoice view's
`balance` remains exact document remainder divided by the invoice snapshot for
eligibility/display, rather than becoming a reconstructed ledger carrying value.

### Consolidation calculations and report integration

Only actual leaf balances participate in the following sums; exclude group subtotals and synthetic `NET_INCOME_ACCOUNT_ID`. Use account class, preserve negative balances, and do not use the report's `rootSignMultiplier` as a debit/credit conversion.

```text
sourceResidual = Assets + Expenses − Liabilities − Equity − Revenue
translatedBalance = localBalance × selectedTargetPerSourceRate
CTA = translatedAssets + translatedExpenses
      − translatedLiabilities − translatedEquity − translatedRevenue
```

Validate the source balance before translation using existing ledger precision/tolerance conventions. An actual source imbalance, invalid class, or nonfinite amount produces a company/date-specific error. A successful RPC with an empty/null rate result is also an error; applicable rates must be finite and positive. Propagate a failed subsidiary to the whole consolidated report.

Preserve the September pair-rate SQL, including identity rates, missing-pair failures, and its documented earliest-rate and closing-rate fallbacks. Do not invert its target/source rate while correcting transaction FX. Retain current balance-versus-activity semantics, synthetic income calculation, fiscal buckets, and automatic inclusion of relevant elimination entities.

Resolve the root reporting company's `accountDefault.currencyTranslationAccount` by ID, matching the root company's presentation currency. Use this mapping for both consolidated reports and an individual subsidiary translated into that currency. Validate an active Equity leaf in the same company group. A custom number/name or a different active-session company must not change the chosen account; missing/invalid mappings produce an explicit report error.

Apply each bucket's calculated CTA once, preserving any existing booked balance on that account, **before the final translated parent/root rollup**. Alternatively use one shared service helper that applies CTA and reruns existing rollups. Both single-company and consolidated branches must use that helper; screen rows, subtotals, roots, and CSV must share its result. CTA remains a computed reporting adjustment.

## Data Model Changes

### Shipping Revenue default and chart backfill

Add nullable `accountDefault.salesShippingRevenueAccount TEXT`, with an indexed FK to `account(id)`, `ON DELETE RESTRICT ON UPDATE CASCADE`. Persist a valid mapping for every existing normal company with account defaults, and initialize it for all new companies. Nullable storage preserves existing backup/import shapes; nonzero shipping cannot post without a valid mapping. Do not create incomplete defaults for elimination-company shells.

The canonical new account is:

| Attribute | Value |
| --- | --- |
| `name` | Shipping Revenue |
| Stock-chart `number` / seed key | 4040 |
| `parentId` / `parentKey` | The group's Revenue parent / `revenue` |
| `class` / `accountType` | Revenue / Income |
| `incomeBalance` / `consolidatedRate` | Income Statement / Average |
| `isGroup` / `active` | false / true |
| Identity and ownership | Database-generated account ID; existing group scope and system audit conventions |

Backfill one resolution per `companyGroupId`, then update company defaults through their company/group relationship. Preserve populated valid mappings on rerun. Reuse a compatible existing Shipping Revenue leaf without changing its number or ID. Otherwise create it under the canonical active Revenue group; for a custom chart without that named group, resolve the unique compatible group parent of the configured sales account. Never choose an arbitrary first row, a leaf named Revenue, or a different tenant's account.

Use 4040 when free. If occupied by an unrelated account, use the first unused stock revenue number in the sequence 4050, 4060, …, 4990; preserve the occupied account. An incompatible existing Shipping Revenue name, exhausted range, or ambiguous/missing Revenue parent is an explicit backfill error identifying the group. Resolve all candidates before committing the backfill, and make every step safe to rerun. Existing custom charts must not be silently reclassified.

Update [seed.data.ts](../../packages/database/supabase/functions/lib/seed.data.ts) and [seed-company](../../packages/database/supabase/functions/seed-company/index.ts). Subsidiaries joining an existing group inherit the validated parent shipping default, then fall back to a uniquely resolved compatible group shipping leaf. Number-only lookup is insufficient after a collision or custom renumbering. The dataset [bootstrap](../../packages/database/src/datasets/bootstrap.ts) consumes the canonical seed data and must be verified too.

### Settlement funding and FX snapshot

Add nullable `invoiceSettlement.sourcePaymentId TEXT` with an indexed same-company FK `(sourcePaymentId, companyId) → payment(id, companyId)` using RESTRICT on delete; add the corresponding unique key to `payment` without changing its existing primary key. It is allowed only for a payment-sourced settlement, cannot equal `paymentId`, and references a same-party/currency posted source payment. Enforce those relationships through authoritative transaction validation and the existing settlement access rules; all queries include company scope. The column does not create a new target or change the meaning of `paymentId`.

Add `invoiceSettlement.sourceAmount NUMERIC`, nonnegative and nullable for pre-existing/draft rows, with a required authoritative value on posting. It stores principal consumed in source document currency for current cash, prior-payment credit, and memo sources; it is zero for discount/writeoff-only rows. Save/preview may derive it, but posting computes/validates it with locked parents and persists it alongside target-base `appliedAmount`. Availability and source caps sum this field; they never reconstruct document money from rounded base. No historical backfill of posted settlements is required under the user's adoption assumption.

Settlement completion uses the invoice currency's configured decimals and independently stored document principal. A positive document remainder remains payable even below one base-currency cent or the internal ledger rounding unit. Invoice views expose that remainder divided by the invoice rate without rounding away the remainder; posted ledger amounts retain internal precision. Broaden `invoiceSettlement_anyComponent_check` to allow positive `sourceAmount` when rounded base principal is zero, and keep that terminal application valid through the composer, save, and post paths. Missing currency precision configuration is an actionable posting error; draft invoice views must not disappear because configuration is absent.

Change `invoiceSettlement.fxGainLossAmount` from its current generated expression to an ordinary NUMERIC posting snapshot, retaining its name and values rather than dropping the column. `ALTER COLUMN ... DROP EXPRESSION` is the intended migration operation. Draft previews use the shared authoritative calculation; posting stores its result atomically with the actual journal. Memo-only same-rate applications store zero. Never accept a client-provided FX gain/loss amount as authoritative. No generated expression may depend on mutable parent values, and no legacy-expression branch is needed under the user's adoption assumption.

Document denominations with SQL comments and application types. Recreate affected aging/tie-out RPCs from their **latest** definitions in forward-dated migrations. Preserve existing invoice status, the base-table `Paid`/`datePaid` legacy guards, cutoff-date, and staged/voided settlement logic unrelated to the arithmetic correction. There is no `legacyPaidAmount` column in the current schema. Do not rewrite base generated purchase fields into document currency.

## API / Service Changes

| Area | Existing integration points and required changes |
| --- | --- |
| Account defaults | [accounting.models.ts](../../apps/erp/app/modules/accounting/accounting.models.ts): add shipping field to `defaultIncomeAcountValidator`, which feeds the merged validator. [defaults route](../../apps/erp/app/routes/x+/accounting+/defaults.tsx) and `updateDefaultIncomeAccounts` must retain/persist it and validate group/class/active/leaf eligibility. Missing field on an older settings payload preserves the stored default. |
| Invoice posting | `post-sales-invoice/index.ts`, `post-purchase-invoice/index.ts`: central component breakdown, corrected base postings, fixed-asset amounts, IC captures, references/dimensions. Verify `post-receipt/index.ts` stays correct. |
| Payments/memos | `post-payment/index.ts`, `build-payment-journal.ts`, `post-memo/index.ts`, `build-memo-journal.ts`, and `invoicing.service.ts`: funding allocation, locks, rate validation, stored FX, memo availability, balance caps, void/retry behavior. Share pure conversion/funding calculations between preview and posting. |
| Composer | [new payment route](../../apps/erp/app/routes/x+/payments+/new.tsx), [payment detail route](../../apps/erp/app/routes/x+/payments+/$paymentId.tsx), application/credit actions: seed document cash from invoice-base balance × invoice snapshot; use source attribution and explicit currencies throughout. |
| Reports | `accounting.ee.service.ts`, `balance-sheet.tsx`, latest AR/AP tie-out and aging RPCs. Correct base amounts, CTA signs, mapping, errors, and rollups through actual callers. |
| Integrations | `packages/ee/src/accounting/core/document-costing.ts`, `payment-application.ts`, and Xero/QBO/Rillet `entities/{bill,invoice,payment}.ts`, serializers/models, and their existing tests. |

Keep changes inside existing module/service organization. Edge-compatible pure helpers may live under the existing shared functions directory and use the current precision exports; do not introduce a new financial arithmetic dependency. Fix stale comments/tests that encode the inverted convention.

## UI Changes

- Add **Shipping Revenue** to the Sales & Revenue section of [AccountDefaultsForm](../../apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx). Use the existing selector with eligible Revenue leaves; keep it distinct from `salesAccount`. Explain that it receives shipping charged to customers. Carrier expense configuration remains separate.
- Label payment totals and source credit in payment currency. Label invoice balance/application/discount/write-off inputs in their actual base currency, with invoice-currency equivalents where useful. The composer must not display a base value under a foreign currency symbol. Auto-apply budgets in document currency and converts each selected invoice using its own snapshot.
- Show only currency-eligible invoice/credit choices and surface the existing actionable errors for invalid mappings, rates, or caps. Repeat validation on save and post.
- Update payment application/history displays to aggregate split funding rows and show base-currency realized FX consistently. Consolidated reports and CSV use corrected service results. Translate new/changed user-facing strings through the existing Lingui workflow.

## Acceptance Criteria

All amounts below are exact expected economic amounts before applicable precision rounding. Every posted journal must also pass the existing debit/credit balance invariant using natural-balance sign conversion.

### Defaults and invoice components

- [x] Fresh group: Shipping Revenue 4040 is an active Revenue leaf under Revenue, Average translated, and every normal company's shipping default resolves to its ID.
- [x] Existing group/subsidiary: backfill and seed both use the compatible existing account; custom numbers and subsequent default customization survive reruns. Occupied 4040 allocates the next free number; no unrelated account changes. Ambiguous parents/incompatible names return explicit errors without a partial backfill.
- [x] The settings form saves/reloads the new default. Cross-group, inactive, group, wrong-class, or same-as-sales mappings are refused server-side.
- [x] Base USD/document EUR at `r=0.8`: merchandise 100, line shipping 10, taxable add-on 20, non-taxable add-on 3, tax 10%, header shipping 5 produces DR AR **151**, CR Sales **123**, CR Shipping **15**, CR Tax **13** USD. Document total is **120.80 EUR**. No journal component is multiplied by 0.8 again.
- [x] Zero tax/shipping, all-zero allocation weights, fractional quantities/rates, and supported direct/order-linked stock/service/fixture lines use the same decomposition and correct dimensions. Tax + component sum ties to the invoice view. Purchase G/L Account lines retain their chosen account and correct base cost.
- [x] Asset carrying value 70 sold for 100 plus shipping 10 and tax 11: AR 121, shipping revenue 10, tax liability 11, disposal proceeds 100, gain 30. Cover direct disposal and shipment-linked monetary enrichment; void negates exact recorded journal postings and leaves shipment-owned disposal state intact.
- [x] Multiline taxed IC invoices with shipping capture every seller/buyer control row, so matched IC AR/AP balances eliminate completely. Shipping revenue eliminates on its actual account; external tax liability and non-recoverable buyer tax cost remain. Two trades with different margins retain per-trade allocation.

### FX and settlement

- [x] Invoice 110 document units at `r=1.10` posts control **100 base**. Matching receipt/invoice prices, freight, rates, and non-1 UOM conversion produce **zero PPV**; cost ledger and fixed-asset acquisition agree with base valuation.
- [x] Paying 110 at `ri=rp=1.10`, `A=100`: bank 100, control relief 100, FX 0.
- [x] Paying 110 at `ri=1.10`, `rp=1`: bank 110; AR gain 10 / AP loss 10. At `rp=1.25`, bank 88; AR loss 12 / AP gain 12.
- [x] `A=80`, discount 10, `ri=1.10`, `rp=1`, payment 88: control relief 90, cash 88, discount 10, AR FX gain 8, invoice remaining base 10. Write-offs follow their correct AR/AP accounts and the same denomination rule.
- [x] Payment 132, invoice application base 100, `ri=rp=1.10`: bank 120, invoice relief 100, unapplied credit **22 document / 20 base**.
- [x] Two invoices, base 100 each, at `ri=1.10` and `1.20`; payment 230 at `rp=1.15`: cash 200, total control 200, net FX 0 after reconciled rounding. Auto-apply/seeding gives the same result as manual entry.
- [x] A prior unapplied receipt of 110 at rate 1.10 carries credit base 100. Apply it with a zero-cash payment to an invoice of 110 at rate 1.25 (base 88): release the original credit 100, relieve invoice 88, AR gain 12. Changing the applying payment's rate does not change those values. Partial/multi-source use, concurrent consumption, source-void refusal, and applying-payment void/retry preserve exact availability.
- [x] At rate 16000 with a two-decimal source currency, an application consuming 160.01 records `sourceAmount=160.01` even though carrying base rounds to 0.01000. Full application leaves document availability zero and the invoice settled; void restores 160.01. Repeated partial allocations preserve the source total exactly. Cover mixed current cash and two prior sources with different rates; a split never duplicates discount/writeoff and persisted FX sums match the GL.
- [x] On that same 160.01 invoice, applying only 160.00 leaves 0.01 document units payable; a final 0.01 source application can close it even when its base principal rounds to zero. Views, composer, constraints, and posting agree on this completion rule.
- [x] Memo 55 at `r=1.10` posts and provides **50 base** credit; applying it to an eligible invoice deducts 50 base. Draft/posted/voided status gates remain correct. Different-currency cash applications and different-rate memo applications fail without writes.
- [x] Fee 3.30 on receipt 110 at `rp=1.10`: gross 100 base, fee 3, net bank 97. Receipt/disbursement directional tests and existing credit/discount/write-off tests remain balanced.
- [x] Invalid/nonfinite/zero rates, forged rate snapshots, over-application, duplicate posting, concurrent settlement, and changed account defaults cannot create incorrect or duplicate journals.
- [x] AR/AP aging and tie-outs reconcile invoice balances, memos, unapplied credits, applications, and control GL in base currency at the same cutoff. No extra rate multiplication; existing legacy-paid/status filters remain intact.
- [x] Provider fixtures represent base 100/document 110 with Xero rate 1.10 and QBO rate `1/1.10`. AP lines and AR shipping/tax totals equal the document, inbound settlements become 100 base, and Rillet's rate object validates against its schema (directed-pair arithmetic remains an inference pending independent provider evidence). Unmapped accounts fail before sending; retries retain mapping identities.

### Consolidation

- [x] Cash 80 / Revenue 100 / Expense 20 at identity rates yields **CTA 0** and unchanged balances. Cash −20 / Expense 20 also yields CTA 0.
- [x] Cash 80 at closing rate 2, Revenue 100 and Expense 20 at average 1.5: translated cash 160, income 120, **CTA +40**, total Equity including CTA 160.
- [x] Source Cash 79 / Revenue 100 / Expense 20 returns a source-imbalance error. Group/synthetic-income rows do not affect the source test or CTA.
- [x] Missing/empty/null rate payloads and invalid applicable rates fail translation; a failed subsidiary fails the whole consolidated result. Existing SQL missing-pair errors still reach the UI.
- [x] Root default pointing to a renamed/non-3200 CTA leaf is respected even when active-company and child defaults differ. Invalid/missing mapping fails explicitly.
- [x] Multiple buckets, single-subsidiary translation, and consolidation all add CTA once and roll up its leaf, intermediate Equity groups, root totals, and exported rows consistently. Preserve already-booked CTA balances, synthetic income, and elimination-entity inclusion.

### Implementation verification

Use meaningful failing numerical regressions before production changes, then run them through the actual builders/services and posting transactions. Add migration/backfill and database integration fixtures for schema-dependent behavior; pure algebra tests alone do not prove transaction/status/capture correctness. Update the three stale accounting-period mocks identified by the audit if that suite is used; do not hide those failures.

The implementation plan should use these existing entry points, extended with the new focused tests:

```bash
pnpm --filter @carbon/config build
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.periods.test.ts app/modules/accounting/ui/Reports/executivePnl.test.ts app/modules/accounting/ui/Reports/pivotData.test.ts
pnpm --filter @carbon/ee exec vitest run src/accounting/core/document-costing.test.ts src/accounting/providers
deno test --no-lock --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/post-payment/post-payment.test.ts packages/database/supabase/functions/post-memo/post-memo.test.ts
pnpm run generate:types
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/database
pnpm db:check:datasets
pnpm db:check:backups
```

Apply newly written migrations to the authorized local stack before generating types and running schema-dependent gates; never rebuild/reset the database to test this work. Run scoped Biome validation and translation checks for changed UI/locale files. Exercise a complete invoice → payment/credit → report → void sequence against the running app when browser verification is authorized. Fixing tests that currently assert the wrong FX convention requires new economic expectations, not simply changing their arithmetic operator.

The plan records the actual implementation commits and verification results. Local numerical, transaction, SQL, provider-payload and typechecking gates have passed; connected-provider acceptance remains a separate verification boundary.

## Verification limits and follow-up work

- Local provider tests prove payload amounts, account mapping, native tax, and
  retries through the production fetch/map paths. They do not prove a connected
  provider accepted the payload. Confirm the Rillet bill rate direction and QBO
  US tax-catalog compatibility in provider sandboxes before enabling those paths.
  Rillet AR_ONLY does not expose a request FX snapshot; its base translation is
  provider-owned.
- Memo applications retain the agreed GL-neutral design. Changing defaults between
  invoice and memo posting can leave offsetting balances in their original control
  accounts even though the aggregate historical-control tie-out is correct.
- Actual direct fixed-asset invoice void reverses the invoice journal but leaves
  the asset acquisition state Active. This existing lifecycle gap is outside this
  posting/FX/consolidation correction and needs a separate fixed-asset void design.

## Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Shipping split changes row counts and downstream metadata | High | Test every sales branch, fixed-asset proceeds, dimensions, per-trade IC captures, and exact reversals. |
| Only some FX consumers adopt the new contract | High | Deliver invoice/payment/memo/report/provider normalization together; cover both read and write boundaries with non-identity fixtures. |
| Previous credit is silently valued at the applying payment's rate | High | Persist original funding attribution, release its original carrying amount, and test concurrent/partial/void cases. |
| Custom account numbering defeats migration or subsidiary creation | Medium | Group-scoped semantic resolution, collision-safe numbering, idempotency, and existing-group seed tests. |
| Rounding masks a real imbalance | High | Retain named precision policies, reconcile component totals, and distinguish deterministic rounding residue from economic FX. |
| Corrected CTA leaf leaves report totals stale | High | Apply through a shared service path with final rollups and identical CSV rows. |
| Accounting has no users is an assumption, not a production-data audit | Low for this design | User explicitly accepted this premise. Build no legacy migration machinery and perform no data deletion as part of this spec task. |

## Open Questions

All design questions are resolved; unchecked boxes above are implementation acceptance criteria.

- [x] Where should customer shipping post? — **User:** add a shipping-revenue default account column, create an account under Revenue, and backfill defaults. Use `salesShippingRevenueAccount`; 4040 is the next free stock revenue number verified in current seeds.
- [x] How should old accounting errors be migrated? — **User:** “we can assume that no one is use accounting yet and just fix it.” Correct the contract directly; omit historical restatement, calculation versions, and open-balance cutover tooling.
- [x] Are France/e-invoicing included? — **User:** explicitly excluded; focus on the three selected defects.
- [x] Which monetary fields are base versus foreign? — **Code/research:** retain base invoice views/settlements, document-currency payment/memo totals, and foreign-per-base transaction rates. Preserve the independently defined target-per-source consolidation quotation.
- [x] Do we need a broader tax, cross-currency, refund, or consolidation subsystem? — **Code/research and selected scope:** no. Separate existing sales components, correct currently representable settlement math, refuse unsupported currency combinations, and fix CTA through current reporting paths. Existing memo rate restrictions and provider capability gates remain.
- [x] How do prior overpayments retain their rate and exact document amount? — **Code-derived decision:** extend the existing settlement with original-payment attribution and document principal, split funding rows, and release recorded carrying value. Separate source/base amounts prevent a proven large-rate rounding loss. Source and target calculations also retain remaining booked base independently; a final application takes the residual carrying value, so repeated rounded releases reconcile to the original posting. No separate credit ledger or historical migration framework.

## Changelog

- 2026-09-07: Created from the verified accounting audit and primary-source research. Recorded the user's shipping-account/backfill decision, explicit exclusion of France/e-invoicing, and no-accounting-users assumption. Resolved denominations, prior-credit funding, tax/shipping separation, provider boundaries, CTA arithmetic/mapping/rollups, and numerical acceptance criteria. Implementation remains unstarted.
- 2026-09-07: Linked the 18-task implementation plan. Clarified positive document remainders below base rounding precision, source-only terminal settlements, provider-native shipping/tax mappings, and the documented Rillet AR_ONLY FX limitation. These clarify the corrected contract; no implementation or migration has run.

- 2026-09-08: Implemented the 18-task plan locally. Shipping defaults/backfill, sales components, base purchase costs, exact document funding and original controls, provider boundaries, AR/AP cutoffs and consolidation CTA are covered by committed regressions. Verification includes 27 repository test tasks, 78 ERP payment cases, 84 live SQL report cases, independent transaction/concurrency tests, scoped typechecks, four datasets, backup compatibility, and actual browser/HTTP workflows. Browser testing also corrected payment currency formatting and manual partial-document inference. Provider acceptance and the separate fixed-asset void lifecycle remain the explicit follow-ups above. No production deployment or database reset occurred.

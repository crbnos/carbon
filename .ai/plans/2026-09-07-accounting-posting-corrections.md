# Accounting Posting Corrections — implementation plan

**Spec:** [.ai/specs/2026-09-07-accounting-posting-corrections.md](../specs/2026-09-07-accounting-posting-corrections.md)
**Research:** [.ai/research/accounting-posting-corrections.md](../research/accounting-posting-corrections.md)
**Branch:** `assess-issue-against-code`; base `origin/main`
**Source baseline:** `0a9aef2444b04f0a0f0ade6f99dcd8e60aa3ec30`
**Status:** approved by user on 2026-09-07; execution in progress.

The user approved Shipping Revenue account/default/backfill and explicitly allowed assuming accounting has no users. Implement one corrected contract. Do not add legacy calculation versions, historical correction tools, France/e-invoicing, a tax engine, or new refund/cross-currency workflows. Preserve operational records and the existing database.

All commands run from the repository root unless their command selects a package directory. Run red → green numerical regressions for each monetary change. Package name is `erp`, not `@carbon/erp`; the ERP/database packages have no `test` script. Never use a passing empty test run as verification. Do not publish a partially normalized posting chain.

Read before execution: the linked spec, `.ai/lessons.md`, `BACKWARD_COMPATIBILITY.md`, `apps/erp/app/modules/accounting/AGENTS.md`, `packages/database/AGENTS.md`, `packages/ee/AGENTS.md`, and the accounting/numeric/database/service/form rules in `.claude/rules/`. Current edge-to-Node precision re-export is `packages/utils/src/precision.ts`.

## Progress

- [x] Task 1: Establish the accounting regression baseline.
- [x] Task 2: Add shipping defaults and settlement funding schema.
- [x] Task 3: Generate types after the schema migration.
- [x] Task 4: Wire shipping defaults and company seeding.
- [x] Task 5: Implement exact currency and funding calculations.
- [x] Task 6: Split sales invoice postings and seller IC captures.
- [x] Task 7: Normalize purchase postings and buyer IC captures.
- [x] Task 8: Post payments and memos with authoritative funding.
- [x] Task 9: Normalize the payment composer and service readers.
- [x] Task 10: Normalize AP provider and inbound-payment boundaries.
- [x] Task 11: Export sales components through provider-native mappings.
- [x] Task 12: Correct translation arithmetic and error handling.
- [x] Task 13: Apply CTA by configured account and reroll report totals.
- [x] Task 14: Normalize invoice balances and AR/AP reporting SQL.
- [x] Task 15: Generate types after the reporting migration.
- [x] Task 16: Prove database and posting transaction invariants.
- [x] Task 17: Run integration gates and update technical guidance.
- [x] Task 18: Verify the user workflows in the browser.

## Dependencies

`1 → 2 → 3`; Tasks 4 and 5 follow 3 and can run independently. Task 6 follows 4–5; Task 7 follows 6 for the shared IC helper. Task 8 follows 5–7. Tasks 9 and 10 follow 8 and can run independently; Task 11 follows 10. Tasks 12–13 are independent of the posting work, but share `accounting.ee.service.ts` with Task 4: serialize edits to that file. Task 14 follows 8–9; Task 15 immediately follows 14. Task 16 follows 4–15; Task 17 follows 16; Task 18 is the final verification.

Only the final integrated result is deployable. Per-task commits are local review units, not independent monetary releases. Use `/check-and-commit` during approved execution, commit only the task's files, and retain failures as unfinished checklist items.

## Task 1: Establish the accounting regression baseline

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.periods.test.ts` — repair missing timezone lookup mocks.
- Create: `.context/accounting/run-local-check.ts` — gitignored command launcher for local SQL/concurrency checks.
- Read: `apps/erp/vitest.config.ts`, `packages/config/vitest.mts`, `packages/config/package.json`.

**Steps:**
1. Record `git status --short` and `git rev-parse HEAD`. Preserve pre-existing audit/spec/research edits. If posting code has changed since the source baseline, review that diff before applying this plan; do not overwrite concurrent work.
2. Build the already-declared shared test configuration with `pnpm --filter @carbon/config build` so `@carbon/ee` can resolve its Vitest config.
3. Run the period tests and record the existing failures. Add the mocked `.maybeSingle()` company-timezone lookup and active-integration response required by the real period helper; retain the expected timezone and period behavior. Do not replace period calls with a stub that bypasses the behavior under test.
4. Run the baseline below. Existing payment tests currently encode wrong FX expectations; their current pass is a baseline, not a correctness verdict.
5. Save the following launcher to the path above. It loads the same environment files as the generator, refuses a nonlocal database, and passes credentials only in the child environment. Every database verification command below uses it; an unavailable local stack is a prerequisite failure.

```ts
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("An existing local SUPABASE_DB_URL is required");
const connection = new URL(dbUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname)) {
  throw new Error("An existing local SUPABASE_DB_URL is required");
}
const [command, ...args] = process.argv.slice(2);
if (!["psql", "deno", "pnpm", "git"].includes(command ?? "")) throw new Error("Expected a local accounting verification command");
const result = spawnSync(command, args, {
  env: {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port || "5432",
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "5"
  },
  stdio: "inherit"
});
if (result.error) throw new Error("Could not launch local accounting check");
process.exit(result.status ?? 1);
```

**Verify:**
```bash
pnpm --filter @carbon/config build
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.periods.test.ts app/modules/accounting/ui/Reports/executivePnl.test.ts app/modules/accounting/ui/Reports/pivotData.test.ts
deno test --no-check --no-lock --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/post-payment/post-payment.test.ts packages/database/supabase/functions/post-memo/post-memo.test.ts
# Expected: config builds; all selected tests pass, including all 31 period tests.
```

**Out of scope:** unrelated period redesign, broad test cleanup, database resets.

## Task 2: Add shipping defaults and settlement funding schema

**Depends on:** Task 1
**Files:**
- Create: the migration emitted in `packages/database/supabase/migrations/` by `pnpm db:migrate:new accounting_posting_corrections`; record its actual CLI-generated path in this task when executing.
- Create: `packages/database/supabase/tests/accounting-shipping-backfill.test.sql` — rollback-only schema/backfill cases.
- Copy from (precedent): `packages/database/supabase/migrations/20260717031529_split-asset-gain-loss-disposal-accounts.sql` for existing account fields; `packages/database/supabase/tests/intercompany-elimination.test.sql` for rollback assertions only.

**Steps:**
1. Create the migration with the command above. Do not hand-pick/backdate its timestamp. If that suffix already exists, inspect and reuse the task's existing file instead of creating a second migration. Its version must sort after the newest migration on `origin/main`.
2. Copy the **complete SQL in Appendix A** into that file. The exact extraction command below identifies the unique CLI-created file, so the plan does not invent a future timestamp.
3. Before changing a constraint, confirm the current table shape agrees with Appendix A. If the tables/keys differ, STOP and report the exact difference; do not drop an existing constraint to force this SQL through.
4. Write rollback fixtures for fresh charts, two companies sharing a chart, a custom-number Shipping Revenue leaf, occupied 4040, rerun/custom-default preservation, and ambiguous/incompatible parent/name errors. Assert that one failed group rolls back all account/default changes. Exercise new same-company funding FK, self-funding check, nonfinite/negative source amount refusal, and a source-only minor-unit settlement.
5. In the test, isolate setup in a transaction and execute the backfill portion in a nested transaction/savepoint; do not run an embedded migration COMMIT inside the fixture. Copy the seed mechanism, not the old harness's hardcoded customer/account selection. Never test by changing a real company's defaults.
6. Apply with `pnpm db:migrate` against the existing local development stack. If the local database is unavailable, report that prerequisite; do not reset it or substitute a production connection. Continue immediately to Task 3 before typechecking.

**Verify:**
```bash
python3 - <<'SQL_COPY'
from pathlib import Path
import re
p=Path('.ai/plans/2026-09-07-accounting-posting-corrections.md').read_text()
matches=re.findall(r'^<!-- schema-sql:start -->\n```sql\n(.*?)\n```\n<!-- schema-sql:end -->$',p,re.M|re.S)
assert len(matches)==1
sql=matches[0]+'\n'
targets=list(Path('packages/database/supabase/migrations').glob('*_accounting_posting_corrections.sql'))
assert len(targets)==1, targets
targets[0].write_text(sql)
print(targets[0])
SQL_COPY
pnpm db:migrate
# Expected: one forward migration applied; shipping accounts/defaults populated without changing existing accounts.
```

**Out of scope:** NOT NULL on the shipping default, historical settlement backfill, new tables, changes to RLS/permission scopes, operational-data deletion.

## Task 3: Generate types after the schema migration

**Depends on:** Task 2
**Files:**
- Regenerate: `packages/database/src/types.ts` and `packages/database/supabase/functions/lib/types.ts` through the repository generator; include any other files it actually emits.
- Read: `scripts/generate-db-types.ts` — authoritative output paths, not hand-edited type declarations.

**Steps:**
1. Run generation after the migration. Verify output includes `salesShippingRevenueAccount`, `sourcePaymentId`, `sourceAmount`, and writable `fxGainLossAmount`.
2. Do not change nullable generated fields to required by hand. Posting requirements belong in validators and server code.
3. Run the rollback fixture from Task 2, with the existing local connection loaded through the project's environment tooling. Never print the connection string.

**Verify:**
```bash
pnpm run generate:types
rg -n 'salesShippingRevenueAccount|sourcePaymentId|sourceAmount' packages/database/src/types.ts packages/database/supabase/functions/lib/types.ts
pnpm exec tsx .context/accounting/run-local-check.ts psql -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/accounting-shipping-backfill.test.sql
# Expected: generated fields found; named PASS notices, ALL SCENARIOS PASSED, ROLLBACK, exit 0.
```

**Out of scope:** hand-edited generated types; skipping generation because `db:migrate` may also run it.

## Task 4: Wire shipping defaults and company seeding

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — 4040 account and default.
- Modify: `packages/database/supabase/functions/seed-company/index.ts` — existing-group semantic/default resolution.
- Create: `packages/database/supabase/functions/seed-company/shipping-default.ts`, `packages/database/supabase/functions/seed-company/shipping-default.test.ts` — pure validated selection from batch-loaded records.
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts`, `apps/erp/app/modules/accounting/accounting.ee.service.ts`, `apps/erp/app/routes/x+/accounting+/defaults.tsx`.
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx`.
- Create: `apps/erp/app/modules/accounting/accounting.defaults.test.ts`.
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` Sales & Revenue section and `apps/erp/app/components/Form/CurrencyNumber.tsx`/existing Combobox usage; no new form component.

**Steps:**
1. Seed Shipping Revenue with key/number `4040`, `parentKey: "revenue"`, class Revenue, type Income, Income Statement, Average, active leaf. Add `salesShippingRevenueAccount: "4040"` to `accountDefaults`.
2. For existing-group seeding, batch-load the parent's default and chart once. Add `resolveShippingDefault({parentDefaultId, accounts, companyGroupId}): string` in the edge helper: use the valid parent's mapping first; otherwise require exactly one compatible Shipping Revenue leaf. Never select an unrelated 4040 or fall back to Sales. Test a parent mapped to a custom-number leaf.
3. Add the optional incoming field to `defaultIncomeAcountValidator` (merged full validator inherits it). Older payload omission preserves the stored mapping. A present empty/invalid mapping is a validation error. On the new form require a selection.
4. Extend `updateDefaultIncomeAccounts(client, defaultAccounts)` in place: resolve company group and proposed account, validate active Revenue/Income Statement leaf in that group and distinct from the effective sales default; return a normal data/error result. Validate before either defaults write in the route so an invalid shipping account does not partially save the other section.
5. Add the Shipping Revenue row to the current Sales & Revenue group. Use existing eligible leaf data and exclude the currently selected Sales account; retain authoritative server validation.
6. Test default omission, valid save/reload, invalid class/tenant/group/inactive/same-as-sales, new-group seed and custom-number existing-group seed. Verify dataset bootstrap consumes the new canonical seed data without a special duplicated default map.

**Verify:**
```bash
deno test --no-lock --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/seed-company/shipping-default.test.ts
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.defaults.test.ts
pnpm db:check:datasets
# Expected: both focused suites pass; every dataset actually runs and applies successfully, not a skipped check.
```

**Out of scope:** replacing the account-defaults UI, new carrier-expense configuration, rewriting other custom account mappings.

## Task 5: Implement exact currency and funding calculations

**Depends on:** Task 3
**Files:**
- Create: `packages/database/supabase/functions/shared/accounting-currency.ts`, `packages/database/supabase/functions/shared/accounting-currency.test.ts`.
- Create: `packages/database/supabase/functions/shared/payment-funding.ts`, `packages/database/supabase/functions/shared/payment-funding.test.ts`.
- Create: `packages/utils/src/accounting-currency.ts`, `packages/utils/src/payment-funding.ts`.
- Modify: `packages/utils/src/index.ts` to re-export the corresponding pure edge helpers using the existing precision re-export pattern.
- Copy from (precedent): `packages/database/supabase/functions/shared/precision.ts`, `packages/utils/src/precision.ts`.

**Steps:**
1. Add `toBaseAmount(documentAmount: number, foreignPerBaseRate: number): number` and `toDocumentAmount(baseAmount: number, foreignPerBaseRate: number, currencyDecimals: number): number`. Validate finite inputs/positive rate. Use shared `round` at named internal/document boundaries; never infer the rate's direction from its magnitude.
2. Define the funding API below. Inputs are already company/party/currency-validated by the caller. The helper rechecks positive finite rates, nonnegative finite amounts, unique IDs, document precision and target/source caps. `requestedDocumentPrincipal` carries an exact full-remainder choice through the base-currency UI; it is never trusted without authoritative target validation. Return `newOnAccountDocument` from unused current cash only.
3. Allocate current cash first, prior sources by `(postingDate,id)`; split by source and invoice. Full allocations use exact document remainder and authoritative remaining carrying base. Track both source and target carrying remainders independently; partial releases round document/rate, and final exhaustion releases the recorded remainingBase. Assign discount/write-off once; allow a final positive document principal whose rounded base relief is zero. Do not infer remaining document principal from rounded base.
4. Add `calculateSettlementFx({appliedAmount, sourceAmount, sourceExchangeRate, isAR, sourceBaseAmount?}): number`; compare the recorded target-base principal with funding base, round once, and return the signed snapshot. The optional sourceBaseAmount defaults to rounded sourceAmount/sourceExchangeRate; the allocator supplies the actual released carrying base, using remainingBase on final source exhaustion. Keep source/memo current-currency equality a validated precondition.
5. Tests cover every numerical payment example in the spec, source amount 160.01 at rate 16000, multiple partial allocations, two prior rates, mixed current cash/credit, discount-only rows, invalid inputs, and deterministic input-order-independent source selection.

```ts
type FundingSource = {
  paymentId: string;
  postingDate: string; // ISO date; stable lexical ordering, then paymentId
  exchangeRate: number;
  remainingDocument: number;
  remainingBase: number; // original rounded source carrying value minus recorded releases
};
type FundingRequest = {
  targetId: string;
  targetExchangeRate: number;
  remainingDocument: number;
  remainingBase: number;
  requestedDocumentPrincipal: number;
  discountAmount: number; // target base
  writeOffAmount: number; // target base
};
type FundingApplication = {
  targetId: string;
  sourcePaymentId: string | null;
  sourceAmount: number;
  sourceExchangeRate: number;
  targetExchangeRate: number;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number;
};
declare function allocatePaymentFunding(input: {
  currentPayment: FundingSource;
  priorSources: FundingSource[];
  requests: FundingRequest[];
  currencyDecimals: number;
  isAR: boolean;
}): {
  applications: FundingApplication[];
  newOnAccountDocument: number;
  sourceRemainders: Array<{paymentId: string; remainingDocument: number; remainingBase: number}>;
};
```

**Verify:**
```bash
deno test --no-lock --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/shared/accounting-currency.test.ts packages/database/supabase/functions/shared/payment-funding.test.ts
# Expected: all economic/precision fixtures pass, including exact exhaustion and restoration of 160.01 source units.
```

**Out of scope:** a second rounding library, new currency-store semantics, cross-currency allocation.

## Task 6: Split sales invoice postings and seller IC captures

**Depends on:** Tasks 4–5
**Files:**
- Modify: `packages/database/supabase/functions/post-sales-invoice/index.ts`.
- Create: `packages/database/supabase/functions/shared/sales-posting-amounts.ts`, `packages/database/supabase/functions/shared/sales-posting-amounts.test.ts`.
- Create: `packages/utils/src/sales-posting-amounts.ts`.
- Modify: `packages/utils/src/index.ts` to re-export the shared pure amount helper for provider use.
- Create: `packages/database/supabase/functions/shared/intercompany-capture.ts`, `packages/database/supabase/functions/shared/intercompany-capture.test.ts`.
- Copy from (precedent): `packages/database/supabase/functions/post-payment/build-payment-journal.ts` for pure construction and natural debit/credit helpers.

**Steps:**
1. Add `calculateSalesPostingAmounts({quantity,unitPrice,shippingCost,addOnCost,nonTaxableAddOnCost,taxPercent,allocatedHeaderShipping}): {salesRevenueBase,shippingRevenueBase,salesTaxBase,grossReceivableBase}` and a deterministic header allocator. Preserve current line/header tax bases and zero-weight equal allocation.
2. Replace gross-to-sales posting in all supported sales branches with the component breakdown. Remove the extra invoice-rate multiplication. Require Sales/Shipping/Tax defaults only for nonzero relevant components and validate their account classes before writing.
3. Keep gross AR. Asset sale proceeds exclude shipping/tax; preserve direct disposal versus shipment-owned enrichment, acquisition/depreciation removal, and gain/loss accounts. Do not add sales G/L lines or asset-lifecycle void repair.
4. Keep a common line+metadata construction path so references/dimensions and returned IDs stay aligned despite added rows. Void still negates recorded rows exactly.
5. Add `classifyIntercompanyPostingLines(lines, metadata, accounts)` returning references/roles from actual emitted rows. Seller Revenue includes Sales and Shipping; every IC AR row is Control; Tax is excluded from Revenue. Preserve the first control ID as the trade matching anchor. Test this helper through the poster's actual line inputs; do not reconstruct roles from a blanket account-class guess.
6. The seller's `intercompanyTransaction.amount` is labeled with invoice currency while its current quantity × unit-price + shipping inputs are base. Convert that existing matching basis once to document currency; preserve which components the matching basis includes. Test its amount/currency against the buyer capture.
7. Prove the 151/123/15/13 fixture, disposal 121/100/10/11/gain30, zero components, header residuals, supported line types, dimensions and multiple control captures. The production helper must construct the actual charge journal rows/metadata consumed by the poster, so tests can assert their account/debit/credit effects; testing a disconnected arithmetic function alone is insufficient.

**Verify:**
```bash
deno test --no-lock --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/shared/sales-posting-amounts.test.ts packages/database/supabase/functions/shared/intercompany-capture.test.ts
# Expected: component, disposal, allocation, metadata and seller capture regressions pass through imported production helpers.
```

**Out of scope:** new tax policy, carrier expense accruals, sales G/L-account support, general asset void repair.

## Task 7: Normalize purchase postings and buyer IC captures

**Depends on:** Tasks 4–6
**Files:**
- Modify: `packages/database/supabase/functions/post-purchase-invoice/index.ts`.
- Create: `packages/database/supabase/functions/post-purchase-invoice/purchase-posting-amounts.ts`, `packages/database/supabase/functions/post-purchase-invoice/purchase-posting-amounts.test.ts`.
- Modify: `packages/database/supabase/functions/shared/intercompany-capture.test.ts` for buyer inputs.
- Read: `packages/database/supabase/functions/post-receipt/index.ts`, `packages/database/supabase/functions/shared/purchase-cost-adjustment.ts`.

**Steps:**
1. Extract a pure `calculatePurchasePostingAmounts` input using existing generated base unit/shipping/tax fields, quantity/UOM conversion, and allocated header supplier freight. Convert only supplier/document amounts; delete the second multiplication on already-base amounts.
2. Apply those same base amounts to AP, GR/IR/PPV, direct/indirect expense, cost ledger, and fixed-asset acquisition. Preserve purchase tax and freight cost treatment.
3. Keep the already-correct receipt header divide. Trace the matched receipt amount and prove identical rate/price/freight/UOM produces zero PPV; retain an independent nonzero true-price-variance case.
4. Capture every actual IC payable row as Control using the shared helper, with the existing first matching anchor. Preserve receipt-owned capitalization captures and per-trade references.
5. Test purchased stock/service/fixture/fixed-asset/G/L branches, non-1 conversion factor, header shipping allocation, and buyer control row completeness.

**Verify:**
```bash
deno test --no-lock --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/post-purchase-invoice/purchase-posting-amounts.test.ts packages/database/supabase/functions/shared/purchase-cost-adjustment.test.ts packages/database/supabase/functions/shared/intercompany-capture.test.ts
# Expected: true-base cost/asset/control amounts and zero-PPV matching cases pass; all buyer control rows are captured.
```

**Out of scope:** recoverable input tax, new inventory valuation methods, changing receipt/PO quantity semantics.

## Task 8: Post payments and memos with authoritative funding

**Depends on:** Tasks 5–7
**Files:**
- Modify: `packages/database/supabase/functions/post-payment/build-payment-journal.ts`, `packages/database/supabase/functions/post-payment/post-payment.test.ts`, `packages/database/supabase/functions/post-payment/index.ts`.
- Create: `packages/database/supabase/functions/post-payment/post-payment-transaction.ts`, `packages/database/supabase/functions/post-payment/post-payment-transaction.test.ts`, `packages/database/supabase/functions/post-payment/payment-test-fixture.ts`.
- Create: `packages/database/supabase/functions/post-memo/post-memo-transaction.ts`, `packages/database/supabase/functions/post-memo/post-memo-transaction.test.ts` for the endpoint transaction seam.
- Modify: `packages/database/supabase/functions/post-memo/build-memo-journal.ts`, `packages/database/supabase/functions/post-memo/post-memo.test.ts`, `packages/database/supabase/functions/post-memo/index.ts`.
- Copy from (precedent): current index's transaction/row-lock/void implementation; retain the HTTP authorization wrapper.

**Steps:**
1. Extend `PaymentJournalApplicationInput` with `sourceAmount`, `sourcePaymentId`, and the authoritative FX snapshot. Bank/fees divide by current payment rate; target control/discount/write-off use base amounts; prior-credit rows release original funding base; unused current cash alone creates new credit. Aggregate persisted row FX rather than independently recalculating a plug.
2. Extract the existing transaction body to `postPaymentTransaction(db, args)` in the edge-local file, taking the DB/client/context as arguments. `index.ts` continues to authenticate and resolve request inputs. This seam must be called by the real endpoint and be importable in tests without starting `serve()` or constructing a pool.
3. Inside the transaction lock current payment, target invoices, staged memos and eligible source payments in deterministic order. Re-read status/party/currency/rates/amounts under locks. Reject unsupported source/target combinations and all cross-company references.
4. Recalculate funding with Task 5's helper after locks. Derive target remainingBase from its original posted carrying total minus recorded effective base relief, rather than the document-derived view balance. Derive prior source remainingBase from its original rounded gross base minus recorded releases (appliedAmount + FX for AR, appliedAmount - FX for AP); current cash begins at rounded gross/paymentRate. New on-account base is the current source's returned remainingBase. Then persist split settlements, exact source amounts, FX snapshots, journals/references, and status atomically. Move journal construction from its current pre-transaction location. When accounting is disabled, settlement source amounts and caps still use the corrected contract.
5. Availability sums posted applying rows under the actual source identity. Reject double consumption. Refuse source void with effective consumers; applying-payment void reverses actual lines and releases source usage. Preserve idempotent post/void behavior and existing accounting-period guards.
6. Normalize memo posting amount by division, all memo remaining/cap calculations by exact source document amounts, and memo-to-invoice currency/equal-rate requirements. Same-rate memo applications store FX 0.
7. Red → green tests cover the spec's cash, fee, discounts, write-offs, new credit, prior credit, zero-cash application, forced transaction rollback, changed source rates, and forged submitted values. Transaction tests assert no writes survive failure; actual concurrent DB proof belongs in Task 16.

**Verify:**
```bash
deno test --no-lock --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/post-payment/post-payment.test.ts packages/database/supabase/functions/post-payment/post-payment-transaction.test.ts packages/database/supabase/functions/post-memo/post-memo.test.ts
# Expected: all corrected economic fixtures and transaction-failure tests pass; stored FX sum equals the journal FX amount.
```

**Out of scope:** new refund UI, targetless refund support, legacy-version dispatch, weakening authorization or period locks.

## Task 9: Normalize the payment composer and service readers

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts`, `apps/erp/app/modules/invoicing/invoicing.service.ts`.
- Modify: `apps/erp/app/routes/x+/payments+/new.tsx`, `apps/erp/app/routes/x+/payments+/$paymentId.tsx`, `apps/erp/app/routes/x+/payments+/$paymentId.applications.set.tsx`, `apps/erp/app/routes/x+/payments+/$paymentId.credits.set.tsx`.
- Modify: `apps/erp/app/modules/invoicing/ui/Payment/PaymentApplyTable.tsx`, `apps/erp/app/modules/invoicing/ui/Payment/PaymentApplications.tsx`, `apps/erp/app/modules/invoicing/ui/Payment/InvoicePaymentsPanel.tsx`, `apps/erp/app/modules/invoicing/ui/Payment/AvailableCreditsTable.tsx`.
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.test.ts`, `apps/erp/app/modules/invoicing/invoicing.reports.test.ts`.
- Create: `apps/erp/app/modules/invoicing/invoicing.settlements.test.ts`, `apps/erp/app/modules/invoicing/ui/Payment/PaymentApplyTable.test.tsx`.
- Copy from (precedent): the existing payment composer and `apps/erp/app/components/Form/CurrencyNumber.tsx` using `INPUT_FORMAT`/named kinds.

**Steps:**
1. Extend `invoiceSettlementBase` input for optional draft document principal; source selection and FX remain server-authoritative. Preserve `paymentId` as applying owner. Update `replaceInvoiceSettlements(db,args)` to validate currency and rates from batch-loaded parents and normalize drafts without accepting a forged funding source.
2. Add `getAvailableOnAccountCreditSources(client: SupabaseClient<Database>, companyId: string, party: {paymentType: "Receipt"; customerId: string} | {paymentType: "Disbursement"; supplierId: string}, currencyCode: string): Promise<{data: {sources: FundingSource[]; availableDocumentAmount: number; availableBaseAmount: number} | null; error: {message: string} | null}>` in the existing service. Batch-load matching posted payments and effective consumption rows and use Task 5's source type/calculations, including independently tracked remainingBase from original rounded gross less recorded carrying releases. Update every composer caller to use this typed result; preserve the existing `getAvailableOnAccountCredit(...): Promise<number>` base-total contract for other callers, sharing the normalized company-scoped calculation. The composer spends document totals directly, not base totals revalued at the new payment rate.
3. Seed payment cash from exact remaining document amounts; for full application retain the source amount even when rounded base is zero. Select only matching-currency invoices/sources. Replace `INVOICE_DUST_THRESHOLD` and all mirrored `0.0001` base predicates in save/post/composer eligibility with document-currency completion. Resolve currency decimals from the company group's configured currency; refuse invalid/missing configuration on save/post.
4. Keep base application/discount/write-off inputs labeled in company base; show invoice/payment document amounts alongside. Use Task 5 helpers for auto-apply and total/credit display. Aggregate split rows by invoice and display FX in base currency. Preserve source allocation on draft reopen/re-save.
5. Fix memo available/staged-credit amounts, `getInvoicePayments`/application history reads, and all mirrored post/save caps. Foreign-currency amount displays must no longer use the payment currency formatter for a base value.
6. Tests cover two invoice snapshots, foreign symbol/amount consistency, saved/reopened split rows, forged payloads, partial/large-rate eligibility, zero-cash credits, and memo status gates. Use `@internationalized/date`/Carbon datetime helpers for touched date code.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/invoicing/invoicing.settlements.test.ts app/modules/invoicing/invoicing.models.test.ts app/modules/invoicing/invoicing.reports.test.ts app/modules/invoicing/ui/Payment/PaymentApplyTable.test.tsx
pnpm exec turbo run typecheck --filter=erp
# Expected: corrected seeding/auto-apply/service/history tests and scoped typecheck pass.
```

**Out of scope:** a new payment screen, additional currency-pair support, arbitrary number-format constants.

## Task 10: Normalize AP provider and inbound-payment boundaries

**Depends on:** Tasks 5–8
**Files:**
- Modify: `packages/ee/src/accounting/core/document-costing.ts`.
- Modify: `packages/ee/src/accounting/core/document-costing.test.ts`.
- Modify: `packages/ee/src/accounting/core/payment-application.ts`.
- Create: `packages/ee/src/accounting/core/payment-application.test.ts`.
- Modify: `packages/ee/src/accounting/core/payment-syncer.ts`.
- Modify: `packages/ee/src/accounting/providers/xero/entities/bill.ts`.
- Modify: `packages/ee/src/accounting/providers/xero/entities/__tests__/bill.test.ts`.
- Modify: `packages/ee/src/accounting/providers/xero/entities/__tests__/payment.test.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/bill.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/payment.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/__tests__/bill.test.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/__tests__/payment.test.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/entities/bill.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/entities/shared.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/models.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/entities/__tests__/bill.test.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/entities/__tests__/payment.test.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/entities/__tests__/payment-push.test.ts`.
- Copy from (precedent): `packages/ee/src/accounting/core/document-costing.test.ts` for journal-read stubs; `packages/ee/src/accounting/providers/rillet/entities/__tests__/payment.test.ts` for transaction/payment mapping stubs; `packages/ee/src/accounting/providers/xero/serialize.ts` for named external precision.

**Steps:**
1. Replace the positional conversion signature with `toTransactionCurrencyLines(lines: CostingLine[], args: {exchangeRate: number; documentTotal: number; decimalPlaces: number}): CostingLine[]`. Validate finite amounts, positive finite rate and supported decimal scale. Convert each base amount by multiplication, then round to the passed document boundary. Preserve negative variance lines, account IDs, source-item labels and dimensions. Reconcile against the supplied authoritative document total using deterministic largest-magnitude-line residual assignment. Do not round the base sum to cents first; do not use this residual to conceal an economic discrepancy larger than the rounding envelope of the source/internal and destination scales. Apply the same reconciliation at rate 1; an identity rate is not permission to skip document rounding.
2. Extend `BillCostingResult` and `loadBillCostingLines` with `documentTotal`, `decimalPlaces`, `baseCurrencyCode` and `postingDate`. Load company/base and invoice currency metadata with company-scoped header reads, and compute the authoritative document total from non-comment purchase lines' `quantity * supplierUnitPrice + supplierShippingCost + supplierTaxAmount`, plus `purchaseInvoiceDelivery.supplierShippingCost`, rounded once to document decimals. Preserve generated unprefixed purchase fields as base. Missing currency/rate/precision is an error, not a USD/rate-1 fallback. Keep the existing posted-journal selection, AP-control exclusion, account-class debit conversion and dimension loading.
3. Update **all three production callers**: Xero `BillSyncer.mapToRemote`, QBO `QboBillSyncer.mapToRemote`, and Rillet `mapBillToRilletBill` through `RilletBillSyncer.mapToRemote`. Pass the new explicit object and carry costing-result metadata into the Rillet pure mapper's argument. Update every existing test invocation of the helper/mapper. Check the resulting provider bill total against `documentTotal` before its create/update API call; AP replay stays tax-neutral because tax is already in the costing lines.
4. Xero bill `CurrencyRate` remains Carbon `r`. QBO bill `ExchangeRate` becomes `1/r`; QBO `mapToLocal` must also return `currencyCode` from `CurrencyRef` and the reciprocal of remote `ExchangeRate` before local supplier fields are populated. QBO payment `mapToNormalized` performs the same reciprocal conversion. Missing remote rate is identity only when the authoritative currencies identify a base-currency document. Tests must assert both outbound payloads and inbound stored snapshots.
5. Add `Rillet.ExchangeRateSchema`/type with required `{base: string; target: string; rate: string; date: string}` and use it for the bill request/response schema. Add pure `toRilletExchangeRate(args: {baseCurrencyCode: string; documentCurrencyCode: string; foreignPerBaseRate: number; date: string}): Rillet.ExchangeRate | undefined` in `rillet/entities/shared.ts`. Omit on identical currencies after validating identity; otherwise produce `{base: baseCurrencyCode, target: documentCurrencyCode, rate: String(foreignPerBaseRate), date}` without numeric-string rounding to money precision. Pass the invoice posting date through the existing date helpers.
6. **Rillet direction evidence:** the official [Create Bill schema](https://docs.api.rillet.com/reference/create-a-bill-1.md) proves the object fields/types, not the arithmetic direction. `base=company currency`, `target=document currency`, `rate=r` is an explicitly labeled directed-pair inference. Pin the schema-valid USD→EUR/r0.8 fixture and the intended economic result (80 EUR carrying 100 USD); independently verify the provider's directed-pair behavior against a provider-returned fixture/read-only sandbox evidence before declaring the integration verified. If the provider requires the reverse pair, invert both pair and rate together in this helper and document that evidence. A self-authored serializer test is not independent provider verification. Do not send `exchange_rate` on `AR_ONLY`: the published AR_ONLY create schema does not contain it; Task 11 preserves that scope.
7. Change `toRilletMoney` to accept an explicit document decimal scale on the corrected bill/invoice paths, while preserving existing unrelated callers until their own scopes are changed: `toRilletMoney(amount: number, currency: string, decimalPlaces?: number): Rillet.MonetaryAmount`. Corrected callers always supply DB currency decimals and serialize the rounded decimal string at that scale. Add 0/3-decimal bill fixtures; do not globally change unrelated contact/product/payment serialization in this task.
8. Update the actual shared inbound function, `upsertLocalPaymentDraft(tx: KyselyTx, args: UpsertPaymentDraftArgs): Promise<UpsertPaymentDraftResult>`. Batch-load document mappings, then the resolved invoices with company, party, currency, rate and authoritative totals before payment/settlement mutations. Retain the documented ownership skip for remote documents without any Carbon mapping; a mapping pointing to a missing/cross-company invoice, an invalid rate, a mixed party, or an unsupported currency pair is an error. Keep payment `totalAmount` in remote/payment currency. For each linked document store exact remote principal as `sourceAmount`, derive target-base `appliedAmount` through Task 5's helpers, set current-cash `sourcePaymentId:null`, and store authoritative source/target snapshots; remove `targetExchangeRate:1`.
9. Preserve existing mapping identity, draft replacement, posted-payment/void idempotency, `withTriggersDisabled` around local sync writes, and subsequent invocation of `post-payment`. Re-read targets in the posting transaction as required by Task 8; adapter previews do not replace authoritative posting validation.
10. Extend `PaymentSyncerBase.loadLocalPaymentForPush` and its internal payment/settlement types to select `sourceAmount`/`sourcePaymentId`. Keep existing FX/discount/write-off/fee capability gates, reject credit-funded rows before remote payment creation, and compare/send supported cash principal in document currency. Existing base-currency cash fan-out remains supported; do not coalesce prior-credit consumption into a fictitious remote cash payment.
11. Add fixtures for base100→document80 at r0.8, negative PPV, largest-line residual, authoritative-total mismatch, 0/3 decimals, QBO reciprocal inbound/outbound rates, Rillet object shape, and remote principal110 with invoice r1.25/payment r1.10 storing source110/base88. Include source160.01/r16000 and assert invalid pairs/mappings produce zero draft/settlement mutations; credit-funded outbound cases produce zero remote payment writes.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run --config ../config/vitest.mts src/accounting/core/document-costing.test.ts src/accounting/core/payment-application.test.ts src/accounting/providers/xero/entities/__tests__/bill.test.ts src/accounting/providers/xero/entities/__tests__/payment.test.ts src/accounting/providers/quickbooks-online/entities/__tests__/bill.test.ts src/accounting/providers/quickbooks-online/entities/__tests__/payment.test.ts src/accounting/providers/rillet/entities/__tests__/bill.test.ts src/accounting/providers/rillet/entities/__tests__/payment.test.ts src/accounting/providers/rillet/entities/__tests__/payment-push.test.ts
# Expected: every selected suite passes; amount/rate/residual and no-write failure fixtures pass. Source-config override avoids the currently absent @carbon/config/dist/vitest.mjs.
```

**Out of scope:** live provider writes during unit tests, new FX payment capabilities, historical corrections, changing PO/SO representations, treating Rillet rate-direction inference as verified API behavior.

## Task 11: Export sales components through provider-native mappings

**Depends on:** Tasks 4, 6 and 10
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts`.
- Modify: `packages/ee/src/accounting/core/posting.ts` — add the structured `UNMAPPED_TAX_CODES` preflight warning code.
- Create: `packages/ee/src/accounting/core/sales-document-components.ts`.
- Create: `packages/ee/src/accounting/core/sales-document-components.test.ts`.
- Read/reuse: `packages/utils/src/sales-posting-amounts.ts`, `packages/utils/src/index.ts` — Task 6 supplies this Node re-export.
- Modify: `packages/ee/src/accounting/providers/xero/entities/invoice.ts`.
- Modify: `packages/ee/src/accounting/providers/xero/entities/__tests__/invoice.test.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/invoice.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/item.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/models.ts`.
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/invoice-tax.ts`.
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/__tests__/invoice-tax.test.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/__tests__/invoice.test.ts`.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/__tests__/item.test.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/entities/invoice.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/entities/item.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/models.ts`.
- Modify: `packages/ee/src/accounting/providers/rillet/entities/__tests__/invoice.test.ts`.
- Create: `packages/ee/src/accounting/providers/rillet/entities/__tests__/item.test.ts` — this test file does not currently exist.
- Read/reuse: `packages/ee/src/accounting/core/external-mapping.ts`, `packages/ee/src/accounting/core/account-mapping.ts`, `packages/ee/src/accounting/core/sync.ts`, `packages/ee/src/accounting/providers/quickbooks-online/entities/shared.ts`, `packages/ee/src/accounting/providers/quickbooks-online/provider.ts`, `packages/ee/src/accounting/providers/rillet/entities/shared.ts`, `packages/ee/src/accounting/providers/rillet/provider.ts`.
- Copy from (precedent): the existing QBO item tests/mappers, Rillet `mapItemToRilletProduct`, `buildRilletIdempotencyKey`, account-code/ref resolvers, and the `dimensionValue` mapping pattern for non-entity helper identities.

**Steps:**
1. Extend `SalesInvoiceLineSchema` with base `shippingCost`, `addOnCost`, `nonTaxableAddOnCost` (zero-defaulted for old normalized fixtures); retain fractional `taxPercent` and optional `convertedUnitPrice`. Extend `SalesInvoiceSchema` with base `headerShippingCost`, `baseCurrencyCode`, `baseCurrencyDecimalPlaces` and authoritative `currencyDecimalPlaces`. Update each provider's local header/line row types and **all three `fetchLocalBatch` implementations**: select the charge columns and `convertedUnitPrice`, left-join/batch-load `salesInvoiceShipment.shippingCost`, company base currency, and document `currency.decimalPlaces`. Use the authoritative `salesInvoices` view for base totals/balance, scope source rows to company, and avoid per-line/header queries. Missing currency metadata must fail rather than become guessed precision/rate.
2. Define `SalesDocumentComponent = {id: string; sourceLineId: string | null; kind: "Merchandise" | "TaxableAddOn" | "NonTaxableAddOn" | "LineShipping" | "HeaderShipping"; itemId: string | null; itemCode: string | null; description: string; quantity: number; unitAmount: number; netAmount: number; taxPercent: number; taxAmount: number}` and `SalesDocumentComponents = {currencyCode: string; decimalPlaces: number; components: SalesDocumentComponent[]; subtotal: number; totalTax: number; totalAmount: number; balance: number}`. Export `buildSalesDocumentComponents(invoice: Accounting.SalesInvoice): SalesDocumentComponents`. Import the Task 6 pure breakdown/allocator through the new utils re-export so tax bases/allocation are shared with posting. Ignore comments. Preserve merchandise quantity/item identity; add-ons and shipping become quantity-one rows. Line shipping and taxable add-ons retain the source fractional rate; header shipping/non-taxable add-ons have zero tax. Tax is metadata/native tax, never another net/revenue component. Use stable IDs derived from source line plus component kind; header shipping uses a stable invoice-derived ID.
3. Convert base amounts once with Task 5 helpers and currency decimals. Prefer the stored document unit mirror for merchandise when present; validate consistency with the rate snapshot. Reconcile line net/tax rounding deterministically to authoritative document subtotal/tax/gross derived from the source invoice contract. Do not force agreement by altering a tax rate or adding an unclassified sales charge. Preserve exact source references; zero amounts omit empty components. Tests cover zero quantity with a positive add-on, zero weights, header residuals, and 0/3-decimal documents.
4. Refactor Xero's `SalesInvoiceSyncer.mapToRemote` to consume the component result. Add a pure `buildXeroSalesInvoiceLines(args: {document: SalesDocumentComponents; salesAccountCode: string; shippingAccountCode: string | null}): Xero.InvoiceLineItem[]`. Merchandise/add-ons use mapped Sales; line/header shipping use mapped Shipping Revenue. Keep merchandise ItemCode dependency mapping. Set native `TaxAmount` from the component's document tax and remove the extra `/100`; preserve `LineAmountTypes:"Exclusive"` and current Xero taxable/zero-tax types. Header shipping stays untaxed. Populate subtotal/tax/total/amount due/paid from reconciled document values, and retain `CurrencyRate:r`. Require shipping mapping only when a nonzero shipping component exists.
5. Add public `QboItemSyncer.ensureShippingItem(args: {shippingAccountId: string}): Promise<string>` and `RilletItemSyncer.ensureShippingProduct(args: {shippingAccountId: string; baseCurrencyCode: string; baseCurrencyDecimals: number}): Promise<string>`. Resolve these existing syncer classes through `SyncFactory.getSyncer` in `core/sync.ts` using the current provider/client/database/company context (dynamic import after preflight to preserve the existing module-cycle boundary), and narrow to the concrete item syncer before calling its new method; do not register a new entity syncer. Resolve/validate the Carbon shipping default and its external account mapping before dependency writes. Reuse current account-ref/code loaders and provider create/read/update methods. Cache by helper identity per syncer instance/batch; do not issue a lookup for every component.
6. Store helper identity using `createMappingService.link("shippingItem", helperId, providerId, remoteId, {metadata: {accountId: shippingAccountId, kind: "shipping"}})` inside existing trigger-suppressed mapping writes. QBO `helperId=shippingAccountId`; Rillet `helperId=shippingAccountId + ":" + baseCurrencyCode`. Never link it under `entityType:"item"` to a nonexistent local item. Include company scope through the mapping service. A changed shipping default selects a different helper identity without repointing merchandise products.
7. QBO helper payload is a sales-only `{Name, Description, Type:"Service", Active:true, UnitPrice:0, IncomeAccountRef:mappedShippingRef}` with no inventory or purchase fields. Use deterministic name `Carbon Shipping <shippingAccountId>` within QBO's name limit. Recover a missing local link by exact remote name query; only reuse a compatible active Service with the expected account. An incompatible name/account is a structured `UNMAPPED_ACCOUNTS` Warning; do not overwrite an unrelated match. Recover duplicate-name races by re-reading and validating that same name, then link; use existing SyncToken retry only for a helper already owned by its mapping. QBO's [IncomeAccountRef contract](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/e53f8d57-d526-2cee-9c6b-03359cfaae37.htm) makes that service's revenue account authoritative.
8. Rillet helper reuses the existing product mapper with explicit shipping account mapping: deterministic name `Carbon Shipping <shippingAccountId> <baseCurrencyCode>`, ONE_TIME nominal zero price in base currency, `include_in_arr_mrr:false`, `revenue_pattern:"EVEN_PERIOD"`, `status:"ACTIVE"`, and mapped shipping `account_code`. Persist/read the `shippingItem` mapping and reuse entity-scoped `buildRilletIdempotencyKey({companyId,operation:"product",localId:helperId})` for create recovery; never make the key payload-sensitive. Use existing external-reference retry behavior. Existing mapped-product updates must retrieve/merge the full product before PUT, preserving unrelated fields; do not smart-match and mutate an unrelated product by name. The [official product schema](https://docs.api.rillet.com/reference/create-a-product-1.md) supplies the valid fields.
9. Add QBO `TaxCode`, `TaxRate`, `TaxLineDetail`, and `TxnTaxDetail` schemas/types from the official contracts; extend `SalesItemLineDetailSchema` with `TaxCodeRef` and invoice schema with `TxnTaxDetail`, `CurrencyRef`, `ExchangeRate`, and the supported global-tax calculation field. Add `loadQboInvoiceTaxCatalog(provider: QboProvider): Promise<{country: string; taxCodes: Qbo.TaxCode[]; taxRates: Qbo.TaxRate[]}>` in `invoice-tax.ts`. Reuse `provider.getCompanyInfo()` and paginated `provider.query<Qbo.TaxCode>("TaxCode")`/`provider.query<Qbo.TaxRate>("TaxRate")`; fetch once per syncer batch, filter inactive records, and propagate fetch failures. Do not call TaxService/create tax codes or infer jurisdiction from company base currency.
10. Export pure `resolveQboInvoiceTax(args: {document: SalesDocumentComponents; catalog: {country: string; taxCodes: readonly Qbo.TaxCode[]; taxRates: readonly Qbo.TaxRate[]}}): {lineTaxCodeRefs: ReadonlyMap<string, Qbo.Ref>; txnTaxDetail: Qbo.TxnTaxDetail | undefined}`. Resolve every distinct nonzero Carbon fractional rate through an active **sales** `TaxCode.SalesTaxRateList` and its existing `TaxRateRef` rows; compare Carbon fraction×100 with the remote percentage value at rate precision. Support a unique simple percentage rate/code; reject missing references, duplicate compatible choices, compound/tax-on-tax requirements, or dated/locale rules that cannot reproduce the supplied tax from the catalog. Resolve zero-tax line markers/codes from the provider's actual catalog/locale contract; never fabricate remote IDs. For US use the single resolved transaction tax code and applicable line taxable/non-taxable markers; incompatible multiple transaction codes fail before send. For global tax use the resolved line codes and tax detail referencing only rates belonging to them. Group tax detail by real TaxRateRef, with native `Amount`, `NetAmountTaxable`, `PercentBased:true`, `TaxPercent` in percentage points, and `TotalTax` from the source component totals. [Native tax detail](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/7328bab2-a9ed-621e-41fa-188e45aaac65.htm) and [rate membership/percentage rules](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/9a4b9306-4684-179c-4b74-3896047aa53b.htm) are the contract. This resolver translates existing tax facts; it does not calculate a new tax policy.
11. Missing/ambiguous/unsupported QBO tax resolution throws `JournalEntrySyncError({errorCode:"UNMAPPED_TAX_CODES", warning:true, message, metadata:{invoiceId, requestedRates, candidateTaxCodeIds, reason}})` before customer/item/helper provisioning or invoice create/update. The message names the requested percentage and unresolved remote tax configuration. Add that code to the existing structured error union in `core/posting.ts`. No fallback to a first tax code, a generated numeric ID, untaxed export, or tax-as-revenue is allowed.
12. Change `buildQboInvoiceLines` to `buildQboInvoiceLines(args: {document: SalesDocumentComponents; itemRemoteIds: ReadonlyMap<string,string>; shippingItemRemoteId: string | null; lineTaxCodeRefs: ReadonlyMap<string,Qbo.Ref>}): Array<Omit<Qbo.InvoiceLine,"Id">>`. Merchandise/add-ons retain the source item's mapping; shipping uses the helper ItemRef, Qty1 and document UnitPrice/Amount. Require an actual item mapping for any provider line that needs one; retain each provider's existing no-item capability gate and never attach an unrelated product as a fallback. Wire the tax resolver and builder into `QboSalesInvoiceSyncer.mapToRemote`, attach native `TxnTaxDetail`, document `CurrencyRef`, and reciprocal `ExchangeRate:1/r`. Test the locale-specific tax fixture through the actual `mapToRemote` call and assert invoice total equals component net plus native tax; tax must not also appear in the ordinary Line array.
13. Extend `mapSalesInvoiceToRilletInvoice` arguments with `document: SalesDocumentComponents`, `shippingProductRemoteId: string | null`, and `shippingAccountCode: string | null`, preserving its current customer/item/subsidiary/company/documentUrl arguments. Merchandise/add-ons use existing product IDs, shipping uses its helper product; every AR_ONLY row carries `product_id`, description, quantity, document `total_amount`, and the existing required external references keyed by component identity. Add the documented optional `revenue:{account_code}` to Rillet invoice-item schema and set it for shipping. Use **native header `tax_amount` exactly once**, equal to the reconciled document tax; do not also add a tax product or duplicate it in every item. The [AR_ONLY schema](https://docs.api.rillet.com/reference/create-an-invoice-1.md) permits header/item native tax and requires products; its AR_ONLY request has no `exchange_rate`. Keep AR_ONLY and omit that field. This task does not claim provider support for pinning a custom AR_ONLY FX rate; foreign invoice component-currency correctness and provider-owned base translation must be distinguished in tests/reporting, and the Task 10 bill-rate helper must not be copied onto AR_ONLY.
14. Preflight all account/tax/currency/component requirements before any provider document write. Add real-call-site query fixtures proving all three `fetchLocalBatch` implementations supply shipping/add-ons and authoritative decimals/totals. Add the base151/r0.8→document120.80 fixture (net98.40 Sales, net12 Shipping, tax10.40), mixed taxable/non-taxable charges, source/header references, native tax once, schema-valid Rillet product lines, and documented AR_ONLY FX limitation. Test helper mapping reuse, remote-create/local-link retry, duplicate-name race, incompatible helper, unmapped shipping, zero shipping, and missing/ambiguous QBO tax catalogs. Assert zero remote invoice writes on every preflight failure and no provisioning on a zero shipping amount.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run --config ../config/vitest.mts src/accounting/core/sales-document-components.test.ts src/accounting/providers/xero/entities/__tests__/invoice.test.ts src/accounting/providers/quickbooks-online/entities/__tests__/invoice-tax.test.ts src/accounting/providers/quickbooks-online/entities/__tests__/invoice.test.ts src/accounting/providers/quickbooks-online/entities/__tests__/item.test.ts src/accounting/providers/rillet/entities/__tests__/invoice.test.ts src/accounting/providers/rillet/entities/__tests__/item.test.ts
# Expected: every selected suite passes; real fetch→map fixtures retain document totals, shipping account effects and native tax, retry does not duplicate helpers, and missing/ambiguous tax/account mappings cause zero remote invoice writes.
```

**Out of scope:** new provider entity syncers, local inventory shipping items, tracked remote products, tax-code creation/tax determination, silently changing Rillet revenue-recognition scope or promising a custom FX snapshot on AR_ONLY.

## Task 12: Correct translation arithmetic and error handling

**Depends on:** Task 1; independent of posting tasks
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.ee.service.ts`.
- Create: `apps/erp/app/modules/accounting/accounting.translation.test.ts`.
- Copy from (precedent): import/settings/glossary mocks in `accounting.periods.test.ts`; current precision helpers and `packages/utils/src/accounting.ts`.

**Steps:**
1. Keep `translateCompanyBalances(client,companyGroupId,companyId,targetCurrency,periodEnd,periodStart,balances)` and its result shape. Reject invalid classes/nonfinite balances and source debit-minus-credit imbalance after excluding groups and synthetic net income. Use the service's existing `isBalanced` helper with `JOURNAL_BALANCE_TOLERANCE` (currently 0.001), not a new unrelated cent threshold; this source validation does not change journal posting tolerances.
2. Compute CTA with Asset/Expense positive and Liability/Equity/Revenue negative. Preserve negative balances. Do not use `rootSignMultiplier` for this sum.
3. Replace successful-empty-RPC fallback1 with an error. Require source currency and positive finite applicable rates. Preserve same-currency identity, RPC error propagation, and September target/source SQL policy.
4. Mock RPC by name/arguments, because bucket/company calls run concurrently. Test the real exported service with identity80/100/20→CTA0; negative cash; closing2/average1.5→CTA40; source79/100/20 failure; unknown class; malformed rates; group/synthetic exclusion; failed bucket returning no partial report.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.translation.test.ts
# Expected: all translation/source-validation/error fixtures pass using the real service.
```

**Out of scope:** rate RPC rewrites, posted CTA, historical equity layers, fiscal-year earnings redesign.

## Task 13: Apply CTA by configured account and reroll report totals

**Depends on:** Task 12; serialize with Task 4's service edits
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.ee.service.ts`, `apps/erp/app/routes/x+/reports+/balance-sheet.tsx`.
- Extend: `apps/erp/app/modules/accounting/accounting.translation.test.ts`.
- Create: `apps/erp/app/routes/x+/reports+/balance-sheet.test.ts`.
- Copy from (precedent): `apps/erp/app/routes/x+/inspection+/$id.reject.test.ts` for route tests; existing `rollUpTranslatedGroups` and `applyRootSignCorrectionToSeries`.

**Steps:**
1. Add `applyCtaToReportPeriodSeries(client, companyGroupId, reportingCompanyId, args: {accounts: ChartPeriodSeries[]; bucketKeys: string[]; ctaByBucket: Record<string,number>}): Promise<{data: ChartPeriodSeries[] | null; error: {message:string} | null}>` in the existing service.
2. Read `getDefaultAccounts(client,reportingCompanyId)`, resolve CTA by ID, and validate active Balance Sheet Equity leaf/group ownership. If the supplied chart lacks fields needed to validate ownership/active state, batch-fetch that account through the client rather than assuming the fields exist.
3. Clone rows/cells, add each bucket's CTA once, then rerun existing translated rollups/root correction. These helpers recompute groups/roots from children; do not multiply already-presented rows by a second sign. Missing mapping/cell yields an explicit error. Preserve booked CTA and do not mutate caller input.
4. Remove hardcoded3200 and route-local `applyCtaByBucket`. Both translated branches pass the resolved root company ID and full chart to the helper before Balance Sheet filtering. Preserve nontranslated flow and existing redirect/flash errors. CSV already consumes loader rows; use the corrected rows unchanged.
5. Tests cover custom number/name, different active/child default, invalid mapping, two buckets, repeated calculation on original inputs, subsidiary failure, and leaf/intermediate/root/export agreement.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.translation.test.ts app/routes/x+/reports+/balance-sheet.test.ts
# Expected: configured parent account used in both translated branches; Cash160/NI120/CTA40 produces Equity160 and Balance Sheet root0, with CTA applied exactly once.
```

**Out of scope:** report route renames, UI redesign, applying CTA to un-translated reports.

## Task 14: Normalize invoice balances and AR/AP reporting SQL

**Depends on:** Tasks 8–9
**Files:**
- Create: the unique migration emitted by `pnpm db:migrate:new accounting_balances_and_reports` in `packages/database/supabase/migrations/`; record the generated path here during execution.
- Create: `packages/database/supabase/tests/accounting-balances-and-reports.test.sql`.
- Read: `packages/database/supabase/migrations/20260702224219_fix-ar-ap-legacy-paid.sql`, `packages/database/supabase/migrations/20260811123616_widen-purchasing-scale.sql`.

**Steps:**
1. Write the full latest invoice-view corrections and six RPC definitions from Appendix B into the CLI-created forward migration. Preserve existing view column order and RPC signatures; use SECURITY INVOKER. If a newer definition landed, STOP and reconcile the diff before replacing it.
2. Replace base-cent forgiveness with document-currency settlement completion. Positive foreign minor units must remain payable even when base value is below0.01 or rounds to zero at ledger scale. Use exact stored source principal and document equivalents of noncash relief; preserve raw generated purchase amounts and legacy base-table Paid/datePaid guards.
3. Normalize all six functions: `get_ar_tie_out`, `get_ap_tie_out`, `get_ar_open_by_customer`, `get_ap_open_by_supplier`, `get_ar_aging`, `get_ap_aging`. Invoice carrying amounts are base; memo/payment source amounts divide to base. Include effective memo applications and prior-credit attribution exactly once with applying-status/cutoff gates. Drill-down `openInCurrency` is document and `openInBase` is base.
4. Add rollback SQL fixtures for AR/AP partial/full payment, memo application, unapplied/current/prior cash, two snapshots, cutoff before/after consumption, source/application void behavior, legacy Paid guard, and large-rate document remainder. Assert aging total = open items + unapplied = control GL within the configured precision.
5. Apply to the existing local database and immediately continue to Task 15 before typechecking.

**Verify:**
```bash
pnpm db:migrate
# Expected: forward report migration applies; no dropped columns/signature overloads and no PostgREST schema-cache error.
```

**Out of scope:** new aging UI, rewriting historical documents, excluding legitimate memo/source credit balances to make a tie-out pass.

## Task 15: Generate types after the reporting migration

**Depends on:** Task 14
**Files:**
- Regenerate: outputs of `scripts/generate-db-types.ts`.
- Verify: `packages/database/supabase/tests/accounting-balances-and-reports.test.sql`.

**Steps:**
1. Regenerate types and verify the existing six RPC signatures remain stable.
2. Run the SQL fixtures against the migrated local stack. Any missing source principal in a posted fixture is a fixture failure, not a reason to reinstate the old arithmetic.

**Verify:**
```bash
pnpm run generate:types
pnpm exec tsx .context/accounting/run-local-check.ts psql -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/accounting-balances-and-reports.test.sql
# Expected: every AR/AP/source/cutoff/precision assertion passes, ALL SCENARIOS PASSED, ROLLBACK, exit 0.
```

**Out of scope:** manually adjusting generated RPC types.

## Task 16: Prove database and posting transaction invariants

**Depends on:** Tasks 4–15
**Files:**
- Create: `packages/database/supabase/tests/accounting-posting-corrections.test.sql`.
- Modify: `packages/database/supabase/tests/intercompany-elimination.test.sql` to add multiline taxed/shipping captures without stale Draft-counting assumptions.
- Create: `packages/database/supabase/functions/post-payment/post-payment-concurrency.test.ts`.
- Extend: sales/purchase helper and payment transaction tests from Tasks 6–8.
- Copy from (precedent): rollback harness in `intercompany-elimination.test.sql`; transaction cleanup mechanics in `packages/database/src/datasets/verify.ts`.

**Steps:**
1. SQL fixtures use an isolated test company/group, explicit fixture/default account IDs, current Posted status, valid periods and audit fields. Wrap in BEGIN/ROLLBACK. Execute `SET LOCAL "app.sync_in_progress" = 'true'` before fixture bootstrap, as in `packages/database/src/datasets/verify.ts`; apply it within every independent concurrency connection/transaction as well. Rollback cannot undo already-dispatched `pg_net` requests from another connection. Do not copy hardcoded business-company names.
2. Prove generated invoice denominations, all sourceAmount/sourcePaymentId constraints, exact source availability, and real consolidation pair rates. Seed/capture a multiline IC trade, invoke the real elimination RPC, and assert all IC control/revenue rows eliminate while external tax/group cost remain.
3. Import the production `postPaymentTransaction` with independent local DB connections for simultaneous consumers of one test credit source. Only affordable allocations may commit; no overspend/duplicate journals. Test a fault after settlement writes and before journal completion, asserting full rollback. Cleanup only records created by this test, never broad table/company deletes.
4. Run the actual local post-sales-invoice/post-purchase-invoice/post-payment endpoints on isolated test documents in Task 18. Pure builders/seeded SQL capture tests cannot claim the HTTP posting wiring is proven.
5. Verify direct versus receipt/shipment-owned postings, metadata row alignment, complete IC controls, unchanged booked-value reversals, and persisted FX sum equality. Record exact failed/passed scenario names.

**Verify:**
```bash
pnpm exec tsx .context/accounting/run-local-check.ts psql -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/accounting-posting-corrections.test.sql
pnpm exec tsx .context/accounting/run-local-check.ts psql -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/intercompany-elimination.test.sql
pnpm exec tsx .context/accounting/run-local-check.ts deno test --no-lock --allow-env --allow-net --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/post-payment/post-payment-concurrency.test.ts
# Expected: both SQL harnesses report ALL SCENARIOS PASSED and ROLLBACK; actual concurrency/rollback tests pass against local DB.
```

**Out of scope:** a database rebuild, production fixtures, live provider writes, claiming seeded SQL alone executes TypeScript posting code.

## Task 17: Run integration gates and update technical guidance

**Depends on:** Task 16
**Files:**
- Modify: `.claude/rules/accounting-sync-handlers.md`, `.claude/rules/numeric-precision.md` — corrected denominations/provider boundaries and source precision.
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` — current natural-balance sign/test commands and CTA integration facts.
- Update: the linked spec's implementation changelog and this progress checklist with actual evidence.
- Regenerate: affected `packages/locale/locales/` catalogs through `/translate`; no hand-invented glossary terms.

**Steps:**
1. Run `/translate` for new UI strings after extraction using current locale tooling. Keep new money inputs on named precision kinds.
2. Update stale technical guidance: base→document costing multiplies; Xero rate passes through/QBO reciprocates; source principal is distinct from base relief; CTA uses natural debit/credit signs and configured root account. Do not leave docs claiming the old multiply convention or a nonexistent package name.
3. Run the focused tests from Tasks 4–16, then the scoped typechecks/gates below once. All dataset/backup checks must actually run against the migrated schema; skip messages are not passing evidence.
4. Run scoped Biome on touched source/UI files via the check-and-commit skill's changed-file selection. Do not format unrelated files. Check the final diff for changes outside the spec, credentials, generated-type hand edits, or operational data writes.
5. Use `/self-review` on the integrated branch. Resolve must-fix findings, rerun affected checks, and record material limitations. Do not mark the spec implemented or promise deployment before the final workflow proof.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/database --filter=@carbon/utils
pnpm db:check:datasets
pnpm db:check:backups
git diff --check
# Expected: all scoped gates exit0; datasets/backups produce actual success; no whitespace errors.
```

**Out of scope:** whole-repository typecheck/build merely for completeness, unrelated lint cleanup, auto-merging/publishing.

## Task 18: Verify the user workflows in the browser

**Depends on:** Task 17; existing local stack running and migrated
**Files:**
- Create/update after PASS: `.ai/playbooks/accounting-posting-corrections.md`.
- Read precedents: `.ai/playbooks/create-sales-invoice.md`, `.ai/playbooks/create-purchase-invoice.md`, `.ai/playbooks/create-and-apply-payment.md`, `.ai/playbooks/account-ledger-drilldown.md`.

**Steps:**
1. Use `/test` and `/auth` once browser verification is authorized by execution. Use local isolated test documents/accounts. Current report URLs are `/x/reports/balance-sheet`, `/x/reports/income-statement`, `/x/reports/trial-balance`; do not copy stale playbook routes or claims that Draft journals count.
2. Workflow A: save Shipping Revenue default, create/post the sales 151-base/120.80-EUR fixture, inspect actual ledger accounts/dimensions, receive the correct foreign payment, confirm paid status/tie-out, void payment and invoice, and inspect exact reversing lines. Repeat purchase receipt/invoice matching with a non-1 UOM factor and verify zero PPV.
3. Workflow B: create an unapplied foreign payment; apply partial credit with a later snapshot and a zero-cash applying payment. Confirm available document credit, FX, source-void refusal and applying-payment void restoration. Cover 160.01 source units/rate16000 across partial and final application; no premature Paid status.
4. Workflow C: with posted balanced fixtures, verify identity Cash80/Income80/CTA0. For foreign closing2/average1.5 verify Cash160/Income120/CTA40 using the parent's custom-number CTA default. Switch single-subsidiary/All Companies, expand Equity and download CSV; leaf, subtotal/root and exported buckets agree.
5. Use click→snapshot→option for custom selectors, fill→blur for numeric/date fields, and `form.requestSubmit(submitter)` for ValidatedForm. Capture `/error` evidence for failures; record PASS/FAIL/SKIP per workflow. A missing prerequisite is unfinished verification, not a PASS.
6. Cache only successful flows, record source document/journal IDs and screenshots/CSV evidence, and close the browser. Final report states changes, tests, limitations, and implementation status without claiming full accounting compliance.

**Verify:**
```text
/test accounting posting corrections
Expected: PASS for all three workflows, actual posting/void records inspected,
matching report CSV, and a successful playbook with current selectors.
```

**Out of scope:** production or provider-account transactions, altering real customer defaults, unrequested deployment.

## Acceptance coverage

| Spec acceptance group | Tasks |
| --- | --- |
| Default creation, backfill, settings, tenant/account validation | 2–4, 16, 18 |
| Sales/tax/shipping amounts, allocation, disposal, metadata, exact reversal | 5–6, 16, 18 |
| Purchase FX/cost/PPV and buyer control capture | 7, 16, 18 |
| IC multiline controls, shipping elimination and per-trade cost | 6–7, 16 |
| Cash/discount/write-off/fee, prior credit and exact source precision | 5, 8–9, 14–16, 18 |
| Invalid rates/pairs, concurrency, rollback, retry and void | 5, 8–10, 16, 18 |
| Aging/tie-out and cutoff/status/currency consistency | 9, 14–16, 18 |
| Provider account effects, rates, source amounts and mapping reuse | 10–11 |
| CTA signs, source/rate errors, configured account and report/export totals | 12–13, 16, 18 |

## Execution notes

- Task 18 passed in the existing local stack. Workflow A: shipping account 4040 saved/reloaded; real sales invoice posts AR 151 / Sales 123 / Shipping 15 / Tax 13; UI-created EUR 120.80 payment clears 151 base with FX 0, and payment/invoice voids exactly reverse all original account amounts. Workflow B: normal prior-credit FX 25 and source-void refusal/restoration pass; actual high-rate manual 160.00 leaves 0.01 document units and zero base carrying and Partially Paid, then final 0.01 closes Paid with FX 0. Workflow C: identity/foreign ×subsidiary/AllCompanies UI and all 54 CSV rows over two periods match, including custom CTA 40 / intermediate Equity 160 / root 0. Browser playbooks record setup and evidence paths. Final ERP payment suites pass 78 tests across 5 files, and ERP typecheck passed after the browser-driven fixes.

- Task 9 high-rate browser regression: `9f217ca4e9` removes the inference that equal rounded base values mean full document settlement. Manual base .01 at r16000 now requests 160.00, while checkbox/Auto apply retain exact 160.01; zero discount/write-off edits preserve the partial selection. Four new component failures went red→green; 20 form/composer tests, ERP typecheck and Biome pass. Actual partial posting leaves invoice and source 0.01 document units with zero carrying base.

- Task 9 browser verification found the payment cash input still used the company currency symbol/decimals. Added `PaymentForm.tsx` and its component test to the task: `e772107d48` selects formatting from the actual document currency and handles selection changes. Six new cases went red→green; all 11 form/composer cases, ERP typecheck and Biome pass, and browser EUR120.80 now shows the correct symbol. No UI strings were added.
- Task 17 self-review corrected stale precision tolerances, posting-group account claims, the AP conversion helper signature and the provider FX-parity caveat. The generated backup manifest's unchanged columns retain baseline ordering, reducing its overall diff to the actual schema additions/version.

- Tasks 8/9 committed as `51f5980dea` and `ec40c988d0`; historical control-account correction `22509cb934` retains the original invoice/source account after defaults change. Final focused payment runs pass 38 tests including independent concurrency; memo integration tests also pass. Nullable original account references fail explicitly. Full edge static checks retain eight reproduced shared Node/Deno diagnostics; there are no new diagnostics in the owned payment implementation.
- Task 11 committed as `b247a4ecae`: 104 focused provider/component tests and all 904 EE tests pass, with scoped typecheck, Biome and 100 conformance tests. Native tax and shipping helpers are verified through real fetch/map call sites with mocked provider transport. No live provider writes were made; Rillet AR_ONLY still owns its base translation and its bill rate direction needs connected-provider confirmation.
- Tasks 14/15 committed as `7d5795c5fd`: 84 live AR/AP SQL cases pass, including changed defaults, historical invoice/payment/memo controls, source cutoff and direct memo appliedDate. Type generation completed without changes, database typecheck and workflow catalog pass, and all four datasets plus actual backup compatibility checks pass. The backup hook staged its manifest under a wrong root-relative path; corrected the latest local commit and preserved existing generated column ordering after verifying identical column sets.
- Task 7 HTTP verification caught a second UOM conversion during void; `bff40c8791` removes it. A fresh factor-5 receipt/invoice/void run passes eight ledger/quantity assertions. Direct inventory, received/direct asset and buyer IC HTTP fixtures also pass their monetary assertions; direct-asset lifecycle rollback remains a separate follow-up.
- Task 16 committed as `8ad5c588ab`; schema and IC SQL suites pass all nine/seven scenario groups with rollback, and two independent database-connection payment races pass. No database reset or rebuild was used.
- Task 17 full `pnpm run test` passes all 27 Turbo tasks. Earlier dev supervisor test timeouts coincided with measured Mac sleep intervals; its 65 tests pass in seven seconds while awake. Verification uses a bounded local keep-awake process. Docker clock lag after sleep caused browser session refresh loops; runtime recovery preserves database volumes.

- Tasks 6/7/10 committed as `6a23f5e74d`, `a48586c98e`, `41e0617b1d`; 43 combined sales/purchase runtime tests, typed pure purchase helpers, 156 provider boundary tests, utils and EE scoped typechecks passed. Existing Deno Node/Pool driver diagnostics were reproduced on the baseline; runtime edge tests are explicit `--no-check`.
- Task 8 internal seams include a reusable local DB fixture and the memo transaction entrypoint. Both endpoints retain their HTTP authorization wrappers. DB tests use `pnpm exec tsx .context/accounting/run-local-check.ts deno test --no-lock --no-check --allow-env --allow-net --config packages/database/supabase/functions/deno.json <tests>`; typed pure tests run separately. The local fixture suppresses outbound triggers on every independent connection and removes only its own company and generated tenant tables.
- Task 14 reporting correction: `openInBase` retains original posted control carrying less effective A/D/W; source carrying retains original rounded gross less recorded A±FX releases. A 100.004 control must remain 100.004 despite document rounding to 80 at r0.8. Document completion is tracked independently; a positive document/zero-base remainder stays visible with base zero. Appendix B includes this verified correction.

- Task 10 represents a provider-omitted rate as `NormalizedPayment.exchangeRate: number | null`, resolving identity only after authoritative base/document currency reads. Persisted rates remain positive finite numbers; all three provider normalization callers carry omission faithfully.

- Task 5 committed as `68cfee0b2a`: 42 Deno regressions, 177 existing utils tests, scoped utils typecheck and Biome passed. Exhausted sources cannot retain carrying base, and discount-only document closure must release the entire remaining target carrying value.
- Tasks 4 and 13 share gated commit `a6b147100c`: both change the accounting service and account-mapping validation; the hook also stages all extracted UI catalogs, so their completed changes and translations ship together. Focused verification remains separate: 12 defaults/route tests, 6 seed tests, 49 consolidation/loader/export tests, 4 datasets, ERP typecheck, and 24 translations with no missing entries. Seed-company Deno check has 11 errors reproduced on baseline, with no new diagnostics; unchanged Node/Deno pool/storage typing remains out of scope.
- Task 6 queues direct fixed-asset disposal writes in the existing posting transaction and batches its reads, preventing a later posting failure from leaving a partial disposal. Lifecycle ownership and void behavior are unchanged.

- Tasks 2–3 committed together as `34228bee73` because schema gates require generated types in the same commit; live migration, shipping/settlement SQL assertions, four datasets, real backup compatibility check, workflow catalog and database typecheck passed. Task 12 committed as `09a4b0a4f1`; 32 translation regressions, Biome and ERP typecheck passed.
- Local verification launcher supplies explicit libpq fields and an absolute `GIT_WORK_TREE` for git, preserving the correct workspace in nested package hooks. Generated DB types retain generator formatting.

- Task 5 contract clarification: FundingSource and returned sourceRemainders carry remainingBase as well as document units. At source3/r3, three releases of1 must total base1 (.33333, .33333, .33334). The final release uses remaining carrying value; stored appliedAmount ± FX recovers it without adding a persisted column. Task8/9 callers supply these authoritative remainders.

- Task 2 live migration binding found no `accountDefault.updatedAt` column. The failed transaction rolled back; removed that nonexistent assignment while retaining `updatedBy`, synchronized Appendix A, and migration then applied successfully.
- Task 2 migration: `packages/database/supabase/migrations/20260908021155_accounting_posting_corrections.sql` (CLI-generated).

- Task 1 committed as `5fb7356dfa`: 57 ERP tests, 40 Deno runtime tests, Biome and scoped ERP typecheck pass. React Router type generation resolved the missing `+types/root` prerequisite. Local stack booted normally without resetting a database.
- Corrected Appendix A placement/extraction before any migration was created; the original unanchored marker split had matched text inside the extraction script. SQL content/design is unchanged.

- Task 1: the configured Deno check reproduces six existing cross-runtime type errors in unchanged `functions/lib/postgres/index.ts`; runtime payment/memo verification uses `--no-check`, with static checks tracked separately. No production type-check suppression was added.
- Task 1: corrected the local verification launcher to pass parsed libpq connection fields; putting a URI in `PGDATABASE` alone did not select the configured host/port.

## Plan review evidence

Checked on 2026-09-07 against the source baseline above:

- All 18 task structures, existing/predecessor file paths, 28 relative artifact links, fenced examples, embedded Python syntax and whitespace checks pass. Both migration tasks have an immediate type-generation follow-up.
- Offline PostgreSQL ECPG syntax checks pass for 27 schema statements, two view declarations, six RPC declarations and six extracted query bodies: 41 checks. View names/order remain 40 sales columns and 36 purchase columns; RPC signatures, defaults and result columns match the latest definitions.
- ECPG does not bind live relations/types or compile the procedural DO bodies. Those bodies received static review; applying migrations and running the rollback/concurrency suites remain implementation work.
- Eleven independent Decimal/integer reference assertions pass for sales components, FX, exact foreign minor-unit remainders, source-only completion and CTA/root signs.
- The existing seven provider/costing suites pass all 51 tests using Task 10's source-config override. This records the current baseline; these existing expectations do not prove the proposed corrections.
- No implementation tasks, schema applications, database resets or live provider writes were performed while authoring this plan. Rillet's directed bill-rate arithmetic still requires the independent evidence specified in Task 10.

## Appendix A: Complete schema and account-backfill SQL

The migration generator supplies the filename; this SQL supplies the entire body.

<!-- schema-sql:start -->
```sql
-- Planning appendix only. Copy into the CLI-created forward migration.
BEGIN;

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "salesShippingRevenueAccount" TEXT;
ALTER TABLE "invoiceSettlement"
  ADD COLUMN IF NOT EXISTS "sourcePaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAmount" NUMERIC;
ALTER TABLE "invoiceSettlement"
  ALTER COLUMN "fxGainLossAmount" DROP EXPRESSION IF EXISTS;
ALTER TABLE "invoiceSettlement"
  ALTER COLUMN "fxGainLossAmount" SET DEFAULT 0;
ALTER TABLE "invoiceSettlement"
  DROP CONSTRAINT IF EXISTS "invoiceSettlement_anyComponent_check";
ALTER TABLE "invoiceSettlement"
  ADD CONSTRAINT "invoiceSettlement_anyComponent_check" CHECK (
    "appliedAmount" + "discountAmount" + "writeOffAmount" > 0
    OR COALESCE("sourceAmount", 0) > 0
  );

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"accountDefault"'::regclass AND conname='accountDefault_salesShippingRevenueAccount_fkey') THEN
    ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_salesShippingRevenueAccount_fkey"
      FOREIGN KEY ("salesShippingRevenueAccount") REFERENCES "account"(id)
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"payment"'::regclass AND conname='payment_id_companyId_key') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_id_companyId_key" UNIQUE (id, "companyId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"invoiceSettlement"'::regclass AND conname='invoiceSettlement_sourcePaymentId_companyId_fkey') THEN
    ALTER TABLE "invoiceSettlement" ADD CONSTRAINT "invoiceSettlement_sourcePaymentId_companyId_fkey"
      FOREIGN KEY ("sourcePaymentId", "companyId") REFERENCES "payment"(id, "companyId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"invoiceSettlement"'::regclass AND conname='invoiceSettlement_sourcePaymentId_check') THEN
    ALTER TABLE "invoiceSettlement" ADD CONSTRAINT "invoiceSettlement_sourcePaymentId_check"
      CHECK ("sourcePaymentId" IS NULL OR (
        "paymentId" IS NOT NULL AND "memoId" IS NULL AND "sourcePaymentId" <> "paymentId"
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"invoiceSettlement"'::regclass AND conname='invoiceSettlement_sourceAmount_check') THEN
    ALTER TABLE "invoiceSettlement" ADD CONSTRAINT "invoiceSettlement_sourceAmount_check"
      CHECK ("sourceAmount" IS NULL OR (
        "sourceAmount" >= 0 AND "sourceAmount" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      ));
  END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS "accountDefault_salesShippingRevenueAccount_idx"
  ON "accountDefault"("salesShippingRevenueAccount");
CREATE INDEX IF NOT EXISTS "invoiceSettlement_sourcePaymentId_companyId_idx"
  ON "invoiceSettlement"("sourcePaymentId", "companyId") WHERE "sourcePaymentId" IS NOT NULL;

-- Serialize chart/default resolution while choosing unused numbers and IDs.
LOCK TABLE "account", "accountDefault" IN SHARE ROW EXCLUSIVE MODE;

DO $existing_defaults$
DECLARE bad text;
BEGIN
  SELECT string_agg(ad."companyId", ', ' ORDER BY ad."companyId") INTO bad
  FROM "accountDefault" ad
  JOIN "company" c ON c.id=ad."companyId"
  LEFT JOIN "account" a ON a.id=ad."salesShippingRevenueAccount"
  WHERE ad."salesShippingRevenueAccount" IS NOT NULL AND (
    a.id IS NULL OR a."companyGroupId" IS DISTINCT FROM c."companyGroupId"
    OR a.active IS DISTINCT FROM true OR a."isGroup" IS DISTINCT FROM false
    OR a.class IS DISTINCT FROM 'Revenue' OR a."incomeBalance" IS DISTINCT FROM 'Income Statement'
    OR a.id=ad."salesAccount"
  );
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Invalid shipping defaults for companies: %', bad; END IF;
END;
$existing_defaults$;

CREATE TEMP TABLE accounting_shipping_resolution ON COMMIT DROP AS
WITH groups AS (
  SELECT DISTINCT c."companyGroupId"
  FROM "company" c JOIN "accountDefault" ad ON ad."companyId"=c.id
  WHERE ad."salesShippingRevenueAccount" IS NULL
), sales_parents AS (
  SELECT c."companyGroupId", min(p.id) AS parent_id, count(DISTINCT p.id) AS parent_count
  FROM "company" c
  JOIN "accountDefault" ad ON ad."companyId"=c.id
  JOIN "account" sales ON sales.id=ad."salesAccount" AND sales."companyGroupId"=c."companyGroupId"
  JOIN "account" p ON p.id=sales."parentId" AND p."companyGroupId"=c."companyGroupId"
  WHERE p.active AND p."isGroup" AND p.class='Revenue'
    AND p."incomeBalance"='Income Statement' AND p."accountType"='Income'
  GROUP BY c."companyGroupId"
)
SELECT g."companyGroupId",
  CASE WHEN named_parent.id IS NOT NULL THEN named_parent.id
    WHEN sp.parent_count=1 THEN sp.parent_id END AS parent_id,
  named_parent.id IS NOT NULL AND (
    named_parent.active IS DISTINCT FROM true OR named_parent.class IS DISTINCT FROM 'Revenue'
    OR named_parent."incomeBalance" IS DISTINCT FROM 'Income Statement'
    OR named_parent."accountType" IS DISTINCT FROM 'Income'
  ) AS invalid_named_parent,
  existing.id AS existing_id,
  COALESCE(existing.id, id('acct')) AS account_id,
  COALESCE(existing.number, free_number.number) AS account_number
FROM groups g
LEFT JOIN "account" named_parent ON named_parent."companyGroupId"=g."companyGroupId"
  AND named_parent.name='Revenue' AND named_parent."isGroup"=true
LEFT JOIN sales_parents sp ON sp."companyGroupId"=g."companyGroupId"
LEFT JOIN "account" existing ON existing."companyGroupId"=g."companyGroupId"
  AND existing.name='Shipping Revenue' AND existing."isGroup"=false
LEFT JOIN LATERAL (
  SELECT n::text AS number FROM generate_series(4040,4990,10) n
  WHERE NOT EXISTS (SELECT 1 FROM "account" a
    WHERE a."companyGroupId"=g."companyGroupId" AND a.number=n::text)
  ORDER BY n LIMIT 1
) free_number ON true;

DO $resolved$
DECLARE bad text;
BEGIN
  SELECT string_agg(r."companyGroupId", ', ' ORDER BY r."companyGroupId") INTO bad
  FROM accounting_shipping_resolution r
  LEFT JOIN "account" a ON a.id=r.existing_id
  WHERE r.parent_id IS NULL OR r.invalid_named_parent IS TRUE
    OR (r.existing_id IS NULL AND r.account_number IS NULL)
    OR EXISTS (
      SELECT 1 FROM "account" conflicting
      WHERE conflicting."companyGroupId"=r."companyGroupId"
        AND conflicting.name='Shipping Revenue' AND conflicting."isGroup" IS DISTINCT FROM false
    )
    OR EXISTS (
      SELECT 1 FROM "company" c JOIN "accountDefault" ad ON ad."companyId"=c.id
      WHERE c."companyGroupId"=r."companyGroupId"
        AND ad."salesShippingRevenueAccount" IS NULL AND ad."salesAccount"=r.account_id
    )
    OR (r.existing_id IS NOT NULL AND (
      a.active IS DISTINCT FROM true OR a.class IS DISTINCT FROM 'Revenue'
      OR a."accountType" IS DISTINCT FROM 'Income' OR a."incomeBalance" IS DISTINCT FROM 'Income Statement'
      OR a."consolidatedRate" IS DISTINCT FROM 'Average' OR a."parentId" IS DISTINCT FROM r.parent_id
    ));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot resolve Shipping Revenue parent/account/number for groups: %', bad;
  END IF;
END;
$resolved$;

INSERT INTO "account"(id,number,name,class,"accountType","incomeBalance","consolidatedRate",
  "parentId","isGroup",active,"isSystem","companyGroupId","createdBy")
SELECT account_id,account_number,'Shipping Revenue','Revenue','Income','Income Statement','Average',
  parent_id,false,true,false,"companyGroupId",'system'
FROM accounting_shipping_resolution WHERE existing_id IS NULL;

UPDATE "accountDefault" ad SET "salesShippingRevenueAccount"=r.account_id,
  "updatedBy"='system'
FROM "company" c JOIN accounting_shipping_resolution r ON r."companyGroupId"=c."companyGroupId"
WHERE ad."companyId"=c.id AND ad."salesShippingRevenueAccount" IS NULL;

COMMENT ON COLUMN "accountDefault"."salesShippingRevenueAccount" IS 'Revenue account for shipping charged to customers; account belongs to the company group.';
COMMENT ON COLUMN "invoiceSettlement"."sourcePaymentId" IS 'Prior posted payment supplying on-account credit; paymentId remains the applying/void owner. NULL means current payment cash.';
COMMENT ON COLUMN "invoiceSettlement"."sourceAmount" IS 'Principal consumed in the funding source document currency, stored independently of target-base appliedAmount.';
COMMENT ON COLUMN "invoiceSettlement"."appliedAmount" IS 'Target-document principal relieved in company base currency.';
COMMENT ON COLUMN "invoiceSettlement"."discountAmount" IS 'Target-document discount relief in company base currency.';
COMMENT ON COLUMN "invoiceSettlement"."writeOffAmount" IS 'Target-document write-off relief in company base currency.';
COMMENT ON COLUMN "invoiceSettlement"."fxGainLossAmount" IS 'Server-calculated posting snapshot in company base currency: positive gain, negative loss.';
COMMENT ON COLUMN "payment"."totalAmount" IS 'Gross cash amount in payment currency; divide by foreign-per-base exchangeRate for company base.';
COMMENT ON COLUMN "memo"."amount" IS 'Memo amount in memo currency; divide by foreign-per-base exchangeRate for company base.';
NOTIFY pgrst, 'reload schema';
COMMIT;
```
<!-- schema-sql:end -->

## Appendix B: Complete invoice-view and reporting SQL

```sql
BEGIN;

-- Invoice balances and reporting normalized to the document/source currency contract.
-- Requires new sourceAmount column. No historical fallback/backfill.
-- Currency precision is group configuration, never a hardcoded two decimals.
-- Save/post refuse missing config/rates; the LEFT JOIN keeps operational draft rows visible.
-- Read balances preserve sub-internal-unit foreign remainders; only ledger lines use internal rounding.

-- Latest source: packages/database/supabase/migrations/20260702224219_fix-ar-ap-legacy-paid.sql
CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT s."targetSalesInvoiceId", s."companyId",
      SUM(COALESCE(s."sourceAmount", 0) + round(
        (s."discountAmount" + s."writeOffAmount") * target."exchangeRate",
        target_currency."decimalPlaces")) AS amount_document,
      MAX(s."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" s
    JOIN "salesInvoice" target ON target."id" = s."targetSalesInvoiceId"
      AND target."companyId" = s."companyId"
    LEFT JOIN "company" target_company ON target_company."id" = target."companyId"
    LEFT JOIN "currency" target_currency ON target_currency."code" = target."currencyCode"
      AND target_currency."companyGroupId" = target_company."companyGroupId"
    LEFT JOIN "payment" p ON p."id" = s."paymentId" AND p."companyId" = s."companyId"
    LEFT JOIN "memo" m ON m."id" = s."memoId" AND m."companyId" = s."companyId"
    LEFT JOIN "payment" vp ON vp."id" = s."appliedViaPaymentId" AND vp."companyId" = s."companyId"
    WHERE s."targetSalesInvoiceId" IS NOT NULL
      AND ((s."paymentId" IS NOT NULL AND p."status" = 'Posted')
        OR (s."memoId" IS NOT NULL AND m."status" = 'Posted'
          AND (s."appliedViaPaymentId" IS NULL OR vp."status" = 'Posted')))
    GROUP BY s."targetSalesInvoiceId", s."companyId"
  )
  SELECT
    si."id",
    si."invoiceId",
    CASE
      WHEN si."status" IN ('Draft','Pending','Voided','Return','Credit Note Issued') THEN si."status"::TEXT
      WHEN si."status" = 'Paid' THEN 'Paid'
      WHEN COALESCE(s.amount_document, 0) > 0
        AND amounts.total_document > 0 AND remaining.amount_document <= 0 THEN 'Paid'
      WHEN COALESCE(s.amount_document, 0) > 0 THEN 'Partially Paid'
      WHEN si."dateDue" < CURRENT_DATE AND si."status" = 'Submitted' THEN 'Overdue'
      ELSE si."status"::TEXT
    END AS status,
    si."customerId",
    si."customerReference",
    si."invoiceCustomerId",
    si."invoiceCustomerLocationId",
    si."invoiceCustomerContactId",
    si."paymentTermId",
    si."postingDate",
    si."dateIssued",
    si."dateDue",
    CASE
      WHEN si."status" = 'Paid' THEN si."datePaid"
      WHEN COALESCE(s.amount_document, 0) > 0
        AND amounts.total_document > 0 AND remaining.amount_document <= 0
        THEN COALESCE(s."lastSettlementDate", si."datePaid")
      ELSE si."datePaid"
    END AS "datePaid",
    si."locationId",
    si."currencyCode",
    COALESCE(sil."subtotal", 0) AS "subtotal",
    si."totalDiscount",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "totalAmount",
    COALESCE(sil."totalTax", 0) AS "totalTax",
    CASE
      WHEN si."status" = 'Paid' THEN 0
      ELSE remaining.amount_document / NULLIF(si."exchangeRate", 0)
    END AS "balance",
    si."exchangeRate",
    si."exchangeRateUpdatedAt",
    si."opportunityId",
    si."shipmentId",
    si."assignee",
    si."companyId",
    si."customFields",
    si."internalNotes",
    si."externalNotes",
    si."tags",
    si."createdAt",
    si."createdBy",
    si."updatedAt",
    si."updatedBy",
    sil."thumbnailPath",
    sil."itemType",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "invoiceTotal",
    sil."lines",
    pt."name" AS "paymentTermName",
    si."status" AS "baseStatus"
  FROM "salesInvoice" si
  LEFT JOIN (
    SELECT
      sil."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        COALESCE(sil."quantity", 0)*COALESCE(sil."unitPrice", 0)
        + COALESCE(sil."addOnCost", 0)
        + COALESCE(sil."nonTaxableAddOnCost", 0)
        + COALESCE(sil."shippingCost", 0)
      ) AS "subtotal",
      SUM(
        COALESCE(sil."taxPercent", 0) * (
          COALESCE(sil."quantity", 0)*COALESCE(sil."unitPrice", 0)
          + COALESCE(sil."addOnCost", 0)
          + COALESCE(sil."shippingCost", 0)
        )
      ) AS "totalTax",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        json_build_object(
          'id', sil.id,
          'invoiceLineType', sil."invoiceLineType",
          'quantity', sil."quantity",
          'unitPrice', sil."unitPrice",
          'itemId', sil."itemId"
        )
      ) AS "lines"
    FROM "salesInvoiceLine" sil
    LEFT JOIN "item" i
      ON i."id" = sil."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY sil."invoiceId"
  ) sil ON sil."invoiceId" = si."id"
  -- LEFT JOIN (was INNER): an invoice missing its shipment row must not
  -- vanish from the view — post-payment would read its balance as 0 and
  -- reject every application. shippingCost is already COALESCEd.
  LEFT JOIN "salesInvoiceShipment" ss ON ss."id" = si."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = si."paymentTermId"
  LEFT JOIN settled s ON s."targetSalesInvoiceId" = si."id" AND s."companyId" = si."companyId"
  LEFT JOIN "company" invoice_company ON invoice_company."id" = si."companyId"
  LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = si."currencyCode"
    AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
  CROSS JOIN LATERAL (
    SELECT round((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) * si."exchangeRate", invoice_currency."decimalPlaces") AS total_document
  ) amounts
  CROSS JOIN LATERAL (
    SELECT amounts.total_document - COALESCE(s.amount_document, 0) AS amount_document
  ) remaining;

-- Latest source: packages/database/supabase/migrations/20260811123616_widen-purchasing-scale.sql
CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT s."targetPurchaseInvoiceId", s."companyId",
      SUM(COALESCE(s."sourceAmount", 0) + round(
        (s."discountAmount" + s."writeOffAmount") * target."exchangeRate",
        target_currency."decimalPlaces")) AS amount_document,
      MAX(s."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" s
    JOIN "purchaseInvoice" target ON target."id" = s."targetPurchaseInvoiceId"
      AND target."companyId" = s."companyId"
    LEFT JOIN "company" target_company ON target_company."id" = target."companyId"
    LEFT JOIN "currency" target_currency ON target_currency."code" = target."currencyCode"
      AND target_currency."companyGroupId" = target_company."companyGroupId"
    LEFT JOIN "payment" p ON p."id" = s."paymentId" AND p."companyId" = s."companyId"
    LEFT JOIN "memo" m ON m."id" = s."memoId" AND m."companyId" = s."companyId"
    LEFT JOIN "payment" vp ON vp."id" = s."appliedViaPaymentId" AND vp."companyId" = s."companyId"
    WHERE s."targetPurchaseInvoiceId" IS NOT NULL
      AND ((s."paymentId" IS NOT NULL AND p."status" = 'Posted')
        OR (s."memoId" IS NOT NULL AND m."status" = 'Posted'
          AND (s."appliedViaPaymentId" IS NULL OR vp."status" = 'Posted')))
    GROUP BY s."targetPurchaseInvoiceId", s."companyId"
  )
  SELECT
    pi."id",
    pi."invoiceId",
    pi."supplierId",
    pi."invoiceSupplierId",
    pi."supplierInteractionId",
    pi."supplierReference",
    pi."invoiceSupplierContactId",
    pi."invoiceSupplierLocationId",
    pi."locationId",
    pi."postingDate",
    pi."dateIssued",
    pi."dateDue",
    CASE
      WHEN pi."status" = 'Paid' THEN pi."datePaid"
      WHEN COALESCE(s.amount_document, 0) > 0
        AND amounts.total_document > 0 AND remaining.amount_document <= 0
        THEN COALESCE(s."lastSettlementDate", pi."datePaid")
      ELSE pi."datePaid"
    END AS "datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    COALESCE(pl."subtotal", 0) AS "subtotal",
    pi."totalDiscount",
    (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) AS "totalAmount",
    COALESCE(pl."totalTax", 0) AS "totalTax",
    CASE
      WHEN pi."status" = 'Paid' THEN 0
      ELSE remaining.amount_document / NULLIF(pi."exchangeRate", 0)
    END AS "balance",
    pi."assignee",
    pi."createdBy",
    pi."createdAt",
    pi."updatedBy",
    pi."updatedAt",
    pi."internalNotes",
    pi."customFields",
    pi."companyId",
    pl."thumbnailPath",
    pl."itemType",
    COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
    CASE
      WHEN pi."status" IN ('Draft','Pending','Voided','Return','Debit Note Issued') THEN pi."status"::TEXT
      WHEN pi."status" = 'Paid' THEN 'Paid'
      WHEN COALESCE(s.amount_document, 0) > 0
        AND amounts.total_document > 0 AND remaining.amount_document <= 0 THEN 'Paid'
      WHEN COALESCE(s.amount_document, 0) > 0 THEN 'Partially Paid'
      WHEN pi."dateDue" < CURRENT_DATE AND pi."status" = 'Open' THEN 'Overdue'
      ELSE pi."status"::TEXT
    END AS status,
    pt."name" AS "paymentTermName",
    pi."status" AS "baseStatus"
  FROM "purchaseInvoice" pi
  LEFT JOIN (
    SELECT
      pol."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        COALESCE(pol."quantity", 0)*COALESCE(pol."unitPrice", 0) + COALESCE(pol."shippingCost", 0)
      ) AS "subtotal",
      SUM(COALESCE(pol."taxAmount", 0)) AS "totalTax",
      SUM(
        COALESCE(pol."quantity", 0)*COALESCE(pol."unitPrice", 0) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)
      ) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseInvoiceLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."invoiceId"
  ) pl ON pl."invoiceId" = pi."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId"
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id"
  LEFT JOIN settled s ON s."targetPurchaseInvoiceId" = pi."id" AND s."companyId" = pi."companyId"
  LEFT JOIN "company" invoice_company ON invoice_company."id" = pi."companyId"
  LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = pi."currencyCode"
    AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
  CROSS JOIN LATERAL (
    SELECT round((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) * pi."exchangeRate", invoice_currency."decimalPlaces") AS total_document
  ) amounts
  CROSS JOIN LATERAL (
    SELECT amounts.total_document - COALESCE(s.amount_document, 0) AS amount_document
  ) remaining;

-- Report replacements retain all six RPC signatures.
-- Latest behavior source: 20260702224219_fix-ar-ap-legacy-paid.sql, all six RPCs.
-- CREATE OR REPLACE preserves argument/return signatures, ownership and ACLs.
-- Existing views also need the separate document-remainder/sourceAmount update.
-- No reset, legacy version, historical posted-row backfill, or new public RPC.

CREATE OR REPLACE FUNCTION get_ar_open_by_customer(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "customerId" TEXT,
  "documentId" TEXT,
  "documentNumber" TEXT,
  "documentType" TEXT,
  "dateDue" DATE,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC,
  "totalAmount" NUMERIC,
  "settled" NUMERIC,
  "openInCurrency" NUMERIC,
  "openInBase" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH effective_settlements AS (
    SELECT s.*
    FROM "invoiceSettlement" s
    LEFT JOIN "payment" p ON p."id" = s."paymentId"
      AND p."companyId" = s."companyId"
    LEFT JOIN "memo" source_memo ON source_memo."id" = s."memoId"
      AND source_memo."companyId" = s."companyId"
    LEFT JOIN "payment" applying ON applying."id" = s."appliedViaPaymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND (
        (s."paymentId" IS NOT NULL AND p."status" = 'Posted'
          AND p."postingDate" <= _as_of_date)
        OR (s."memoId" IS NOT NULL AND source_memo."status" = 'Posted'
          AND source_memo."postingDate" <= _as_of_date
          AND ((s."appliedViaPaymentId" IS NULL AND s."appliedDate" <= _as_of_date) OR
            (applying."status" = 'Posted' AND applying."postingDate" <= _as_of_date)))
      )
  ), invoice_settled AS (
    SELECT s."targetSalesInvoiceId" AS invoice_id,
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS settled_base,
      SUM(COALESCE(s."sourceAmount", 0) + round(
        (s."discountAmount" + s."writeOffAmount") * target."exchangeRate",
        target_currency."decimalPlaces")) AS settled_document
    FROM effective_settlements s
    JOIN "salesInvoice" target ON target."id" = s."targetSalesInvoiceId"
      AND target."companyId" = s."companyId"
    LEFT JOIN "company" target_company ON target_company."id" = target."companyId"
    LEFT JOIN "currency" target_currency ON target_currency."code" = target."currencyCode"
      AND target_currency."companyGroupId" = target_company."companyGroupId"
    WHERE s."targetSalesInvoiceId" IS NOT NULL
    GROUP BY s."targetSalesInvoiceId"
  ), memo_source_consumed AS (
    SELECT s."memoId" AS memo_id, SUM(s."sourceAmount") AS settled_document,
      SUM(s."appliedAmount" + s."fxGainLossAmount") AS settled_base
    FROM effective_settlements s
    WHERE s."memoId" IS NOT NULL
    GROUP BY s."memoId"
  ), memo_target_settled AS (
    -- Preserve existing cash-to-memo rows without adding a new refund workflow.
    -- These fields relieve the TARGET memo in base, unlike sourceAmount.
    SELECT s."targetMemoId" AS memo_id, SUM(s."appliedAmount") AS settled_base
    FROM effective_settlements s
    WHERE s."targetMemoId" IS NOT NULL AND s."paymentId" IS NOT NULL
    GROUP BY s."targetMemoId"
  ), invoice_carrying AS (
    -- Same original control snapshots used by post-payment; a document rate
    -- conversion cannot reconstruct carrying value after document rounding.
    SELECT line."documentId" AS invoice_id, SUM(abs(line."amount")) AS original_base
    FROM "journalLine" line
    JOIN "journal" j ON j."id"=line."journalId" AND j."companyId"=line."companyId"
    WHERE line."companyId"=_company_id AND line."documentType"='Invoice'
      AND line."description"='Accounts Receivable' AND j."sourceType"='Sales Invoice'
      AND j."status"='Posted' AND j."postingDate"<=_as_of_date
    GROUP BY line."documentId"
  ), invoice_open AS (
    SELECT i.*, COALESCE(s.settled_base, 0) AS settled_base,
      amounts.remaining_document,
      COALESCE(c.original_base, round(i."totalAmount",5)) - COALESCE(s.settled_base,0) AS remaining_base
    FROM "salesInvoices" i
    JOIN "salesInvoice" ib ON ib."id" = i."id" AND ib."companyId" = i."companyId"
    LEFT JOIN invoice_settled s ON s.invoice_id = i."id"
    LEFT JOIN invoice_carrying c ON c.invoice_id = i."id"
    LEFT JOIN "company" invoice_company ON invoice_company."id" = i."companyId"
    LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = i."currencyCode"
      AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
    CROSS JOIN LATERAL (
      SELECT round(i."totalAmount" * i."exchangeRate", invoice_currency."decimalPlaces")
        - COALESCE(s.settled_document, 0) AS remaining_document
    ) amounts
    WHERE i."companyId" = _company_id
      AND i."postingDate" <= _as_of_date
      AND i."status" NOT IN ('Draft', 'Pending', 'Voided')
      AND NOT (ib."status" = 'Paid'
        AND (ib."datePaid" IS NULL OR ib."datePaid" <= _as_of_date))
  ), memo_open AS (
    SELECT m.*,
      round(m."amount"/m."exchangeRate",5) - COALESCE(s.settled_base,0) - COALESCE(t.settled_base,0) AS remaining_base,
      COALESCE(s.settled_document, 0) + COALESCE(t.settled_base, 0) * m."exchangeRate" AS settled_document,
      m."amount" - COALESCE(s.settled_document, 0)
        - COALESCE(t.settled_base, 0) * m."exchangeRate" AS remaining_document
    FROM "memo" m
    LEFT JOIN memo_source_consumed s ON s.memo_id = m."id"
    LEFT JOIN memo_target_settled t ON t.memo_id = m."id"
    WHERE m."companyId" = _company_id AND m."customerId" IS NOT NULL
      AND m."status" = 'Posted' AND m."postingDate" <= _as_of_date
  )
  -- Preserve totalAmount/settled's existing per-document denomination:
  -- invoices carry base; memo amount/settled carry memo currency.
  SELECT i."customerId", i."id" AS "documentId", i."invoiceId" AS "documentNumber",
    'Invoice'::TEXT AS "documentType", i."dateDue", i."currencyCode", i."exchangeRate",
    i."totalAmount", i.settled_base AS "settled",
    i.remaining_document AS "openInCurrency",
    i.remaining_base AS "openInBase"
  FROM invoice_open i
  WHERE i.remaining_document <> 0 OR i.remaining_base <> 0
  UNION ALL
  SELECT m."customerId", m."id", m."memoId", m."direction" || ' Memo',
    NULL::DATE, m."currencyCode", m."exchangeRate", m."amount", m.settled_document,
    (CASE WHEN m."direction" = 'Credit' THEN -1 ELSE 1 END) * m.remaining_document,
    (CASE WHEN m."direction" = 'Credit' THEN -1 ELSE 1 END)
      * m.remaining_base
  FROM memo_open m
  WHERE m.remaining_document <> 0 OR m.remaining_base <> 0
  ORDER BY 1, 5 NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION get_ap_open_by_supplier(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "supplierId" TEXT,
  "documentId" TEXT,
  "documentNumber" TEXT,
  "documentType" TEXT,
  "dateDue" DATE,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC,
  "totalAmount" NUMERIC,
  "settled" NUMERIC,
  "openInCurrency" NUMERIC,
  "openInBase" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH effective_settlements AS (
    SELECT s.*
    FROM "invoiceSettlement" s
    LEFT JOIN "payment" p ON p."id" = s."paymentId"
      AND p."companyId" = s."companyId"
    LEFT JOIN "memo" source_memo ON source_memo."id" = s."memoId"
      AND source_memo."companyId" = s."companyId"
    LEFT JOIN "payment" applying ON applying."id" = s."appliedViaPaymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND (
        (s."paymentId" IS NOT NULL AND p."status" = 'Posted'
          AND p."postingDate" <= _as_of_date)
        OR (s."memoId" IS NOT NULL AND source_memo."status" = 'Posted'
          AND source_memo."postingDate" <= _as_of_date
          AND ((s."appliedViaPaymentId" IS NULL AND s."appliedDate" <= _as_of_date) OR
            (applying."status" = 'Posted' AND applying."postingDate" <= _as_of_date)))
      )
  ), invoice_settled AS (
    SELECT s."targetPurchaseInvoiceId" AS invoice_id,
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS settled_base,
      SUM(COALESCE(s."sourceAmount", 0) + round(
        (s."discountAmount" + s."writeOffAmount") * target."exchangeRate",
        target_currency."decimalPlaces")) AS settled_document
    FROM effective_settlements s
    JOIN "purchaseInvoice" target ON target."id" = s."targetPurchaseInvoiceId"
      AND target."companyId" = s."companyId"
    LEFT JOIN "company" target_company ON target_company."id" = target."companyId"
    LEFT JOIN "currency" target_currency ON target_currency."code" = target."currencyCode"
      AND target_currency."companyGroupId" = target_company."companyGroupId"
    WHERE s."targetPurchaseInvoiceId" IS NOT NULL
    GROUP BY s."targetPurchaseInvoiceId"
  ), memo_source_consumed AS (
    SELECT s."memoId" AS memo_id, SUM(s."sourceAmount") AS settled_document,
      SUM(s."appliedAmount" - s."fxGainLossAmount") AS settled_base
    FROM effective_settlements s
    WHERE s."memoId" IS NOT NULL
    GROUP BY s."memoId"
  ), memo_target_settled AS (
    -- Preserve existing cash-to-memo rows without adding a new refund workflow.
    -- These fields relieve the TARGET memo in base, unlike sourceAmount.
    SELECT s."targetMemoId" AS memo_id, SUM(s."appliedAmount") AS settled_base
    FROM effective_settlements s
    WHERE s."targetMemoId" IS NOT NULL AND s."paymentId" IS NOT NULL
    GROUP BY s."targetMemoId"
  ), invoice_carrying AS (
    -- Same original control snapshots used by post-payment; a document rate
    -- conversion cannot reconstruct carrying value after document rounding.
    SELECT line."documentId" AS invoice_id, SUM(abs(line."amount")) AS original_base
    FROM "journalLine" line
    JOIN "journal" j ON j."id"=line."journalId" AND j."companyId"=line."companyId"
    WHERE line."companyId"=_company_id AND line."documentType"='Invoice'
      AND line."description"='Accounts Payable' AND j."sourceType"='Purchase Invoice'
      AND j."status"='Posted' AND j."postingDate"<=_as_of_date
    GROUP BY line."documentId"
  ), invoice_open AS (
    SELECT i.*, COALESCE(s.settled_base, 0) AS settled_base,
      amounts.remaining_document,
      COALESCE(c.original_base, round(i."totalAmount",5)) - COALESCE(s.settled_base,0) AS remaining_base
    FROM "purchaseInvoices" i
    JOIN "purchaseInvoice" ib ON ib."id" = i."id" AND ib."companyId" = i."companyId"
    LEFT JOIN invoice_settled s ON s.invoice_id = i."id"
    LEFT JOIN invoice_carrying c ON c.invoice_id = i."id"
    LEFT JOIN "company" invoice_company ON invoice_company."id" = i."companyId"
    LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = i."currencyCode"
      AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
    CROSS JOIN LATERAL (
      SELECT round(i."totalAmount" * i."exchangeRate", invoice_currency."decimalPlaces")
        - COALESCE(s.settled_document, 0) AS remaining_document
    ) amounts
    WHERE i."companyId" = _company_id
      AND i."postingDate" <= _as_of_date
      AND i."status" NOT IN ('Draft', 'Pending', 'Voided')
      AND NOT (ib."status" = 'Paid'
        AND (ib."datePaid" IS NULL OR ib."datePaid" <= _as_of_date))
  ), memo_open AS (
    SELECT m.*,
      round(m."amount"/m."exchangeRate",5) - COALESCE(s.settled_base,0) - COALESCE(t.settled_base,0) AS remaining_base,
      COALESCE(s.settled_document, 0) + COALESCE(t.settled_base, 0) * m."exchangeRate" AS settled_document,
      m."amount" - COALESCE(s.settled_document, 0)
        - COALESCE(t.settled_base, 0) * m."exchangeRate" AS remaining_document
    FROM "memo" m
    LEFT JOIN memo_source_consumed s ON s.memo_id = m."id"
    LEFT JOIN memo_target_settled t ON t.memo_id = m."id"
    WHERE m."companyId" = _company_id AND m."supplierId" IS NOT NULL
      AND m."status" = 'Posted' AND m."postingDate" <= _as_of_date
  )
  -- Preserve totalAmount/settled's existing per-document denomination:
  -- invoices carry base; memo amount/settled carry memo currency.
  SELECT i."supplierId", i."id" AS "documentId", i."invoiceId" AS "documentNumber",
    'Invoice'::TEXT AS "documentType", i."dateDue", i."currencyCode", i."exchangeRate",
    i."totalAmount", i.settled_base AS "settled",
    i.remaining_document AS "openInCurrency",
    i.remaining_base AS "openInBase"
  FROM invoice_open i
  WHERE i.remaining_document <> 0 OR i.remaining_base <> 0
  UNION ALL
  SELECT m."supplierId", m."id", m."memoId", m."direction" || ' Memo',
    NULL::DATE, m."currencyCode", m."exchangeRate", m."amount", m.settled_document,
    (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END) * m.remaining_document,
    (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END)
      * m.remaining_base
  FROM memo_open m
  WHERE m.remaining_document <> 0 OR m.remaining_base <> 0
  ORDER BY 1, 5 NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION get_ar_tie_out(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "subledgerBalance" NUMERIC,
  "glBalance" NUMERIC,
  "variance" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH funding_consumed AS (
    SELECT COALESCE(s."sourcePaymentId", s."paymentId") AS source_payment_id,
      SUM(s."appliedAmount" + s."fxGainLossAmount") AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), payment_unapplied AS (
    SELECT (round(p."totalAmount" / p."exchangeRate",5) - COALESCE(c.source_base_amount,0)) AS open_base
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id AND p."paymentType" = 'Receipt'
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
  ), subledger AS (
    SELECT COALESCE((SELECT SUM(o."openInBase")
      FROM get_ar_open_by_customer(_company_id, _as_of_date) o), 0)
      - COALESCE((SELECT SUM(open_base) FROM payment_unapplied), 0) AS amount
  ), control_account AS (
    -- A default change affects future postings; historical invoice, payment
    -- and memo control accounts remain part of this company's subledger.
    -- UNION deduplicates repeated control rows and overlap with current defaults.
    SELECT unnest(ARRAY["receivablesAccount", "intercompanyReceivablesAccount"]) AS account_id
    FROM "accountDefault" WHERE "companyId" = _company_id
    UNION
    SELECT line."accountId"
    FROM "journalLine" line
    JOIN "journal" j ON j."id" = line."journalId" AND j."companyId" = line."companyId"
    WHERE line."companyId" = _company_id
      AND j."status" = 'Posted' AND j."postingDate" <= _as_of_date
      AND (
        (j."sourceType" = 'Sales Invoice' AND line."documentType" = 'Invoice'
          AND line."description" = 'Accounts Receivable')
        OR (j."sourceType" = 'Payment' AND line."documentType" = 'Payment'
          AND line."description" IN ('Accounts Receivable',
            'Accounts Receivable (on-account credit)', 'Accounts Receivable (credit applied)'))
        OR (j."sourceType" IN ('Credit Memo', 'Debit Memo') AND line."documentType" = 'Memo'
          AND line."description" = 'Accounts Receivable')
      )
  ), gl AS (
    SELECT COALESCE(SUM(jl."amount"), 0) AS amount
    FROM "journalLine" jl
    JOIN "journal" j ON j."id" = jl."journalId" AND j."companyId" = jl."companyId"
    JOIN control_account a ON a.account_id = jl."accountId"
    WHERE jl."companyId" = _company_id
      AND j."postingDate" <= _as_of_date AND j."status" = 'Posted'
  )
  SELECT subledger.amount AS "subledgerBalance", gl.amount AS "glBalance",
    subledger.amount - gl.amount AS "variance"
  FROM subledger, gl;
$$;

CREATE OR REPLACE FUNCTION get_ap_tie_out(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "subledgerBalance" NUMERIC,
  "glBalance" NUMERIC,
  "variance" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH funding_consumed AS (
    SELECT COALESCE(s."sourcePaymentId", s."paymentId") AS source_payment_id,
      SUM(s."appliedAmount" - s."fxGainLossAmount") AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), payment_unapplied AS (
    SELECT (round(p."totalAmount" / p."exchangeRate",5) - COALESCE(c.source_base_amount,0)) AS open_base
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id AND p."paymentType" = 'Disbursement'
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
  ), subledger AS (
    SELECT COALESCE((SELECT SUM(o."openInBase")
      FROM get_ap_open_by_supplier(_company_id, _as_of_date) o), 0)
      - COALESCE((SELECT SUM(open_base) FROM payment_unapplied), 0) AS amount
  ), control_account AS (
    SELECT unnest(ARRAY["payablesAccount", "intercompanyPayablesAccount"]) AS account_id
    FROM "accountDefault" WHERE "companyId" = _company_id
    UNION
    SELECT line."accountId"
    FROM "journalLine" line
    JOIN "journal" j ON j."id" = line."journalId" AND j."companyId" = line."companyId"
    WHERE line."companyId" = _company_id
      AND j."status" = 'Posted' AND j."postingDate" <= _as_of_date
      AND (
        (j."sourceType" = 'Purchase Invoice' AND line."documentType" = 'Invoice'
          AND line."description" = 'Accounts Payable')
        OR (j."sourceType" = 'Payment' AND line."documentType" = 'Payment'
          AND line."description" IN ('Accounts Payable',
            'Accounts Payable (on-account credit)', 'Accounts Payable (credit applied)'))
        OR (j."sourceType" IN ('Credit Memo', 'Debit Memo') AND line."documentType" = 'Memo'
          AND line."description" = 'Accounts Payable')
      )
  ), gl AS (
    SELECT COALESCE(SUM(jl."amount"), 0) AS amount
    FROM "journalLine" jl
    JOIN "journal" j ON j."id" = jl."journalId" AND j."companyId" = jl."companyId"
    JOIN control_account a ON a.account_id = jl."accountId"
    WHERE jl."companyId" = _company_id
      AND j."postingDate" <= _as_of_date AND j."status" = 'Posted'
  )
  SELECT subledger.amount AS "subledgerBalance", gl.amount AS "glBalance",
    subledger.amount - gl.amount AS "variance"
  FROM subledger, gl;
$$;

CREATE OR REPLACE FUNCTION get_ar_aging(
  _company_id TEXT,
  _as_of_date DATE,
  _aging_method TEXT DEFAULT 'dueDate',
  _bucket1 INTEGER DEFAULT 30,
  _bucket2 INTEGER DEFAULT 60,
  _bucket3 INTEGER DEFAULT 90
)
RETURNS TABLE (
  "customerId" TEXT,
  "paymentTerm" TEXT,
  "current" NUMERIC,
  "bucket1" NUMERIC,
  "bucket2" NUMERIC,
  "bucket3" NUMERIC,
  "bucket4" NUMERIC,
  "unapplied" NUMERIC,
  "total" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH funding_consumed AS (
    SELECT COALESCE(s."sourcePaymentId", s."paymentId") AS source_payment_id,
      SUM(s."appliedAmount" + s."fxGainLossAmount") AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), open_items AS (
    SELECT o."customerId",
      CASE WHEN o."documentType" = 'Invoice' THEN
        CASE WHEN _aging_method = 'documentDate' THEN COALESCE(i."dateIssued", i."postingDate")
          ELSE o."dateDue" END
        ELSE m."memoDate" END AS age_date,
      o."openInBase" AS open_base
    FROM get_ar_open_by_customer(_company_id, _as_of_date) o
    LEFT JOIN "salesInvoice" i ON i."id" = o."documentId"
      AND i."companyId" = _company_id AND o."documentType" = 'Invoice'
    LEFT JOIN "memo" m ON m."id" = o."documentId"
      AND m."companyId" = _company_id AND o."documentType" <> 'Invoice'
  ),
  buckets AS (
    SELECT
      "customerId",
      COALESCE(SUM(open_base) FILTER (WHERE age_date IS NULL OR age_date >= _as_of_date), 0) AS "current",
      COALESCE(SUM(open_base) FILTER (WHERE age_date < _as_of_date AND _as_of_date - age_date BETWEEN 1 AND _bucket1), 0) AS "bucket1",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date BETWEEN _bucket1 + 1 AND _bucket2), 0) AS "bucket2",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date BETWEEN _bucket2 + 1 AND _bucket3), 0) AS "bucket3",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date > _bucket3), 0) AS "bucket4"
    FROM open_items
    WHERE open_base <> 0
    GROUP BY "customerId"
  ),
  unapplied AS (
    SELECT p."customerId",
      -COALESCE(SUM((round(p."totalAmount" / p."exchangeRate",5) - COALESCE(c.source_base_amount,0))), 0) AS "unapplied"
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id AND p."paymentType" = 'Receipt'
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
      AND p."customerId" IS NOT NULL
    GROUP BY p."customerId"
  )
  SELECT
    COALESCE(ib."customerId", u."customerId") AS "customerId",
    pt."name" AS "paymentTerm",
    COALESCE(ib."current", 0) AS "current",
    COALESCE(ib."bucket1", 0) AS "bucket1",
    COALESCE(ib."bucket2", 0) AS "bucket2",
    COALESCE(ib."bucket3", 0) AS "bucket3",
    COALESCE(ib."bucket4", 0) AS "bucket4",
    COALESCE(u."unapplied", 0) AS "unapplied",
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) AS "total"
  FROM buckets ib
  FULL OUTER JOIN unapplied u ON u."customerId" = ib."customerId"
  LEFT JOIN "customerPayment" cp
    ON cp."customerId" = COALESCE(ib."customerId", u."customerId")
    AND cp."companyId" = _company_id
  LEFT JOIN "paymentTerm" pt ON pt."id" = cp."paymentTermId"
  WHERE
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) <> 0
  ORDER BY "total" DESC;
$$;

CREATE OR REPLACE FUNCTION get_ap_aging(
  _company_id TEXT,
  _as_of_date DATE,
  _aging_method TEXT DEFAULT 'dueDate',
  _bucket1 INTEGER DEFAULT 30,
  _bucket2 INTEGER DEFAULT 60,
  _bucket3 INTEGER DEFAULT 90
)
RETURNS TABLE (
  "supplierId" TEXT,
  "paymentTerm" TEXT,
  "current" NUMERIC,
  "bucket1" NUMERIC,
  "bucket2" NUMERIC,
  "bucket3" NUMERIC,
  "bucket4" NUMERIC,
  "unapplied" NUMERIC,
  "total" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH funding_consumed AS (
    SELECT COALESCE(s."sourcePaymentId", s."paymentId") AS source_payment_id,
      SUM(s."appliedAmount" - s."fxGainLossAmount") AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), open_items AS (
    SELECT o."supplierId",
      CASE WHEN o."documentType" = 'Invoice' THEN
        CASE WHEN _aging_method = 'documentDate' THEN COALESCE(i."dateIssued", i."postingDate")
          ELSE o."dateDue" END
        ELSE m."memoDate" END AS age_date,
      o."openInBase" AS open_base
    FROM get_ap_open_by_supplier(_company_id, _as_of_date) o
    LEFT JOIN "purchaseInvoice" i ON i."id" = o."documentId"
      AND i."companyId" = _company_id AND o."documentType" = 'Invoice'
    LEFT JOIN "memo" m ON m."id" = o."documentId"
      AND m."companyId" = _company_id AND o."documentType" <> 'Invoice'
  ),
  buckets AS (
    SELECT
      "supplierId",
      COALESCE(SUM(open_base) FILTER (WHERE age_date IS NULL OR age_date >= _as_of_date), 0) AS "current",
      COALESCE(SUM(open_base) FILTER (WHERE age_date < _as_of_date AND _as_of_date - age_date BETWEEN 1 AND _bucket1), 0) AS "bucket1",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date BETWEEN _bucket1 + 1 AND _bucket2), 0) AS "bucket2",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date BETWEEN _bucket2 + 1 AND _bucket3), 0) AS "bucket3",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date > _bucket3), 0) AS "bucket4"
    FROM open_items
    WHERE open_base <> 0
    GROUP BY "supplierId"
  ),
  unapplied AS (
    SELECT p."supplierId",
      -COALESCE(SUM((round(p."totalAmount" / p."exchangeRate",5) - COALESCE(c.source_base_amount,0))), 0) AS "unapplied"
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id AND p."paymentType" = 'Disbursement'
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
      AND p."supplierId" IS NOT NULL
    GROUP BY p."supplierId"
  )
  SELECT
    COALESCE(ib."supplierId", u."supplierId") AS "supplierId",
    pt."name" AS "paymentTerm",
    COALESCE(ib."current", 0) AS "current",
    COALESCE(ib."bucket1", 0) AS "bucket1",
    COALESCE(ib."bucket2", 0) AS "bucket2",
    COALESCE(ib."bucket3", 0) AS "bucket3",
    COALESCE(ib."bucket4", 0) AS "bucket4",
    COALESCE(u."unapplied", 0) AS "unapplied",
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) AS "total"
  FROM buckets ib
  FULL OUTER JOIN unapplied u ON u."supplierId" = ib."supplierId"
  LEFT JOIN "supplierPayment" sp
    ON sp."supplierId" = COALESCE(ib."supplierId", u."supplierId")
    AND sp."companyId" = _company_id
  LEFT JOIN "paymentTerm" pt ON pt."id" = sp."paymentTermId"
  WHERE
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) <> 0
  ORDER BY "total" DESC;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

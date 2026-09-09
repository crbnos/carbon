# Payment Discount Account Reclassification (Customer → Contra-Revenue, Supplier → Contra-COGS)

> Status: draft
> Author: Claude (autonomous /feature run, for Brad)
> Date: 2026-09-08

## TLDR

Carbon posts early-payment cash discounts to two GL accounts — `customerPaymentDiscountAccount`
(seeded `7030`) and `supplierPaymentDiscountAccount` (seeded `7020`) — both classified as
`Expense` / `Other Expense`. That is wrong under ASC 606 / IFRS 15 and out of step with
QuickBooks, NetSuite, and Dynamics 365 BC: a **customer** early-payment discount is a reduction
of the transaction price (**contra-revenue**), and a **supplier** discount taken is a reduction
of the cost of goods (**contra-COGS**), never an operating expense. It is also internally
inconsistent — customer *credit memos* already post to the contra-revenue `salesDiscountAccount`
(`4020`), so the same economic event (a customer discount) lands in two different P&L sections
depending on whether it came via a memo or an early payment.

This spec reclassifies both accounts to their correct GL homes (customer → `Revenue`, supplier →
`Cost of Goods Sold`), keeping them as dedicated accounts (not consolidated onto `4020`). It
fixes the seed data for new companies **and** migrates existing companies' chart rows. The
posting code is made class-driven (mirroring the already-correct `post-memo`) so a journal
line's natural-balance sign follows the account's actual `class` instead of a hardcoded literal.
Posted journal *history* is not rewritten.

Research: `.ai/research/customer-payment-discount-classification.md`.

## Problem Statement

`packages/database/supabase/functions/lib/seed.data.ts:762-763` seeds:

- `7020` "Supplier Payment Discounts" — `class: Expense`, `accountType: Other Expense`, parent `other-expenses`
- `7030` "Customer Payment Discounts" — `class: Expense`, `accountType: Other Expense`, parent `other-expenses`

At payment time (`post-payment/build-payment-journal.ts:235-248`) the discount line is pushed
with a hardcoded abstract type `"expense"`:

```ts
pushLine(cashIn ? "debit" : "credit", "expense", round(discount * invRate), { accountId: discountAccountId, ... })
```

So a customer taking an early-payment discount produces `DR Bank (net) + DR "Customer Payment
Discount" (expense) + CR AR (gross)` — booking the forgone amount as an **operating expense**.

Three things are wrong:

1. **Standard.** ASC 606 / IFRS 15 treat a prompt-payment discount as variable consideration —
   a reduction of the transaction price, i.e. **contra-revenue**. Not an expense. (Deloitte, PwC,
   ACCA, IFRSbox — see research.)
2. **Peers.** QuickBooks ("Sales discounts should be a reduction in income, not an expense"),
   NetSuite, and Dynamics 365 BC all post the customer side to a revenue-reducing account. Only
   SAP defaults to expense, and it is the enterprise outlier. Carbon matches only SAP.
3. **Internal inconsistency.** Customer credit memos post to `salesDiscountAccount` (`4020`,
   `class: Revenue`, parent `revenue`) via `post-memo/index.ts:241-243`. The early-payment path
   uses the expense-classed `7030`. The same event is split across two P&L sections.

Supplier symmetry: `supplierPaymentDiscountAccount` (`7020`) is also `Expense`. A vendor discount
taken is a **reduction of cost of goods** (GAAP-preferred: net method / reduction of
inventory-COGS; gross method: a purchase-discount contra-account under COGS). It is used by both
`post-payment` (AP branch, `cashIn=false` → credits the account) and `post-memo` (supplier reason
account).

## Proposed Solution

Reclassify both accounts to their correct GL homes, keep them dedicated, and make the payment
posting class-driven. No new tables, no schema changes — this is chart-of-accounts *data* plus a
one-line-shaped posting fix.

### Target classification (reclassify AND renumber)

The accounts are both reclassified and **renumbered** into their correct blocks — a `7xxx`
"Other Expenses" number is wrong for a Revenue/COGS account (the number is the reader's first
signal of where an account lives). Renumber is safe here: `accountDefault` stores the account
**id** (not the number), so the default mappings travel automatically; `key` is kept equal to
`number` so the `seed-company` subsidiary path (which keys its id-map by `number`) stays correct.

| Account | Old → New number/Name | class | accountType | incomeBalance | parent group |
|---|---|---|---|---|---|
| Customer payment discount | `7030` → **`4040`** "Customer Payment Discounts" | `Revenue` | `Income` | `Income Statement` | `revenue` |
| Supplier payment discount | `7020` → **`5080`** "Supplier Payment Discounts" | `Expense` | `Cost of Goods Sold` | `Income Statement` | `cogs` |

Customer target mirrors the existing `4020` "Sales Discounts" exactly (`seed.data.ts`). `4040` is
the next free number in the Revenue block (`4010/4020/4030`); `5080` is the next free number in
the COGS block (`5010/5050/5060/5070`) — both verified free in `seed.data.ts` and the reset-chart
migration.
Supplier target joins the `cogs` group (`seed.data.ts:720-724`), whose accountType is already
`Cost of Goods Sold` / class `Expense`.

### Why the journal stays balanced with only a sign change

`build-payment-journal.ts` tracks the debit/credit balance via `signedDebitTotal`, which is driven
by the line **side** (`side === "debit" ? +magnitude : -magnitude`, line 169) — *not* by the
abstract `accountType`. The `accountType` only sets the stored `amount`'s natural-balance sign via
`debit`/`credit` in `lib/utils.ts` (`debit("expense")=+amt`, `debit("revenue")=-amt`). So:

- **Customer (AR)**: keep the line a **debit** (a debit to a revenue account = contra-revenue),
  change its abstract type `expense → revenue`. `signedDebitTotal` contribution is unchanged →
  the journal still balances. Stored `amount` flips from `+discount` to `-discount` (natural
  credit-balance account debited), which is the correct contra-revenue representation.
- **Supplier (AP)**: the line is a **credit**; a contra-COGS account is still `Expense` natural
  balance, so the abstract type stays `expense`. `credit("expense") = -amount` unchanged. No sign
  change at all — only the chart classification moves.

### Class-driven posting (root-cause fix, mirrors post-memo)

Rather than replacing the hardcoded `"expense"` with a second hardcode (`isAR ? "revenue" :
"expense"`), adopt the pattern `post-memo` already uses: derive the abstract type from the
account's real `class`. `post-memo/index.ts:255-274` resolves the reason account's `class` and
passes `reasonAccountClass` into `buildMemoJournal`, which maps it via the exported
`accountTypeFromClass(glClass)` helper (`build-memo-journal.ts:35-52`). This is why **post-memo
needs zero change** — reclassifying `7020` flows through automatically.

Apply the same to payments:

1. Move `accountTypeFromClass` from `post-memo/build-memo-journal.ts` to `lib/utils.ts` (next to
   `debit`/`credit`); re-export or import it in `build-memo-journal.ts` so nothing else breaks.
2. `post-payment/index.ts`: resolve the `class` of the selected discount account (the one chosen
   at lines 423-425) with a single `client.from("account").select("class").eq("id", …).single()`,
   and pass it into `buildPaymentJournal` as `accounts.discountAccountClass`.
3. `build-payment-journal.ts`: the discount line uses
   `accountTypeFromClass(discountAccountClass)` instead of the literal `"expense"`. Keep the side
   (`cashIn ? "debit" : "credit"`) exactly as-is.

This removes the hardcoded assumption entirely, so the sign follows the chart even if a company
later repoints the default at a differently-classed account — the same robustness `post-memo`
already has. `write-off` and `FX` lines are left as-is: they are out of scope for this feature and
their seeded defaults (`6320` expense / `4130` revenue / `7060` loss / `4120` gain) already match
their hardcoded types.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Customer classification | `class: Revenue`, `accountType: Income`, parent `revenue` | Contra-revenue per ASC 606/IFRS 15 + QB/NetSuite/BC; mirrors existing `4020` |
| Supplier classification | `class: Expense`, `accountType: Cost of Goods Sold`, parent `cogs` | Reduction of cost of goods (net-method direction), not other income/expense |
| Reclassify vs consolidate | Keep `7030` distinct from `4020`; keep `7020` dedicated | User decision; matches SAP/NetSuite/BC keeping a dedicated cash-discount line for reporting |
| Renumber 7020/7030 → 4040/5080 | **Yes** (reversed after user review) | A `7xxx` number for a Revenue/COGS account is misleading. `accountDefault` stores the account **id**, so renumbering doesn't remap defaults; `key` is kept == `number` so the `seed-company` subsidiary path (id-map keyed by number) stays correct. Applied in `seed.data.ts` (fresh) + the forward migration (existing DBs) |
| Posting sign source | Class-driven via `accountTypeFromClass` (not a 2nd hardcode) | Root-cause fix; mirrors the already-correct `post-memo`; robust to reconfiguration |
| `post-memo` changes | None | Already class-driven; supplier reclassification flows through |
| Existing companies | Migrate chart rows via UPDATE | User asked for a migration; existing accounting is throwaway test data |
| Posted journal history | Not rewritten | Going-forward correctness only; historical lines keep their original account/sign |
| Heuristic 1-7 (new tables/services/RLS/forms) | N/A | No new table, service, route, form, or RLS — data + edge-function posting logic only |

## Data Model Changes

No schema changes (no new columns, tables, or types). Two data changes:

### 1. Seed data (new companies) — `seed.data.ts` — the authoritative source for a fresh `crbn reset`

**This is the change that actually takes effect on `crbn reset`.** On a volume-wiped reset there
are zero `companyGroup` rows when migrations run, so `reset-chart-of-accounts.sql`'s `DO` block
inserts nothing; the dev company's chart is seeded *afterward* from `seed.data.ts` via
`bootstrap.ts` (and the `seed-company` edge function for onboarding). So the seed file — not the
migration — is what a fresh reset reads.

- Move the two account records out of the `7000` "Other Expenses" block into their proper blocks,
  renumbered: `4040` "Customer Payment Discounts" after `4030` (Revenue), `5080` "Supplier Payment
  Discounts" after `5070` (COGS). `key` == `number` on both.
- Update the `accountDefaults` mapping: `customerPaymentDiscountAccount → "4040"`,
  `supplierPaymentDiscountAccount → "5080"` (it maps by account `key`).

### 2. Forward migration (existing / cloud companies)

Only relevant for databases already seeded with `7020`/`7030` (cloud, or a dev DB not reset). On a
fresh `crbn reset` this migration is inert (no accounts exist when it runs). `reset-chart-of-accounts.sql`
(`20260315000000`) is applied on `main` and is NOT edited — retro-editing it is both a never-edit
violation and inert on a fresh reset. Fix forward with `20260909014032_payment-discount-reclassification.sql`.

Per company group, `UPDATE "account"` matched by the OLD `number`, setting **`number`** (renumber),
`class`, `accountType`, `incomeBalance`, and `parentId`. The `account` table is scoped by
**`companyGroupId`** (no `companyId`); the parent group id is resolved via a correlated subquery on
the group row (`isGroup = TRUE`, matched by `name`), wrapped in `COALESCE(subquery, a."parentId")`
so a group missing the target parent keeps its current one rather than orphaning. `accountDefault`
is untouched — it stores the account **id**, which the renumber preserves.

```sql
-- Customer: 7030 → 4040, Revenue, parent "Revenue"
UPDATE "account" a SET
  "number" = '4040', "class" = 'Revenue', "accountType" = 'Income',
  "incomeBalance" = 'Income Statement',
  "parentId" = COALESCE((SELECT g."id" FROM "account" g
    WHERE g."companyGroupId" = a."companyGroupId" AND g."isGroup" = TRUE AND g."name" = 'Revenue' LIMIT 1), a."parentId")
WHERE a."number" = '7030';

-- Supplier: 7020 → 5080, Expense/COGS, parent "Cost of Goods Sold"
UPDATE "account" a SET
  "number" = '5080', "class" = 'Expense', "accountType" = 'Cost of Goods Sold',
  "incomeBalance" = 'Income Statement',
  "parentId" = COALESCE((SELECT g."id" FROM "account" g
    WHERE g."companyGroupId" = a."companyGroupId" AND g."isGroup" = TRUE AND g."name" = 'Cost of Goods Sold' LIMIT 1), a."parentId")
WHERE a."number" = '7020';
```

Idempotent: matched by the OLD number, so once renumbered the `WHERE` no-ops. Verified against the
live schema: `account.number`, `class` (enum `glAccountClass`), `accountType` (enum `accountType`,
includes `Income`/`Cost of Goods Sold`), `parentId` (FK → `account.id`), `isGroup`, `companyGroupId`.

**`accountDefault` is not touched** — the reclassified rows keep their ids, so the existing
`customerPaymentDiscountAccount` / `supplierPaymentDiscountAccount` FKs remain valid.

## API / Service Changes

Edge functions only (no ERP service/model changes):

- `packages/database/supabase/functions/lib/utils.ts` — add `accountTypeFromClass(glClass)`
  (moved from `build-memo-journal.ts`).
- `packages/database/supabase/functions/post-memo/build-memo-journal.ts` — import
  `accountTypeFromClass` from `lib/utils.ts` (or keep a re-export) instead of defining it.
- `packages/database/supabase/functions/post-payment/build-payment-journal.ts` — add
  `discountAccountClass` to `PaymentJournalAccounts`; use `accountTypeFromClass(discountAccountClass)`
  for the discount line in place of `"expense"`.
- `packages/database/supabase/functions/post-payment/index.ts` — resolve the selected discount
  account's `class` and pass it as `accounts.discountAccountClass`.

## UI Changes

**Account Defaults form** (`AccountDefaultsForm.tsx`): the "Customer Payment Discounts" field's
`badgeType` changes `"Expense" → "Revenue"`. `badgeType` drives BOTH the row's class badge and the
account-picker options (`options={accountOptions[field.badgeType]}`, where `accountOptions` filters
by `account.class`). With `badgeType: "Expense"` the picker only lists class=Expense accounts, so
after 7030 is reclassified to Revenue the picker is empty and the saved value can't render — this
was missed in the original "UI Changes: None" (the self-review overlooked the badge=class coupling).
The **supplier** field stays `"Expense"`: 7020 remains class Expense (COGS), so it still resolves.
Same one-property pattern already used by `assetGainOnDisposalAccount` (`badgeType: "Revenue"`).

The accounting integration sync payload (`integrations.$id.tsx:773-808`) is unaffected — it maps by
account id, which does not change.

## Acceptance Criteria

- [ ] `seed.data.ts` seeds `4040` "Customer Payment Discounts" (`class: Revenue / accountType:
      Income / parent: revenue`) and `5080` "Supplier Payment Discounts" (`class: Expense /
      accountType: Cost of Goods Sold / parent: cogs`); no `7020`/`7030` remain; `accountDefaults`
      maps `customerPaymentDiscountAccount → "4040"`, `supplierPaymentDiscountAccount → "5080"`.
- [ ] A new company (fresh `crbn reset`) shows "Customer Payment Discounts" numbered **4040 under
      Revenue** and "Supplier Payment Discounts" numbered **5080 under Cost of Goods Sold** in the
      chart of accounts, and the Account Defaults screen resolves both pickers.
- [ ] The forward migration renumbers + reclassifies existing companies' `7030→4040` / `7020→5080`
      rows, and the `customerPaymentDiscountAccount`/`supplierPaymentDiscountAccount` defaults still
      resolve (FK by id survives the renumber).
- [ ] `accountTypeFromClass` lives in `lib/utils.ts`; `build-memo-journal.ts` and
      `build-payment-journal.ts` both use it; `post-memo` behavior is byte-for-byte unchanged
      (its golden-master test still passes).
- [ ] Unit test: posting a **customer** early-payment discount emits the discount line as a
      **debit to a Revenue-class account** (stored `amount` negative), the entry balances
      (`signedDebitTotal ≈ 0`), and `assertBalanced` passes.
- [ ] Unit test: posting a **supplier** early-payment discount emits the discount line as a
      **credit to an Expense-class (COGS) account**, entry balances.
- [ ] Existing `post-payment.test.ts` golden-master permutations updated for the new discount
      sign and still pass (`deno test`); all non-discount lines byte-identical.
- [ ] `pnpm db:check:datasets` passes (all four datasets still apply).
- [ ] `pnpm db:check:backups` gives a verdict (no schema-shape change).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Golden-master payment tests break on the sign flip | Med (expected) | Intentional; update expected fixtures for the discount line only, assert every other line is unchanged |
| Migration parent/column-name assumption wrong (`parentId`/`isGroup`) | Med | Verify against live `account` schema in the plan before finalizing SQL; the UPDATE is a no-op if the WHERE/subquery misses |
| A company customized `7020`/`7030` or repointed the default | Low | User confirmed existing accounting is throwaway test data; number-match is scoped and documented (see Open Questions Q7) |
| Reports/aggregations assume the discount amount's old sign | Low | Sign is natural-balance-consistent with the new class; anything summing by account class stays correct. `get_job_quantity_on_hand` etc. don't read these accounts |
| Accounting sync pushes stale classification to Xero/QBO | Low | Sync maps by account id, unchanged; classification is Carbon-internal. Verify payload in execute |

## Open Questions

> All resolved autonomously (fully-autonomous /feature run). Human reviews at the PR.

- [x] Customer classification (parent/accountType) — **Autonomous:** `Revenue`/`Income`/parent
      `revenue`, mirroring `4020`. Contra-revenue per ASC 606/IFRS 15 + peer consensus.
- [x] Supplier classification — **Autonomous:** `Expense`/`Cost of Goods Sold`/parent `cogs`.
      Reduction of cost of goods, not other income/expense.
- [x] Renumber vs reclassify-in-place — **RESOLVED WITH USER (reversed):** renumber `7030→4040`
      (Revenue block) and `7020→5080` (COGS block). A `7xxx` number for a Revenue/COGS account is
      misleading; safe because `accountDefault` stores the account id (not number) and `key` is
      kept == `number` for the subsidiary seed path. Applied in `seed.data.ts` + the forward migration.
- [x] post-payment sign mechanism — **Autonomous:** class-driven via `accountTypeFromClass`
      (mirror `post-memo`), not a second hardcode. Side unchanged → journal stays balanced.
- [x] post-memo changes — **Autonomous:** none; already class-driven.
- [x] Migration approach — **RESOLVED WITH USER:** the fresh-`crbn reset` chart comes from
      `seed.data.ts` via `bootstrap.ts`, NOT the reset-chart migration (no company groups exist at
      migration time on a wiped reset) — so `seed.data.ts` is the authoritative edit; the forward
      migration `20260909014032` (renumber + reclassify by old number) covers existing/cloud DBs;
      `reset-chart-of-accounts.sql` is left untouched (applied + inert on reset).
- [x] Companies that customized `7020`/`7030` or repointed the default — **Autonomous:** out of
      scope (throwaway test data); migration matches by old number. Documented limitation.

## Changelog

- 2026-09-08: Created. All open questions resolved autonomously as part of a fully-autonomous
  /feature run (research → spec). Design grounded in `build-payment-journal.ts`,
  `build-memo-journal.ts`, `post-payment/index.ts`, `post-memo/index.ts`, `lib/utils.ts`, and
  `seed.data.ts`.
- 2026-09-08 (user review): (1) Added the Account Defaults UI change (customer field
  `badgeType: "Revenue"` — the picker filters by `badgeType === account.class`, previously "None").
  (2) Reversed the renumber decision: renumber `7030→4040` (Revenue) and `7020→5080` (COGS), applied
  in `seed.data.ts` (authoritative for a fresh `crbn reset` — chart seeds from `bootstrap.ts`, not
  the reset-chart migration) and folded into the forward migration for existing DBs.

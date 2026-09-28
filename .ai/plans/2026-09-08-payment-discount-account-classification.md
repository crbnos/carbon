# Payment Discount Account Reclassification — implementation plan

**Spec:** .ai/specs/2026-09-08-payment-discount-account-classification.md
**Research:** .ai/research/customer-payment-discount-classification.md
**Run record:** .ai/runs/2026-09-08-payment-discount-classification.md
**Branch:** abuja

## Progress
- [x] Task 1: Move `accountTypeFromClass` to `lib/utils.ts`
- [x] Task 2: Make the payment discount line class-driven (`build-payment-journal.ts`)
- [x] Task 3: Pass the discount account's class from `post-payment/index.ts`
- [x] Task 4: Update / add `post-payment.test.ts` discount assertions
- [x] Task 5: Reclassify `7020`/`7030` in `seed.data.ts` (new companies)
- [x] Task 6: Forward migration reclassifying existing `7020`/`7030` rows
- [x] Task 7: Final verification gates

## Dependencies
- Task 2 depends on Task 1 (import of `accountTypeFromClass`).
- Task 3 depends on Task 2 (the new `discountAccountClass` field).
- Task 4 depends on Tasks 2–3.
- Tasks 5 and 6 are independent of 1–4 and of each other (data changes), but keep them after so the test suite is green first.
- Task 7 is last.

## Grounded facts (verified against code — do not re-derive)
- `account` table: PK is **`id` alone**; tenant column is **`companyGroupId`** (there is NO `companyId` on `account`). `number` is unique per `companyGroupId`. Parent linkage column is **`parentId`** (FK → `account(id)`). Group flag is **`isGroup` BOOLEAN**. Group rows have `number = NULL`, identified by `name` + `isGroup = TRUE`.
- Enums: `class` = `glAccountClass` ∈ {Asset,Liability,Equity,Revenue,Expense}; `accountType` = `accountType` (includes Income, Cost of Goods Sold, Expense, Other Expense, …); `incomeBalance` = `glIncomeBalance` ∈ {Balance Sheet, Income Statement}.
- Target rows: customer `7030` → `class='Revenue', accountType='Income', incomeBalance='Income Statement'`, parent group name `'Revenue'`. Supplier `7020` → `class='Expense', accountType='Cost of Goods Sold', incomeBalance='Income Statement'`, parent group name `'Cost of Goods Sold'`.
- `accountTypeFromClass` is defined at `post-memo/build-memo-journal.ts:34-49`, used only once (same file, line 147). `lib/utils.ts:126` already has a private `type AccountType = "asset"|"liability"|"equity"|"revenue"|"expense"`.
- `build-payment-journal.ts:235-248` discount line is hardcoded `pushLine(cashIn ? "debit" : "credit", "expense", ...)`. Balance (`signedDebitTotal`) is driven by SIDE, not `accountType` — so changing the abstract type does not unbalance the entry.
- `post-payment/index.ts:403-433` calls `buildPaymentJournal`; `accounts.discountAccountId` is `isAR ? ad.customerPaymentDiscountAccount : ad.supplierPaymentDiscountAccount`. It does NOT currently fetch any account `class`.
- `post-payment.test.ts`: `ACCOUNTS` constant (lines 20-26) is typed `PaymentJournalAccounts`; adding a REQUIRED field breaks it → the new field must be OPTIONAL. AR discount asserted at lines 158-161 (`amount === 10`) and 718; no `"Supplier Payment Discount"` assertion exists.
- Deno tests: run from `packages/database/supabase/functions/`, command `deno test --no-lock <file>` (task alias `deno task test`). No package.json/turbo wiring.
- `reset-chart-of-accounts.sql` (20260315000000) is applied on `main` — NEVER edit it; fix forward with a new migration.

---

## Task 1: Move `accountTypeFromClass` to `lib/utils.ts`

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/functions/lib/utils.ts` — add exported `accountTypeFromClass`
- Modify: `packages/database/supabase/functions/post-memo/build-memo-journal.ts` — delete the local definition, import from `lib/utils.ts`

**Steps:**
1. In `lib/utils.ts`, directly after the `debit`/`credit` block (after line 154), add:
   ```ts
   // glAccountClass (Asset|Liability|Equity|Revenue|Expense) → the lowercase
   // AccountType the debit/credit helpers expect. Shared by the payment and memo
   // journal builders so a line's natural-balance sign follows the account's class.
   export function accountTypeFromClass(glClass: string): AccountType {
     switch (glClass) {
       case "Asset":
         return "asset";
       case "Liability":
         return "liability";
       case "Equity":
         return "equity";
       case "Revenue":
         return "revenue";
       case "Expense":
         return "expense";
       default:
         throw new Error(`Unknown GL account class: ${glClass}`);
     }
   }
   ```
   Reuse the existing private `AccountType` at line 126 (do NOT declare a second one). The error string must remain exactly `Unknown GL account class: ${glClass}` — `post-memo.test.ts:91` asserts `"Unknown GL account class"`.
2. In `build-memo-journal.ts`: delete the local `accountTypeFromClass` (lines 34-49) and the now-unused local `type AccountType` at line 30 **only if** nothing else in the file uses it — check: `credit`/`debit` are imported from `lib/utils.ts`, so line 30's `AccountType` is likely only used by the deleted function. If line 30 `AccountType` is referenced elsewhere in the file, keep it. Update the import on line 31 from `import { credit, debit } from "../lib/utils.ts";` to `import { accountTypeFromClass, credit, debit } from "../lib/utils.ts";`.
3. If any other file imported `accountTypeFromClass` from `build-memo-journal.ts`, repoint it (grep confirmed none today, but re-check).

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-lock post-memo/post-memo.test.ts
# Expected: all post-memo tests pass (ok). The "Unknown GL account class" throw case still passes.
grep -rn "accountTypeFromClass" packages/database/supabase/functions
# Expected: definition now in lib/utils.ts; imported+used in build-memo-journal.ts; used in build-payment-journal.ts after Task 2. No duplicate definition.
```

**Out of scope:** `credit`/`debit` bodies; any change to memo posting behavior.

---

## Task 2: Make the payment discount line class-driven

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/supabase/functions/post-payment/build-payment-journal.ts`

**Steps:**
1. Add the import: change line 44 `import { credit, debit } from "../lib/utils.ts";` to `import { accountTypeFromClass, credit, debit } from "../lib/utils.ts";`.
2. In `interface PaymentJournalAccounts` (lines 73-79) add an **optional** field (optional so existing test literals still compile):
   ```ts
   // The discount account's glAccountClass. Drives the discount line's natural-
   // balance sign so a customer discount (Revenue) debits contra-revenue and a
   // supplier discount (Expense/COGS) credits contra-cost. Resolved by index.ts.
   discountAccountClass?: string | null;
   ```
3. Destructure it alongside the other accounts (lines 139-145): add `discountAccountClass,`.
4. In the discount block (lines 235-248), keep the side and magnitude exactly as-is; change only the abstract type. Replace:
   ```ts
   pushLine(cashIn ? "debit" : "credit", "expense", round(discount * invRate), {
   ```
   with:
   ```ts
   pushLine(
     cashIn ? "debit" : "credit",
     discountAccountClass ? accountTypeFromClass(discountAccountClass) : "expense",
     round(discount * invRate),
     {
   ```
   (Keep the closing `}`/`);` and the `accountId`/`description`/`documentLineReference` fields unchanged.) The `? … : "expense"` fallback preserves behavior for any caller that does not pass a class; `index.ts` (Task 3) always passes it in production.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-lock post-payment/post-payment.test.ts
# Expected AFTER this task alone: the AR-discount assertions FAIL (still expect 10) — that is corrected in Task 4. All non-discount cases pass and every case still balances.
```
If a test other than the AR-discount ones (lines 158-161, 718) fails, or any `signedDebitTotal` balance assertion fails, STOP and report — the change was meant to alter only the discount line's stored sign, not any balance.

**Out of scope:** write-off line, FX lines, bank/control lines — leave their hardcoded abstract types unchanged.

---

## Task 3: Resolve and pass the discount account's class from `index.ts`

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/supabase/functions/post-payment/index.ts`

**Steps:**
1. Before the `buildPaymentJournal(...)` call (line 403), compute the selected discount account id and fetch its class. Insert:
   ```ts
   const discountAccountId = isAR
     ? ad.customerPaymentDiscountAccount
     : ad.supplierPaymentDiscountAccount;
   let discountAccountClass: string | null = null;
   if (discountAccountId) {
     const discountAccount = await client
       .from("account")
       .select("class")
       .eq("id", discountAccountId)
       .single();
     if (discountAccount.error || !discountAccount.data) {
       throw new Error("Failed to fetch the payment discount account class");
     }
     discountAccountClass = discountAccount.data.class as string;
   }
   ```
   Place this in the same `accountingEnabled` scope where `ad` (accountDefaults) is available and where `buildPaymentJournal` is called. If `ad` is not in scope at that point, resolve it the same way the surrounding code already reads `ad.customerPaymentDiscountAccount`.
2. In the `accounts` object passed to `buildPaymentJournal` (lines 421-431), replace the inline `discountAccountId: isAR ? ad.customerPaymentDiscountAccount : ad.supplierPaymentDiscountAccount,` with `discountAccountId,` (the const from step 1) and add `discountAccountClass,`.

   Note this mirrors `post-memo/index.ts:255-274`, which already fetches the reason account's `class` the same way.

**Verify:**
```bash
grep -n "discountAccountClass" packages/database/supabase/functions/post-payment/index.ts
# Expected: the const is resolved from a client.from("account").select("class") read and passed into the accounts object.
```
Full typecheck of the edge functions is not part of the ERP turbo graph; rely on Task 7's `generate:types` + the deno tests. If `client.from("account").select("class")` cannot resolve `.class` on the generated type, STOP and report (the column exists; a type miss would indicate a stale generated type).

**Out of scope:** changing how `controlAccountId`, write-off, or FX accounts are resolved.

---

## Task 4: Update and extend the payment discount tests

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `packages/database/supabase/functions/post-payment/post-payment.test.ts`

**Steps:**
1. In the shared `ACCOUNTS` constant (lines 20-26) add `discountAccountClass: "Revenue",` (the customer/AR default; AP cases that need "Expense" override it locally in step 3). This keeps the common AR path exercising the contra-revenue sign.
2. Update the AR-discount case (the test titled `"AR discount: bank 90 / receivables 100 / discount expense 10"`, lines ~139-162):
   - Rename the title to `"AR discount: bank 90 / receivables 100 / discount contra-revenue -10"`.
   - Change the discount amount assertion from `assertEquals(discount.amount, 10);` to `assertEquals(discount.amount, -10); // debit to a Revenue-class account (contra-revenue)`.
   - Leave the `Bank / Cash` (90) and `Accounts Receivable` (-100) assertions unchanged, and keep any `balanced(signedDebitTotal)` assertion.
3. Update the combined AR case that asserts `Customer Payment Discount` at line ~718: change its expected amount from `10` to `-10`.
4. Add a NEW AP test proving the supplier contra-COGS direction (none exists today). Model it on the AP write-off case (lines ~187-208) but with a discount application and `discountAccountClass: "Expense"`:
   - Build an AP payment (`isAR: false, cashIn: false`) with one application having `discountAmount` (e.g. 10), `appliedAmount` such that cash balances, `targetExchangeRate: 1`.
   - Pass `accounts: { ...apBase().accounts, discountAccountClass: "Expense" }` (or set it on the AP fixture).
   - Assert `line(lines, "Supplier Payment Discount")!.amount === -10` (credit to an Expense/COGS account → `credit("expense",10) = -10`) and `line(...).accountId === "discount"`, plus `balanced(signedDebitTotal)`.
5. If the property `matrix` test (lines ~841-891) passes a discount without a class, it now falls through to the `"expense"` default and still balances — leave it, but if it began asserting a discount sign, update it to the class it supplies.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-lock post-payment/post-payment.test.ts
# Expected: ALL cases pass (ok), including the updated AR contra-revenue (-10) and the new AP contra-COGS (-10) discount assertions.
```
If any non-discount line's expected value had to change to make the suite pass, STOP and report — only the discount line's stored sign should have moved.

**Out of scope:** rewriting unrelated golden-master cases; changing write-off/FX expectations.

---

## Task 5: Reclassify `7020`/`7030` in the seed data (new companies)

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts`

**Steps:**
1. Edit the `7030` record (line 763) from:
   ```ts
   { key: "7030", number: "7030", name: "Customer Payment Discounts", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
   ```
   to (mirroring `4020` "Sales Discounts", line 709):
   ```ts
   { key: "7030", number: "7030", name: "Customer Payment Discounts", isGroup: false, parentKey: "revenue", accountType: "Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" },
   ```
2. Edit the `7020` record (line 762) from:
   ```ts
   { key: "7020", number: "7020", name: "Supplier Payment Discounts", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
   ```
   to (joining the `cogs` group, lines 720-724):
   ```ts
   { key: "7020", number: "7020", name: "Supplier Payment Discounts", isGroup: false, parentKey: "cogs", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
   ```
3. Do NOT change the `accountDefaults` mapping (lines 793-794): `supplierPaymentDiscountAccount: "7020"` and `customerPaymentDiscountAccount: "7030"` stay — they resolve by key to the same (now reclassified) accounts.

**Verify:**
```bash
grep -n '"7030"\|"7020"' packages/database/supabase/functions/lib/seed.data.ts
# Expected: 7030 now parentKey "revenue"/accountType "Income"/class "Revenue"; 7020 now parentKey "cogs"/accountType "Cost of Goods Sold"/class "Expense"; both still mapped in accountDefaults.
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: passes — the string literals are valid for the seed record type.
```
If the seed record type rejects `accountType: "Cost of Goods Sold"` or `parentKey: "cogs"`, STOP and report (the `cogs` group key and that accountType are used elsewhere in the same file, so this should type-check).

**Out of scope:** any other account row; the `accountDefaults` object; renumbering.

---

## Task 6: Forward migration reclassifying existing `7020`/`7030`

**Depends on:** none (independent data change)
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_payment-discount-reclassification.sql`

**Steps:**
1. Create the migration file (do NOT hand-pick the timestamp; do NOT use `000000` for HHMMSS):
   ```bash
   pnpm db:migrate:new payment-discount-reclassification
   ```
2. Write idempotent UPDATEs scoped by `number` (unique per `companyGroupId`), resolving the parent group id per company group via a correlated subquery on the group row (`isGroup = TRUE`, matched by `name`). `account` has **no `companyId`** — its tenant column is `companyGroupId`. Use `COALESCE(subquery, a."parentId")` so a company group missing the target group keeps its current parent instead of being orphaned (belt-and-suspenders; all seeded charts have these groups).
   ```sql
   -- Reclassify the payment-discount accounts to their correct GL homes.
   -- Customer early-payment discount is contra-revenue (ASC 606 / IFRS 15);
   -- supplier discount taken is a reduction of cost of goods (contra-COGS).
   -- Going-forward only: posted journalLine history is intentionally NOT rewritten.
   -- Idempotent: fixed target state, safe to re-run.

   -- Customer Payment Discounts (7030) -> Revenue (contra-revenue), parent "Revenue"
   UPDATE "account" a SET
     "class" = 'Revenue',
     "accountType" = 'Income',
     "incomeBalance" = 'Income Statement',
     "parentId" = COALESCE(
       (SELECT g."id" FROM "account" g
        WHERE g."companyGroupId" = a."companyGroupId"
          AND g."isGroup" = TRUE
          AND g."name" = 'Revenue'
        LIMIT 1),
       a."parentId"
     )
   WHERE a."number" = '7030';

   -- Supplier Payment Discounts (7020) -> Expense/COGS (contra-cost), parent "Cost of Goods Sold"
   UPDATE "account" a SET
     "class" = 'Expense',
     "accountType" = 'Cost of Goods Sold',
     "incomeBalance" = 'Income Statement',
     "parentId" = COALESCE(
       (SELECT g."id" FROM "account" g
        WHERE g."companyGroupId" = a."companyGroupId"
          AND g."isGroup" = TRUE
          AND g."name" = 'Cost of Goods Sold'
        LIMIT 1),
       a."parentId"
     )
   WHERE a."number" = '7020';
   ```
3. Do NOT touch `accountDefault` — the reclassified rows keep their ids, so the `customerPaymentDiscountAccount` / `supplierPaymentDiscountAccount` FKs stay valid.
4. Do NOT edit `20260315000000_reset-chart-of-accounts.sql` (applied on `main`).

**Verify:**
```bash
# Static checks only — DB apply is the user's job (never rebuild the DB yourself).
test -f packages/database/supabase/migrations/*payment-discount-reclassification.sql && echo "migration file created"
grep -c "companyGroupId" packages/database/supabase/migrations/*payment-discount-reclassification.sql
# Expected: file exists; the UPDATEs scope the parent subquery by companyGroupId (not companyId).
```
If `enum glAccountClass`/`accountType` rejects any literal at apply time, STOP — but the literals (`'Revenue'`,`'Income'`,`'Cost of Goods Sold'`,`'Expense'`,`'Income Statement'`) were verified valid. Applying the migration (`pnpm db:migrate`) and confirming in the UI is left to the user.

**Out of scope:** rewriting `journalLine` history; renumbering; `accountDefault`; any other account row.

---

## Task 7: Final verification gates

**Depends on:** Tasks 1–6
**Files:** none (verification only)

**Steps + Verify:**
```bash
# 1) Regenerate types (no shape change expected — no schema/column change).
pnpm run generate:types
# Expected: completes; git diff on packages/database/src/types.ts is empty or trivial. If it changes account columns, STOP — this feature adds none.

# 2) Scoped typecheck (NEVER whole-repo).
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: passes.

# 3) Edge-function unit tests.
cd packages/database/supabase/functions && deno test --no-lock post-payment/post-payment.test.ts post-memo/post-memo.test.ts && cd -
# Expected: all pass (ok). If deno is not installed, report that these could not be run locally — do NOT mark the test criterion green.

# 4) Dataset drift gate (reads live schema; writes nothing).
pnpm db:check:datasets
# Expected: all four datasets still apply (or the "database unreachable/no users" warning-skip — report which).
```
- `pnpm db:migrate` / `db:check:backups` require applying the migration to the live DB — that is the **user's** step; note it in the handoff, do not run a DB rebuild.

**Out of scope:** committing (the /feature run stops at a gated PR; commit via /check-and-commit only when asked).

---

## Acceptance criteria coverage
- Spec AC "seed 7030/7020 reclassified" → Task 5.
- "new company shows accounts under Revenue / COGS" → Task 5 (+ user UI check after migrate).
- "migration reclassifies existing rows, defaults still resolve" → Task 6.
- "accountTypeFromClass in lib/utils.ts; both builders use it; post-memo unchanged" → Tasks 1, 2 (+ post-memo test in Task 1 verify).
- "unit test: customer discount debits Revenue-class, balances" → Task 4 step 2.
- "unit test: supplier discount credits Expense/COGS, balances" → Task 4 step 4.
- "golden-master permutations updated, all pass" → Task 4 + Task 7 step 3.
- "db:check:datasets passes" → Task 7 step 4.
- "db:check:backups gives a verdict" → user step (Task 7 note).

# Chart of Accounts Import — implementation plan

**Spec:** .ai/specs/2026-10-12-chart-of-accounts-import.md
**Research:** .ai/research/chart-of-accounts-remap.md
**Branch:** chart-of-accounts-mapping-import

> Tasks 1–19 below build the first design: one sheet with a `Carbon Account`
> column, reclass journals and inactive accounts. The user's review replaced it
> with 2 required files and an import that runs only before the cutover. The
> spec's changelog ("Redesign after user review") has the new design. Tasks
> 21–27 are the redesign. Read the spec, not Tasks 10–15, for the current
> behavior.

## Progress
- [x] Task 1: Make account deletes refuse while lines refer to the account
- [x] Task 2: Regenerate the database types
- [x] Task 3: Add the import constants and types to `@carbon/database`
- [x] Task 4: Write the planner tests (red)
- [x] Task 5: Implement `planAccountImport` (green)
- [x] Task 6: Implement `loadAccountImportContext`
- [x] Task 7: Add the `apply-account-import` server function
- [x] Task 8: Add the live-database tests for the server function
- [x] Task 9: Stop stamping a cutover on new companies, and seed subsidiary defaults by id
- [x] Task 10: Add `active` to the account form
- [x] Task 11: Offer Deactivate when an account is in use
- [x] Task 12: Add the CSV parser for the import
- [x] Task 13: Add the template download route
- [x] Task 14: Add the import route and review page
- [x] Task 15: Add Import, Download and Show inactive to the Chart of Accounts page
- [x] Task 16: Add the Chart of accounts step to the activation wizard
- [x] Task 17: Show the Accounting module in the Implementation Hub before cutover
- [x] Task 18: Add the sync callout to accounting integrations
- [x] Task 19: Update the docs, rules and AGENTS.md files
- [x] Task 20: Verify in the browser
- [x] Task 21: Plan from 2 files: `planAccountImport(chartRows, defaultRows, ctx, resolutions)`, refuse on any cutover, drop reclass and deactivate
- [x] Task 22: Apply from 2 files: set every company's defaults and fixed asset class accounts, delete instead of deactivate
- [x] Task 23: Copy a subsidiary's fixed asset class accounts from the group in `seed-company`
- [x] Task 24: Remove the Active switch, Show inactive, Download and the deactivate intent; disable Delete for an account with journal lines
- [x] Task 25: Add `parseChartCsv`, `parseDefaultsCsv`, `defaultAccountsTemplate` and the template route
- [x] Task 26: Rewrite the import page for 2 uploads; no header rule on a setup page with no steps
- [x] Task 27: Update the spec, docs and AGENTS.md files
- [x] Task 28: Move posted documents with their journals (`20261013035046`)
- [x] Task 29: Fix the self-review findings (spec changelog 2026-10-13)

## Dependencies

- Task 2 needs Task 1.
- Tasks 3 → 4 → 5 → 6 → 7 → 8 run in order.
- Task 9 is independent. It may run in parallel with Tasks 3–8.
- Tasks 10, 11 and 12 are independent of each other. They need Task 2.
- Task 13 needs Task 3 (`ROLE_NAMES`).
- Task 14 needs Tasks 7 and 12.
- Task 15 needs Tasks 13 and 14.
- Task 16 needs Task 14.
- Tasks 17 and 18 are independent.
- Task 19 needs Tasks 1–18.
- Task 20 needs every other task.

## Shared terms

| Term | Meaning |
|---|---|
| leaf account | An `account` row with `isGroup = false` |
| group | An `account` row with `isGroup = true` |
| control role | An entry of `CONTROL_ROLES` (Task 3) |
| required role | An `ACCOUNT_DEFAULT_COLUMNS` entry that `hasDefaultFallback` returns false for |
| posted lines | `journalLine` rows whose journal `status` is in `GL_JOURNAL_STATUSES` or is `Superseded` (`hasPostedLines`) |
| reclass balance | Σ `amount` of lines whose journal `status` is in `GL_JOURNAL_STATUSES` only. Never Superseded. |
| movable reference | A reference that `REFERENCE_POLICY` lets the apply re-point (Task 3) |

---

## Task 1: Make account deletes refuse while lines refer to the account

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_account-delete-restrict.sql` (via the command below)
- Copy from (precedent): `packages/database/supabase/migrations/20260315000000_reset-chart-of-accounts.sql` lines 461–478

**Steps:**
1. Run `pnpm db:migrate:new account-delete-restrict`.
2. Write this SQL into the new file:

```sql
-- A journal line or a document line must never lose its account. SET NULL
-- silently emptied Draft and Provisional lines when an account was deleted.
-- RESTRICT refuses the delete, so the user deactivates the account instead.

ALTER TABLE "journalLine" DROP CONSTRAINT IF EXISTS "journalLine_accountId_fkey";
ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "purchaseOrderLine" DROP CONSTRAINT IF EXISTS "purchaseOrderLine_accountId_fkey";
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "salesOrderLine" DROP CONSTRAINT IF EXISTS "salesOrderLine_accountId_fkey";
ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "salesInvoiceLine" DROP CONSTRAINT IF EXISTS "salesInvoiceLine_accountId_fkey";
ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT IF EXISTS "purchaseInvoiceLine_accountId_fkey";
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "supplierQuoteLine" DROP CONSTRAINT IF EXISTS "supplierQuoteLine_accountId_fkey";
ALTER TABLE "supplierQuoteLine" ADD CONSTRAINT "supplierQuoteLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
```

3. Run `pnpm db:migrate`.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -At -c "SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('journalLine_accountId_fkey','purchaseOrderLine_accountId_fkey','salesOrderLine_accountId_fkey','salesInvoiceLine_accountId_fkey','purchaseInvoiceLine_accountId_fkey','supplierQuoteLine_accountId_fkey') ORDER BY 1"
# Expected: 6 rows, each ending in |r
```

**Out of scope:** `shippingMethod_carrierAccountId_fkey` keeps `SET NULL`. Do not touch any other foreign key.

---

## Task 2: Regenerate the database types

**Depends on:** 1
**Files:**
- Modify: `packages/database/src/types.ts` (generated)

**Steps:**
1. Run `pnpm run generate:types`.

**Verify:**
```bash
git status --short packages/database/src
# Expected: no error from generate:types. types.ts may be unchanged, because foreign key actions do not appear in the types.
```

**Out of scope:** Never hand-edit `types.ts`.

---

## Task 3: Add the import constants and types to `@carbon/database`

**Depends on:** 2
**Files:**
- Create: `packages/database/src/account-import.ts`
- Modify: `packages/database/package.json` — add `"./account-import": "./src/account-import.ts"` next to `"./supersession-pick"`
- Copy from (precedent): `packages/database/src/supersession-pick.ts` (a pure module with a sibling test), `packages/database/src/accounting-cutover/shared.ts` lines 65–141 (`ACCOUNT_DEFAULT_COLUMNS` and the compile-time `Never` check)

**Steps:**
1. Start the file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` to write it.
2. Export `ROLE_NAMES: Record<AccountDefaultColumn, string>`. Copy each English label from `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx`. Use `satisfies` so a missing column fails the build.
3. Export `CONTROL_ROLES` with exactly these 14 entries: `receivablesAccount`, `payablesAccount`, `rawMaterialsAccount`, `finishedGoodsAccount`, `workInProgressAccount`, `costOfGoodsSoldAccount`, `goodsReceivedNotInvoicedAccount`, `retainedEarningsAccount`, `migrationClearingAccount`, `intercompanyReceivablesAccount`, `intercompanyPayablesAccount`, `bankCashAccount`, `bankLocalCurrencyAccount`, `bankForeignCurrencyAccount`.
4. Export `requiredRoles(): AccountDefaultColumn[]`. It returns every `ACCOUNT_DEFAULT_COLUMNS` entry where `hasDefaultFallback(role)` is false.
5. Export `REFERENCE_POLICY` as a readonly array of the following entries. Each entry is `{ table, column, policy, parent? }`. `policy` is `"repoint"`, `"repoint-if-draft"`, `"repoint-if-unposted-journal"` or `"history"`. `parent` is `{ table, column, statusColumn, draftStatuses }`. A row that a conditional policy does not move counts as a history reference.

| table | column | policy | parent |
|---|---|---|---|
| `fixedAssetClass` | each of `assetAccountId`, `accumulatedDepreciationAccountId`, `depreciationExpenseAccountId`, `writeOffAccountId`, `writeDownAccountId`, `lossOnDisposalAccountId`, `gainOnDisposalAccountId` | repoint | — |
| `shippingMethod` | `carrierAccountId` | repoint | — |
| `purchaseOrderLine` | `accountId` | repoint | — |
| `salesOrderLine` | `accountId` | repoint | — |
| `supplierQuoteLine` | `accountId` | repoint | — |
| `revenueRecognitionSchedule` | `debitAccountId`, `creditAccountId` | repoint | — |
| `salesInvoiceLine` | `accountId` | repoint-if-draft | `salesInvoice.id` via `invoiceId`, `status = 'Draft'` |
| `purchaseInvoiceLine` | `accountId` | repoint-if-draft | `purchaseInvoice.id` via `invoiceId`, `status = 'Draft'` |
| `chargeLine` | `accountId` | repoint-if-draft | `charge.id` via `chargeId`, `status = 'Draft'` |
| `charge` | `cardAccountId`, `offsetAccountId` | repoint-if-draft | the row itself, `status = 'Draft'` |
| `reimbursementLine` | `accountId` | repoint-if-draft | `reimbursement.id` via `reimbursementId`, `status = 'Draft'` |
| `reimbursement` | `payableAccountId` | repoint-if-draft | the row itself, `status = 'Draft'` |
| `payment` | `bankAccount` | repoint-if-draft | the row itself, `status = 'Draft'` |
| `memo` | `reasonAccount` | repoint-if-draft | the row itself, `status = 'Draft'` |
| `journalLine` | `accountId` | repoint-if-unposted-journal | `journal.id` via `journalId`, `status IN ('Draft','Provisional')` |
| `accountingPeriodBalance` | `accountId` | history | — |
| `accountingSyncTieOut` | `accountId` | history | — |

6. Do not list `accountDefault` or `account.parentId` in `REFERENCE_POLICY`. The apply moves default roles through `roleMoves`, and a leaf has no children.
7. If the tables `project`, `projectElement`, `indirectPool`, `indirectPoolAccount` and `indirectExpenseStatement` exist in `packages/database/src/types.ts` when you run this task, add these entries:

| table | column | policy |
|---|---|---|
| `project` | `costAccountId` | repoint |
| `projectElement` | `costAccountId` | repoint |
| `indirectPool` | `appliedAccountId` | repoint |
| `indirectPoolAccount` | `accountId` | repoint, with `dedupeOn: ["indirectPoolId", "accountId", "dimensionValueId", "role"]` |
| `indirectExpenseStatement` | `accountId` | history |

   If they do not exist, add a comment above `REFERENCE_POLICY` that lists the same 5 entries. The branch that merges second adds them.
8. Export `SOFT_REFERENCES`, which lists the 3 references without a foreign key: `intercompanyEliminationLine.accountId` (re-point when its `journalLineId`'s journal is Draft or Provisional), `externalIntegrationMapping` rows with `entityType = 'account'` (delete the source's rows), and `companyIntegration.metadata.paymentFeeAccount` (re-point).
9. Export these types. Use `AccountClass` from `./ledger` and `AccountDefaultColumn` from `./accounting-cutover/shared`:

```ts
export type AccountImportRow = {
  line: number;                 // file line; the header is line 1
  number: string;
  name: string;
  class: AccountClass | null;
  accountType: string | null;
  group: string;
  carbonAccounts: string[];     // numbers or role names, split on ";" and trimmed
};
export type ChartAccount = {
  id: string; number: string | null; name: string; class: AccountClass | null;
  accountType: string | null; incomeBalance: "Balance Sheet" | "Income Statement";
  parentId: string | null; isGroup: boolean; isSystem: boolean; active: boolean;
};
export type AccountUsage = {
  // Lines on Posted, Reversed or Superseded journals. Blocks a class change and
  // a control-account merge, and forces deactivate instead of delete.
  hasPostedLines: boolean;
  // Σ amount on Posted and Reversed journals only (GL_JOURNAL_STATUSES), per
  // company, nonzero only. Superseded is excluded: activation replaced it.
  reclassBalanceByCompany: Record<string, number>;
  movableReferencesByCompany: Record<string, number>; // rows REFERENCE_POLICY moves
  historyReferences: number;                          // rows it never moves
};
export type AccountImportCompany = { id: string; name: string; hasCutover: boolean };
export type AccountImportContext = {
  chart: ChartAccount[];                               // active AND inactive
  companies: AccountImportCompany[];
  defaultsByCompany: Record<string, Record<AccountDefaultColumn, string | null>>;
  usage: Record<string, AccountUsage>;                 // by account id
  importingCompanyId: string;
};
export type AccountImportResolutions = {
  targets: Record<string, number>;  // unclaimed account id → row line it merges into
};
```

10. Export the error and exception unions:

```ts
export type AccountImportError =
  | { code: "duplicate-number"; line: number; firstLine: number; value: string }
  | { code: "duplicate-name"; line: number; firstLine: number; value: string }
  | { code: "unknown-carbon-account"; line: number; value: string }
  | { code: "carbon-account-claimed-twice"; line: number; firstLine: number; accountId: string }
  | { code: "class-mismatch"; line: number; accountId: string }
  | { code: "missing-class"; line: number }
  | { code: "class-change-with-history"; line: number; accountId: string }
  | { code: "control-account-with-history"; accountId: string; role: AccountDefaultColumn }
  | { code: "migration-clearing-not-equity"; line: number }
  | { code: "taken-by-inactive-account"; line: number; field: "number" | "name"; accountId: string; retiredByThisImport: boolean }
  | { code: "target-not-in-sheet"; accountId: string; line: number };
export type AccountImportException = {
  code: "account-needs-target";
  accountId: string;
  reasons: ("references" | "required-role" | "balance")[];
  companyIds: string[];
};
```

11. Export the plan type:

```ts
export type AccountImportPlan = {
  renames: { accountId: string; line: number; number: string; name: string; group: string; accountType: string | null; reactivate: boolean }[];
  creates: { line: number; number: string; name: string; class: AccountClass; accountType: string | null; group: string }[];
  merges: { sourceId: string; targetLine: number }[];
  retires: { accountId: string; mode: "delete" | "deactivate" }[];
  roleMoves: { companyId: string; role: AccountDefaultColumn; fromAccountId: string; toLine: number | null }[]; // null = clear
  reclasses: { companyId: string; sourceId: string; targetLine: number; amount: number }[];
  groupCreates: { name: string; class: AccountClass }[];
  companies: { companyId: string; repointedReferences: number; roleMoves: number; reclasses: number }[];
  errors: AccountImportError[];
  exceptions: AccountImportException[];
};
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: Tasks: 1 successful
```

**Out of scope:** No planner logic yet. No database reads in this file except in Task 6.

---

## Task 4: Write the planner tests (red)

**Depends on:** 3
**Files:**
- Create: `packages/database/src/account-import.test.ts`
- Copy from (precedent): `packages/database/src/supersession-pick.test.ts`

**Steps:**
1. Build a fixture chart in the test file: a Balance Sheet root, an Income Statement root, 3 groups ("Current Assets", "Revenue", "Equity") and 9 leaf accounts. The leaves are 1010 Cash, 1110 Receivables, 1310 Raw Materials, 1320 Finished Goods, 3400 Migration Clearing, 3900 Retained Earnings, 4010 Sales, 4050 Shipping Revenue and an inactive 4090 Old Sales.
2. Build 2 companies: `c1` (no cutover) and `c2` (has a cutover). Give both the same defaults. Point `receivablesAccount` at 1110, `rawMaterialsAccount` at 1310, `finishedGoodsAccount` at 1320, `salesAccount` at 4010, `salesShippingRevenueAccount` at 4050, `migrationClearingAccount` at 3400 and `retainedEarningsAccount` at 3900.
3. Add a helper `templateRows(chart)` that returns one row per ACTIVE leaf with `carbonAccounts: [number]`.
4. Add a helper `usage(partial)` that fills the empty `AccountUsage` defaults.
5. Write one `it` per case below. Each asserts the exact plan fields named.

| # | Case | Expected |
|---|---|---|
| 1 | `templateRows` unchanged | every action array is empty; no errors; no exceptions |
| 2 | 1110 renumbered to 1200 and renamed | one `renames` entry with `reactivate: false`; no other action |
| 3 | 1010 ↔ 4010 numbers swapped (class kept) | 2 `renames`; no errors |
| 4 | 4010 row says `4010; 4050`, 4050 row removed | `merges` has 4050 → the 4010 row; `roleMoves` moves `salesShippingRevenueAccount` in `c1` and `c2`; `retires` has 4050 as `delete` |
| 5 | 1310 row says `1310; 1320`, 1320 row removed, no posted lines | merge allowed (control roles with no history) |
| 6 | case 5, but 1320 `hasPostedLines` | error `control-account-with-history` |
| 7 | 4050 row removed, no row names it, no resolution | exception `account-needs-target` with reason `required-role` (only if `hasDefaultFallback("salesShippingRevenueAccount")` is false; else the role is cleared and 4050 deleted — assert whichever `hasDefaultFallback` returns) |
| 8 | case 7 with `resolutions.targets[4050.id]` = the 4010 row | no exception; `merges` has 4050 → 4010 row; the role moves |
| 9 | an account with no roles and no usage removed | `retires` entry with mode `delete`; no exception |
| 10 | an account with no roles and `movableReferencesByCompany: { c1: 2 }` removed | exception with reason `references` and `companyIds: ["c1"]` |
| 11 | case 10 with a target | `merges` entry; `retires` mode `delete`; `companies` has `c1` with `repointedReferences: 2` |
| 12 | an account with `reclassBalanceByCompany: { c2: 500 }` and a target | `reclasses` entry for `c2` with amount 500; `retires` mode `deactivate` |
| 13 | an account with `hasPostedLines: true` and `reclassBalanceByCompany: {}` (Superseded only), removed | no exception; no reclass; `retires` mode `deactivate` |
| 14 | a new row with empty `carbonAccounts` | one `creates` entry |
| 15 | a new row with no class | error `missing-class` |
| 16 | 2 rows with the same number | error `duplicate-number` with both lines |
| 17 | 2 rows naming 1110 | error `carbon-account-claimed-twice` |
| 18 | a row naming `Accounts Receivable` | resolves to 1110 through `ROLE_NAMES` and `defaultsByCompany[importingCompanyId]` |
| 19 | a row naming `9999` | error `unknown-carbon-account` |
| 20 | row for 4010 with class Asset | error `class-mismatch` |
| 21 | 3400 row with class Revenue | error `migration-clearing-not-equity` |
| 22 | a row with group "Other Assets" | `groupCreates` has "Other Assets" with the row's class |
| 23 | a new row with number 4090 | error `taken-by-inactive-account`, `field: "number"`, `retiredByThisImport: false` |
| 24 | a row whose `carbonAccounts` is `4090` | `renames` entry with `reactivate: true`; no error |
| 25 | case 12 (4050 deactivated) plus a new row with number 4050 | error `taken-by-inactive-account`, `retiredByThisImport: true` |
| 26 | an unclaimed inactive account | no action; it is not retired again |

6. Run the tests. They must fail, because `planAccountImport` does not exist yet.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/account-import.test.ts
# Expected: FAIL — planAccountImport is not exported (or not a function)
```

**Out of scope:** No implementation in this task.

---

## Task 5: Implement `planAccountImport` (green)

**Depends on:** 4
**Files:**
- Modify: `packages/database/src/account-import.ts`

**Steps:**
1. Add `export function planAccountImport(rows: AccountImportRow[], ctx: AccountImportContext, resolutions: AccountImportResolutions): AccountImportPlan`.
2. Keep the function pure. It reads only its arguments.
3. Implement these passes in order:
   1. Validate rows. Check duplicate numbers and names (trimmed, case-insensitive), and a missing class on rows with no `carbonAccounts`.
   2. Resolve each `carbonAccounts` value. First match a leaf `number`, active or inactive. Else match a `ROLE_NAMES` value, case-insensitive, through `ctx.defaultsByCompany[ctx.importingCompanyId]`. Else add `unknown-carbon-account`.
   3. Record which row claims each account. A second claim adds `carbon-account-claimed-twice`.
   4. For each row with claims: the first claimed account is the rename target. Set `reactivate` when it is inactive. Every other claimed account becomes a merge source into that row.
   5. Compare classes. A row's class defaults to its first claimed account's class. Any claimed account with a different class adds `class-mismatch`. A rename that changes the class of an account with `hasPostedLines` adds `class-change-with-history`.
   6. Unclaimed accounts are the ACTIVE leaves that no row claims. Inactive leaves and groups are never unclaimed.
   7. Sort each unclaimed account:
      1. Collect its reasons: `references` if any `movableReferencesByCompany` value is above 0; `required-role` if a `requiredRoles()` column points at it in any company; `balance` if `reclassBalanceByCompany` has any entry.
      2. If there are reasons and `resolutions.targets[id]` names a row, make it a merge source into that row. If that line is not a row, add `target-not-in-sheet`.
      3. If there are reasons and no target, add exception `account-needs-target` with the reasons and the companies involved.
      4. If there are no reasons, clear each role that points at it (all of them have a fallback, by step 7.1), and retire it.
   8. Role moves: for every company and every role whose account is a merge source, move the role to the merge row.
   9. Control check: if a merge source backs a `CONTROL_ROLES` role in any company and `hasPostedLines` is true, add `control-account-with-history`.
   10. Reclasses: for each merge source, add one `reclasses` entry per company in `reclassBalanceByCompany`.
   11. Retires: each merge source and each unclaimed account without reasons retires. Use `deactivate` when `historyReferences > 0` or `hasPostedLines`. Else use `delete`.
   12. Inactive collisions: build the set of numbers and names held by inactive leaves that no row claims, plus accounts that step 11 deactivates. A row whose `number` or `name` is in that set adds `taken-by-inactive-account`. Set `retiredByThisImport` for the second kind.
   13. Groups: collect each `group` value that matches no existing group name. Add it to `groupCreates` with the row's class.
   14. Migration Clearing: if the row that ends up holding `migrationClearingAccount` for the importing company has a class other than Equity, add `migration-clearing-not-equity`.
   15. Companies: for each company, sum the merge sources' `movableReferencesByCompany`, count its `roleMoves` and its `reclasses`. List each company with a nonzero total.
4. Sort every output array by `line`, then by account number, so the output is deterministic.
5. Use `round` from `./precision` on each reclass amount. Use `equals` from `./precision` to drop zero balances.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/account-import.test.ts
# Expected: 26 passed
```

**Out of scope:** No database access. No writes.

---

## Task 6: Implement `loadAccountImportContext`

**Depends on:** 5
**Files:**
- Modify: `packages/database/src/account-import.ts`
- Copy from (precedent): `packages/database/src/accounting-cutover/readiness.ts` (Kysely reads that take `db`)

**Steps:**
1. Add `export async function loadAccountImportContext(db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>, companyGroupId: string, importingCompanyId: string): Promise<AccountImportContext>`.
2. Read the chart with one query on `account` where `companyGroupId` matches. Include inactive accounts.
3. Read the group's companies with one query on `company` joined to `companySettings`. Set `hasCutover` from `accountingCutoverDate IS NOT NULL`.
4. Read `accountDefault` with one query joined to `company` on `company.companyGroupId`.
5. Read journal usage with one query. Join `journalLine` to `journal`. Filter `journal.status` in `[...GL_JOURNAL_STATUSES, "Superseded"]` and `journal.companyId` in the group's companies. Group by `journalLine.accountId`, `journal.companyId` and `journal.status`.
   1. Any row sets `hasPostedLines`.
   2. Only rows with a status in `GL_JOURNAL_STATUSES` add to `reclassBalanceByCompany`.
6. Read reference counts with one `UNION ALL` query built from `REFERENCE_POLICY`. Each branch selects `accountId`, `companyId` and a `movable` flag. The flag is true when the policy's parent filter matches. Group by all 3. Never query once per account.
7. Return the context. An account with no usage rows gets `{ hasPostedLines: false, reclassBalanceByCompany: {}, movableReferencesByCompany: {}, historyReferences: 0 }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: Tasks: 1 successful
```

**Out of scope:** Do not change `readiness.ts`.

---

## Task 7: Add the `apply-account-import` server function

**Depends on:** 6
**Files:**
- Create: `packages/server-functions/src/apply-account-import/index.ts`
- Modify: `packages/server-functions/src/invoke.ts` — add `"apply-account-import": () => import("./apply-account-import"),` in alphabetical order
- Modify: `packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap` (regenerated by the test run)
- Copy from (precedent): `packages/server-functions/src/activate-accounting/index.ts` lines 45–76 and 207–255 (the opening journal insert)

**Steps:**
1. Define the input:

```ts
export const applyAccountImportInput = z.object({
  rows: z.array(z.object({
    line: z.number().int(), number: z.string().min(1), name: z.string().min(1),
    class: z.enum(["Asset","Liability","Equity","Revenue","Expense"]).nullable(),
    accountType: z.string().nullable(), group: z.string().min(1),
    carbonAccounts: z.array(z.string())
  })).min(1),
  resolutions: z.object({ targets: z.record(z.string(), z.number().int()) })
});
```

2. Use `defineServerFn({ name: "apply-account-import", input: applyAccountImportInput, permissions: { update: "accounting" }, run })`. Export it as the default export.
3. In `run`, open `db.transaction().execute(async (trx) => …)`.
4. Read the company's `companyGroupId` from `company` on `trx`.
5. Lock the chart: `SELECT id FROM account WHERE "companyGroupId" = $1 FOR UPDATE`.
6. Call `loadAccountImportContext(trx, companyGroupId, companyId)` and then `planAccountImport`.
7. If `plan.errors` or `plan.exceptions` is non-empty, throw `InvalidInputError` with the counts.
8. Create each `groupCreates` group under the root whose `incomeBalance` matches the class. Use `isGroup: true`, `number: null` and `createdBy: userId`.
9. Rename in 2 passes:
   1. Set `number = '__import_' || id` and `name = '__import_' || id` on every renamed account.
   2. Set the final `number`, `name`, `accountType` and `parentId`. Take `parentId` from the group's id. Set `active = true` when `reactivate` is true.
10. Insert each `creates` row as a leaf. Derive `incomeBalance` from the class. Use `consolidatedRate: "Average"`. Build a `line → accountId` map that covers renamed rows and created rows.
11. For each merge, run one `UPDATE` per `REFERENCE_POLICY` entry. Re-point the source id to the target id. Apply the policy's parent filter:
    - `repoint-if-draft` uses `WHERE <parent>.status = 'Draft'`.
    - `repoint-if-unposted-journal` uses `WHERE journal.status IN ('Draft','Provisional')`.
    - An entry with `dedupeOn` then deletes every row but the oldest in each `dedupeOn` group that holds the target id.
12. For each merge, also run the 3 `SOFT_REFERENCES` steps.
13. Apply `roleMoves` with one `UPDATE "accountDefault"` per company. Set each role column to the target row's account id, or `null` for a clear.
14. Post each `reclasses` entry as one journal per company:
    1. Resolve the period with `resolveAccountingPeriod(trx, companyId, today, "current")`. Get `today` from `datetime.today` in the company's timezone.
    2. Insert the journal: `sourceType: "Manual"`, `status: "Posted"`, `description: "Chart of accounts import: <source number> → <target number>"`.
    3. Get the id with `getNextSequence(trx, "journalEntry", companyId)`.
    4. Insert 2 lines. The source line is `-amount`. The target line is `+amount`. Both accounts have the same class, so the amounts move the balance as it is stored.
    5. Use `journalLineReference: nanoid()` on each line.
15. Apply `retires`. Use `DELETE` for mode `delete`. Use `UPDATE account SET active = false` for mode `deactivate`.
16. Delete each non-system group that has no children. Repeat until no group is deleted.
17. Check the postcondition. If any check fails, throw `InvalidInputError`:
    1. The active leaf accounts of the group equal the rows by number, name and class.
    2. In every company of the group, each `requiredRoles()` column points at an active leaf account.
    3. `migrationClearingAccount` points at an Equity account.
18. Return `{ counts: { renamed, reactivated, created, merged, deleted, deactivated }, reclassJournalIds }`.
19. If `resolveAccountingPeriod` refuses because no period is open, STOP and report. Do not create a period here.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/permissions-manifest.test.ts -u
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: the snapshot gains "apply-account-import" with { update: "accounting" }; typecheck: Tasks: 1 successful
```

**Out of scope:** Do not change `activate-accounting`. Do not add a `Reclass` journal source type.

---

## Task 8: Add the live-database tests for the server function

**Depends on:** 7
**Files:**
- Create: `packages/server-functions/src/apply-account-import/apply-account-import.test.ts`
- Copy from (precedent): `packages/server-functions/src/activate-accounting/activation-test-fixture.ts`, `packages/server-functions/src/local-database-test-fixture.ts` (`databaseTest`)

**Steps:**
1. Build a fixture group with one Provisional company (no cutover) and one company that has a cutover and an open period.
2. Write one `databaseTest` per case:

| # | Case | Expected |
|---|---|---|
| 1 | Rename and swap numbers on the Provisional company | `accountDefault` ids unchanged; numbers swapped |
| 2 | Merge 4050 into 4010 with a Provisional line on 4050 | the line's `accountId` is 4010's id; 4050 deleted |
| 3 | Remove the 4050 row with a Provisional line on 4050 and a target of the 4010 row | the line moves; 4050 deleted; no foreign key error |
| 4 | Merge with a Posted line on 4050 in the cutover company | one reclass journal, Posted, balanced; 4050 inactive; the Posted line still on 4050 |
| 5 | Merge with only a Superseded line on 4050 | no reclass journal; 4050 inactive |
| 6 | Remove a row that a required role needs, with no target | `InvalidInputError`; nothing changed |
| 7 | Reference completeness | a query of `pg_constraint` for every foreign key with `confrelid = 'account'::regclass` returns only columns that `REFERENCE_POLICY` lists, plus `accountDefault` columns and `account.parentId` |

3. Write case 7's query as in `packages/database/supabase/tests/ramp-charge-integrity.test.sql` lines 12–28.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/apply-account-import
# Expected: 7 passed (they skip if SUPABASE_DB_URL is not localhost — then run `pnpm db:migrate` and rerun)
```

**Out of scope:** Do not change existing fixtures.

---

## Task 9: Stop stamping a cutover on new companies, and seed subsidiary defaults by id

**Depends on:** none
**Files:**
- Modify: `packages/server-functions/src/seed-company/index.ts` — lines 394–444 and 492–506
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` — the comment at lines 57–63 only

**Steps:**
1. Delete the cutover block at `seed-company/index.ts` lines 492–506 ("A new company keeps its ledger in Carbon from day one…").
2. Remove the imports that only that block used (`startOfMonth`, `getCompanyTimeZone`), if nothing else uses them.
3. In the subsidiary branch, read one `accountDefault` row from a company in the same group. Use `parentCompanyId` first, else any company with `company.companyGroupId = companyGroupId`.
4. If that row exists, copy every `ACCOUNT_DEFAULT_COLUMNS` value into `resolvedDefaults`. Skip the number lookup at lines 441–444 for those columns.
5. Keep the number lookup only as the fallback when the group has no `accountDefault` row.
6. Keep `resolveShippingDefault` for `salesShippingRevenueAccount` when the copied row has none.
7. Change the comment in `01-foundation.ts` to say that seed-company no longer stamps a cutover, so tier 01 sets the only one.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/seed-company
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: all seed-company tests pass (shipping-default.test.ts included); typecheck: Tasks: 1 successful
```

**Out of scope:** Do not change dataset tier 01's UPSERT. Do not touch existing companies' cutover state.

---

## Task 10: Add `active` to the account form

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `accountValidator` (lines 329–384): add `active: zfd.checkbox()`
- Modify: `apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountForm.tsx` — add `<Boolean name="active" label={t`Active`} bordered />` after the `name` input
- Modify: `apps/erp/app/routes/x+/accounting+/charts.$accountId.tsx` — add `active: account.active` to `initialValues` (lines 163–174)
- Modify: `apps/erp/app/routes/x+/accounting+/charts.new.tsx` — default `active: true`
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/Dimensions/DimensionForm.tsx` line 130

**Steps:**
1. Add the field to the validator.
2. Import `Boolean` from `~/components/Form` in the form.
3. Add the switch.
4. Set the initial values in both routes.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
```

**Out of scope:** Do not add `active` to `groupAccountValidator`.

---

## Task 11: Offer Deactivate when an account is in use

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/charts.delete.$accountId.tsx`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — add `getAccountInUse(client, accountId)` and `deactivateAccount(client, accountId, userId)`
- Copy from (precedent): `apps/erp/app/routes/x+/sales+/no-quote-reasons.delete.$id.tsx` lines 55–65 (`getDatabaseErrorMessage`)

**Steps:**
1. Add `getAccountInUse`. It returns true when one `journalLine` row has `accountId = accountId` (`.limit(1)`).
2. Add `deactivateAccount`. It runs `update({ active: false, updatedBy })` on the account.
3. In the loader, return `inUse` with the account.
4. In the action, read `intent`. For `intent === "deactivate"`, call `deactivateAccount` and redirect with "Account deactivated".
5. For a delete error, call `getDatabaseErrorMessage(error, "Failed to delete account", { referenced: "This account has postings. Deactivate it instead." })`.
6. In the component, if `inUse`, render `ConfirmDelete` with the text "This account has postings. Deactivate it instead." and submit `intent=deactivate`. If `ConfirmDelete` cannot take a custom button label, use the `Modal` and `Button` from `@carbon/react` that `ConfirmDelete` itself uses.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
```

**Out of scope:** Do not change the `@mcp delete` tag on `deleteAccount`.

---

## Task 12: Add the CSV parser for the import

**Depends on:** 3
**Files:**
- Create: `apps/erp/app/modules/accounting/account-import-csv.ts`
- Create: `apps/erp/app/modules/accounting/account-import-csv.test.ts`
- Copy from (precedent): `apps/erp/app/modules/accounting/trial-balance-csv.ts` and its test

**Steps:**
1. Export `ACCOUNT_IMPORT_CSV_COLUMNS = ["Number","Name","Class","Type","Group","Carbon Account","Used For"] as const`.
2. Export `parseAccountImportCsv(csv: string)`. It uses `parseCsv` from `@carbon/files/csv`.
3. It returns `{ rows: AccountImportRow[]; errors: null } | { rows: null; errors: AccountImportCsvError[] }`.
4. Define the error codes: `empty-file`, `missing-columns`, `missing-number` (with `line`), `missing-name` (with `line`), `missing-group` (with `line`), `invalid-class` (with `line` and `value`).
5. Split `Carbon Account` on `;` and trim each part. Drop empty parts. Ignore `Used For`.
6. Write tests for each error code and for a 3-row valid file.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/accounting/account-import-csv.test.ts
# Expected: all tests pass
```

**Out of scope:** Do not touch `trial-balance-csv.ts`.

---

## Task 13: Add the template download route

**Depends on:** 3
**Files:**
- Create: `apps/erp/app/routes/api+/accounting.chart-of-accounts[.]csv.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `chartOfAccountsCsv: \`${api}/accounting/chart-of-accounts.csv\`` next to `costCenters` in the `api` block
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — add `getAccountImportTemplate(client, companyGroupId, companyId)`
- Copy from (precedent): `apps/erp/app/routes/api+/items.methods.$id.bom[.]csv.tsx` (the `Response` with `Content-Disposition`)

**Steps:**
1. Add `getAccountImportTemplate`. It reads the active leaf accounts, their group names and the company's `accountDefault` row.
2. It builds one row per leaf: number, name, class, type, group name, its own number, and the `ROLE_NAMES` of every role that points at it joined with `"; "`.
3. In the route loader, call `requirePermissions(request, { view: "accounting" })`.
4. Encode the rows with `encodeCsv` from `@carbon/files/csv` and `fields: [...ACCOUNT_IMPORT_CSV_COLUMNS]`.
5. Return `new Response(csv, { headers: { "Content-Type": CSV_CONTENT_TYPE, "Content-Disposition": "attachment; filename=chart-of-accounts.csv" } })`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
```

**Out of scope:** No upload in this task.

---

## Task 14: Add the import route and review page

**Depends on:** 7, 12
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/charts.import.tsx`
- Create: `apps/erp/app/modules/accounting/ui/ChartOfAccounts/AccountImportReview.tsx`
- Modify: `apps/erp/app/modules/accounting/ui/ChartOfAccounts/index.ts` — export the component
- Modify: `apps/erp/app/utils/path.ts` — add `chartOfAccountsImport: \`${x}/accounting/charts/import\`` next to `chartOfAccounts`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/activation.trial-balance.tsx` (intent `import-tb`, lines 122–204), `apps/erp/app/modules/accounting/ui/Activation/TrialBalanceEditor.tsx` (file input, `useAction`, error `Alert`), `apps/erp/app/components/Setup/SetupLayout.tsx` (`SetupFrame`, `SetupBody`, `SetupSection`, `SetupFooter`)

**Steps:**
1. Route loader: call `requirePermissions(request, { update: "accounting" })`. Return the importing company's `companyGroupId`.
2. Route action, intent `plan`:
   1. Parse `csv` with `parseAccountImportCsv`. On errors, return `{ csvErrors }`.
   2. Call `loadAccountImportContext(getDatabaseClient(), companyGroupId, companyId)`.
   3. Call `planAccountImport(rows, ctx, resolutions)`. Read `resolutions` from a JSON form field. Default it to `{ targets: {} }`.
   4. Return `{ plan, rows, chart, companies }`. The review needs the account numbers and names and the company names.
3. Route action, intent `apply`:
   1. Parse `csv` again.
   2. Call `serverFns.as({ client, db: getDatabaseClient(), companyId, userId }).invoke("apply-account-import", { rows, resolutions })`.
   3. On error, return a flash error with `getErrorMessage(result.error, "Failed to import the chart of accounts")`.
   4. On success, redirect to `path.to.chartOfAccounts` with a success flash that states the counts.
4. Component: render a `SetupFrame` titled "Import chart of accounts".
5. Keep `csv` and `resolutions` in `useState`. On file select, read `file.text()`, store it, and submit intent `plan`.
6. `AccountImportReview` renders:
   1. A summary line with the 5 counts and the reclass count.
   2. A destructive `Alert` that lists each error with its line, one `<li>` per error code, as `TrialBalanceCsvErrorMessage` does.
   3. One row per `account-needs-target` exception. Show the account, its reasons as `Badge`s ("References", "Required role", "Balance") and its companies. Add a `Combobox` of the sheet's rows (`number name`). On change, set `resolutions.targets[accountId]` and submit intent `plan` again.
   4. A "Companies affected" list from `plan.companies`: name, re-pointed references, role moves, reclass journals. Mark a company with `hasCutover` with a "Live" `Badge`.
   5. One read-only `Table` per action (renamed, merged, new, retired), using `~/components/Table`. Show "Reactivated" on a rename with `reactivate: true`.
7. The footer has a "Download template" link (`path.to.api.chartOfAccountsCsv`) and an Apply button. Disable Apply while any error or exception remains.
8. Wrap every user-facing string in `t` or `<Trans>` from `@lingui/react/macro`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm run lint
# Expected: typecheck Tasks: 1 successful; lint reports no errors in the new files
```

**Out of scope:** No editable grid. The sheet is the only editor.

---

## Task 15: Add Import, Download and Show inactive to the Chart of Accounts page

**Depends on:** 13, 14
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTableFilters.tsx` — lines 67–89
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getChartOfAccounts` (line 2111) gains `args.includeInactive: boolean`
- Modify: `apps/erp/app/routes/x+/accounting+/charts.tsx` — read `?inactive=true` and pass `includeInactive`
- Copy from (precedent): the existing `AppBarAction` in the same file

**Steps:**
1. In `getChartOfAccounts`, apply `.eq("active", true)` only when `includeInactive` is false.
2. Pass `includeInactive: false` from every other caller of `getChartOfAccounts`. Find them with `grep -rn "getChartOfAccounts(" apps/erp/app`.
3. In the filters, add a `Button` "Import" linking to `path.to.chartOfAccountsImport`. Show it when `permissions.can("update", "accounting")`.
4. Add a `Button` "Download" linking to `path.to.api.chartOfAccountsCsv` with `reloadDocument`.
5. Add a "Show inactive" `Switch` that sets the `inactive` search param.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
```

**Out of scope:** Do not change `ChartOfAccountsTree` rendering.

---

## Task 16: Add the Chart of accounts step to the activation wizard

**Depends on:** 14
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/Activation/ActivationSteps.tsx` — add `"chart"` as the first entry of `activationSteps`, and the label `chart: t\`Chart of Accounts\``
- Modify: `apps/erp/app/utils/path.ts` — add `"chart"` to the `accountingActivationStep` union (lines 50–57)
- Modify: `apps/erp/app/routes/x+/accounting+/activation.tsx` — change the `useCurrentStep` fallback (line 64) to `"chart"`
- Modify: `apps/erp/app/routes/x+/accounting+/activation._index.tsx` — redirect to `"chart"`
- Create: `apps/erp/app/routes/x+/accounting+/activation.chart.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/activation.readiness.tsx`

**Steps:**
1. Make the 4 edits above.
2. In the new route, render one `SetupSection` with 2 actions:
   1. A link "Import your chart" to `path.to.chartOfAccountsImport`.
   2. A note "Keep Carbon's chart" that the Next button covers.
3. Render `<ActivationFooter step="chart" cutoverDate={cutoverDate} canContinue />`.
4. Update the "five steps" doc comment in `ActivationSteps.tsx` to "six steps".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
```

**Out of scope:** Do not change readiness checks.

---

## Task 17: Show the Accounting module in the Implementation Hub before cutover

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/x+/get-started+/_layout.tsx` — the `forcedModules` line (about line 239)
- Modify: `packages/onboarding/src/content/setup.ts` — the `chart-of-accounts` row detail (line 57)

**Steps:**
1. Change `forcedModules: accountingSetUp ? [] : ["acc"]` to `forcedModules: []`.
2. Remove the `accountingSetUp` variable and its import if nothing else uses them.
3. Change the `chart-of-accounts` row detail to `msg\`Import your chart of accounts from a spreadsheet\``.
4. Point `SETUP_SCREEN_PATHS["chart-of-accounts"]` at `path.to.chartOfAccountsImport`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=@carbon/onboarding
# Expected: Tasks: 1 successful for each
```

**Out of scope:** Do not change `spine.ts` or the detection probes.

---

## Task 18: Add the sync callout to accounting integrations

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — the `headerExtra` passed to `IntegrationForm` (`IntegrationRoute`, about line 2145)
- Copy from (precedent): `apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysForm.tsx` line 195 (`Alert variant="info"`)

**Steps:**
1. In the loader's installed branch, return `accountingSetUp: hasAccountingCutover(companySettings)`. Load `companySettings` with `getCompanySettings` from `~/modules/settings`.
2. When `providerRole === "accounting"` and `!accountingSetUp`, add an `Alert variant="info"` to `headerExtra`.
3. The alert title is "Invoices and bills sync after you activate accounting". Link it to `path.to.accountingActivation`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
```

**Out of scope:** Do not change the syncers in `packages/ee`.

---

## Task 19: Update the docs, rules and AGENTS.md files

**Depends on:** 1–18
**Files:**
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` — the wizard has 6 steps; add the import and the RESTRICT rule
- Modify: `packages/server-functions/AGENTS.md` — list `apply-account-import`
- Modify: `.claude/rules/onboarding-company-templates.md` — the cutover section says seed-company stamps a cutover; change it
- Modify: `.ai/specs/implemented/2026-10-08-accounting-cutover.md` — add a changelog line: §7 is reversed by `.ai/specs/2026-10-12-chart-of-accounts-import.md`
- Modify: `docs/content/docs/reference/account.mdx` — add an "Import a chart of accounts" section
- Modify: `.ai/lessons.md` — add one lesson: "Account deletes are RESTRICT; deactivate an account in use"

**Steps:**
1. Make each edit. Ground each claim in the code from Tasks 1–18.
2. Use the `carbon-docs` skill for the docs page.
3. Run the license header fixer.

**Verify:**
```bash
pnpm --filter @carbon/checks license-headers
pnpm --filter docs typecheck
# Expected: no files changed by the fixer on the second run; docs typecheck passes
```

**Out of scope:** No changelog entry. That ships separately.

---

## Task 20: Verify in the browser

**Depends on:** all
**Files:** none

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm db:check:datasets`.
3. Use `/test` with these flows:
   1. Chart of Accounts → Download → the CSV has one row per leaf and a filled `Used For` column.
   2. Upload the unchanged CSV → the review shows 0 actions.
   3. Edit the CSV: renumber 1110, merge 4050 into 4010, delete an unused row, add a new row → the review shows each action.
   4. Remove the Migration Clearing row → the review shows an `account-needs-target` exception with a picker.
   5. Apply → the Chart of Accounts page matches the CSV.
   6. Delete a row whose account has a Provisional journal line → the review shows "needs a target". Pick a row → Apply succeeds and the line moves.
   7. Add a row that reuses an inactive account's number → the review shows `taken-by-inactive-account`.
   8. Delete an account with a journal line → the modal offers Deactivate.
   9. Accounting → Activation → the first step is Chart of Accounts.
4. Save the screenshots under `.context/`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** Do not rebuild the database.

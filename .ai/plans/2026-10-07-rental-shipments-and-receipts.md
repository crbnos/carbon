# Rental shipments and receipts — implementation plan

**Spec:** .ai/specs/2026-10-07-rental-shipments-and-receipts.md
**Research:** .ai/research/rental-delivery-and-return.md
**Branch:** rental-shipment-receipt

## Spec status

The spec carries every planning correction (C1–C7, C9) and the answers to Q7
and Q8. This plan follows the spec. Q7 (a `Sale` line returns at the receipt's
location) and Q8 (a receipt holds `Pending` units, plus **Release unit**) are
in spec → Open Questions.

## Plan decisions not in the spec

| # | Decision | Reason |
|---|----------|--------|
| P1 | Release refuses a `Sale` line: "`<unit>` is treated as a sale; return it on a rental receipt instead". The UI hides Release unit for a `Sale` line. | Release passes no residual destination, and `salesTypeReturnError` refuses a `Sale` return without one (`post-rental-agreement/lessor.ts:380-398`). A `Pending` `Sale` line can still come back on a rental receipt, with Return To, on or after the end date. |
| P2 | Release refuses a unit that sits on an open (Draft or Pending) rental shipment or receipt. The message names the document. | Otherwise the unit is `Returned` while an open document still holds it, and Close refuses until someone deletes that line. |
| P3 | A per-unit shortcut ticks its unit when the unit is already on the Draft but unticked. | Spec Flow: "The shortcut always adds its unit ticked." A `Pending` unit sits unticked on a receipt by default. |
| P4 | `returnResidual` uses the given `locationId` for the stock ledger row, the new fleet asset and its `Capitalization` transfer. The journal's `Location` dimension tag keeps the agreement's location. | The transfer records the same move as the asset. The spec keeps the journal "the same as today". |

## Progress

- [x] Task 1: Add the enum migration
- [x] Task 2: Add the fixed-asset line migration
- [x] Task 3: Apply the migrations, regenerate types and fix the nullable readers
- [x] Task 4: Build the rental test fixture and pin today's return
- [x] Task 5: Move the return body into `returnRentalUnit`
- [x] Task 6: Add the pure rental document rules
- [x] Task 7: Add the two `create` cases
- [x] Task 8: Post a rental shipment
- [x] Task 9: Void a rental shipment
- [x] Task 10: Post a rental receipt and refuse its void
- [x] Task 11: Add the Close guard
- [x] Task 12: Add the ERP models, service reads and the line-documents helper
- [x] Task 13: Add the rental branches to the inventory `new` and `details` routes
- [x] Task 14: Load the rental lines and save their fields
- [x] Task 15: Pass the posting date from the post routes
- [x] Task 16: Turn the per-unit Deliver and Return routes into shortcuts
- [x] Task 17: Show the rental units on the shipment page
- [x] Task 18: Show the rental units on the receipt page
- [x] Task 19: Add the source to tables, forms, document panels and traceability
- [x] Task 20: Print a Delivery Ticket
- [x] Task 21: Add Deliver and Return to the agreement header
- [x] Task 22: Replace the `return` type with `release`
- [x] Task 23: Repoint the unit actions and add Release unit
- [x] Task 24: Run the full verification sweep
- [x] Task 25: Extract and translate the new strings
- [x] Task 26: Update the docs
- [x] Task 27: Verify in the browser

## Dependencies

- Task 2 needs Task 1. Task 3 needs Task 2.
- Task 4 needs Task 3. Task 5 needs Task 4.
- Task 6 needs Task 3. Tasks 4–5 and Task 6 are independent of each other.
- Task 7 needs Tasks 3 and 6.
- Tasks 8, 10 and 11 need Tasks 5, 6 and 7. They are independent of each other. Task 9 needs Task 8.
- Task 12 needs Task 3. It is independent of Tasks 4–11.
- Task 13 needs Tasks 7 and 12. Task 14 needs Task 12. Task 15 needs Tasks 8 and 10.
- Task 16 needs Tasks 7 and 12.
- Tasks 17 and 18 need Tasks 14 and 15. Task 19 needs Tasks 12 and 13. Task 20 needs Tasks 12 and 14. Tasks 17–20 are independent of each other.
- Task 21 needs Task 16. Task 22 needs Tasks 10 and 16. Tasks 21 and 22 are independent of each other.
- Task 23 needs Tasks 16 and 22.
- Task 24 needs Tasks 1–23. Task 25 needs Task 24. Task 26 needs Tasks 22 and 23. Task 27 needs Tasks 24–26.

## Conventions for every task

- Read `.ai/lessons.md` sections "A migration file created while migrations are
  running…", "A new FK on a busy table breaks bare PostgREST embeds of it
  (TS2589)" and "Kysely writes in a server function bypass RLS…" before Task 1.
- In a server function, every Kysely read and write filters on `companyId`.
- Refusals that the user must read throw `InvalidInputError` from `../errors`.
  A missing record throws `NotFoundError`.
- Every new source file starts with its SPDX header. Run
  `pnpm --filter @carbon/checks license-headers` after you create files. Do not
  type the header by hand.
- Never rebuild the database. Never run a whole-repo typecheck.
- A database test skips without a local `SUPABASE_DB_URL`. Run every database
  test with this prefix, from the repo root:

  ```bash
  export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
  ```

  If a database test reports "skipped", STOP and report. A skip proves nothing.

---

## Task 1: Add the enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_rental-documents-enums.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006221201_contract-enums.sql:1-4`

**Steps:**
1. 🛑 Check that no `crbn up`, `crbn migrate` or `pnpm db:migrate` runs now. A running migrate records a new empty file as applied.
2. Run `pnpm db:migrate:new rental-documents-enums`.
3. Write this SQL into the new file. Write nothing else into it.

   ```sql
   -- Rental shipments and receipts (.ai/specs/2026-10-07-rental-shipments-and-receipts.md).
   -- Enums only: an ADD VALUE cannot share a transaction with statements that use it.
   ALTER TYPE "shipmentSourceDocument" ADD VALUE IF NOT EXISTS 'Rental Agreement';
   ALTER TYPE "receiptSourceDocument" ADD VALUE IF NOT EXISTS 'Rental Agreement';
   ```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -2
# Expected: the new file is last; its HHMMSS is not 000000; its timestamp is after 20261007171726.
grep -c "ADD VALUE IF NOT EXISTS 'Rental Agreement'" packages/database/supabase/migrations/*_rental-documents-enums.sql
# Expected: 2
```

**Out of scope:** Applying the migration (Task 3).

---

## Task 2: Add the fixed-asset line migration

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_rental-documents.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261007171726_rental-credit-memos.sql:24-33` (idempotent constraints), `20260908142501_returns-module.sql:52-60` (Draft-uniqueness indexes)

**Steps:**
1. 🛑 Check again that no migrate runs now.
2. Run `pnpm db:migrate:new rental-documents`. The new file must sort after the Task 1 file.
3. Write this SQL into the file:

   ```sql
   -- Rental shipments and receipts (.ai/specs/2026-10-07-rental-shipments-and-receipts.md).
   -- A rental unit rides on the fixed-asset line tables. Exactly one source line per row.

   ALTER TABLE "shipmentFixedAssetLine" ALTER COLUMN "salesOrderLineId" DROP NOT NULL;
   ALTER TABLE "shipmentFixedAssetLine" ADD COLUMN IF NOT EXISTS "rentalAgreementLineId" TEXT;
   ALTER TABLE "shipmentFixedAssetLine" ADD COLUMN IF NOT EXISTS "meter" NUMERIC;
   DO $$ BEGIN
     ALTER TABLE "shipmentFixedAssetLine" ADD CONSTRAINT "shipmentFixedAssetLine_rentalAgreementLineId_fkey"
       FOREIGN KEY ("rentalAgreementLineId", "companyId")
       REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     ALTER TABLE "shipmentFixedAssetLine" ADD CONSTRAINT "shipmentFixedAssetLine_source_check"
       CHECK (num_nonnulls("salesOrderLineId", "rentalAgreementLineId") = 1);
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   CREATE INDEX IF NOT EXISTS "shipmentFixedAssetLine_rentalAgreementLineId_idx"
     ON "shipmentFixedAssetLine" ("rentalAgreementLineId");

   ALTER TABLE "receiptFixedAssetLine" ALTER COLUMN "purchaseOrderLineId" DROP NOT NULL;
   ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "rentalAgreementLineId" TEXT;
   ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "meter" NUMERIC;
   ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "notes" TEXT;
   ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "takeOutOfService" BOOLEAN NOT NULL DEFAULT false;
   ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "outOfServiceReason" TEXT;
   ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "residualDestination" TEXT;
   DO $$ BEGIN
     ALTER TABLE "receiptFixedAssetLine" ADD CONSTRAINT "receiptFixedAssetLine_residualDestination_check"
       CHECK ("residualDestination" IN ('Fleet', 'Inventory'));
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     ALTER TABLE "receiptFixedAssetLine" ADD CONSTRAINT "receiptFixedAssetLine_rentalAgreementLineId_fkey"
       FOREIGN KEY ("rentalAgreementLineId", "companyId")
       REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     ALTER TABLE "receiptFixedAssetLine" ADD CONSTRAINT "receiptFixedAssetLine_source_check"
       CHECK (num_nonnulls("purchaseOrderLineId", "rentalAgreementLineId") = 1);
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     ALTER TABLE "receiptFixedAssetLine" ADD CONSTRAINT "receiptFixedAssetLine_outOfService_check"
       CHECK (NOT "takeOutOfService" OR "outOfServiceReason" IS NOT NULL);
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   CREATE INDEX IF NOT EXISTS "receiptFixedAssetLine_rentalAgreementLineId_idx"
     ON "receiptFixedAssetLine" ("rentalAgreementLineId");

   -- One open Draft per agreement: backs the header's open-the-existing-draft behavior.
   CREATE UNIQUE INDEX IF NOT EXISTS "shipment_oneOpenDraftPerRentalAgreement_idx"
     ON "shipment" ("sourceDocumentId", "companyId")
     WHERE "status" = 'Draft' AND "sourceDocument" = 'Rental Agreement';
   CREATE UNIQUE INDEX IF NOT EXISTS "receipt_oneOpenDraftPerRentalAgreement_idx"
     ON "receipt" ("sourceDocumentId", "companyId")
     WHERE "status" = 'Draft' AND "sourceDocument" = 'Rental Agreement';
   ```

4. Do not add RLS policies. The tables keep their manifest rules
   (`packages/database/src/authz/manifest.ts:1219` and `:1383`). The rules are
   per table, so new columns inherit them. `migration.test.ts` hashes the
   rendered rules, which do not change. Do not write an authz migration.
5. Do not add a `TABLE_RENAMES` entry: nothing is renamed or dropped. Do not add
   an `ID_REF_COLUMNS` entry: `rentalAgreementLineId` has a FK.

**Verify:**
```bash
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_rental-documents.sql
# Expected: 0
grep -c "oneOpenDraftPerRentalAgreement_idx" packages/database/supabase/migrations/*_rental-documents.sql
# Expected: 2
```

**Out of scope:** The PK of the fixed-asset line tables stays `("id")`. Do not change it.

---

## Task 3: Apply the migrations, regenerate types and fix the nullable readers

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/types.ts` and the other generated files — by the generator only
- Modify: `packages/server-functions/src/post-shipment/index.ts:630-638` — filter sales-order rows
- Modify: `packages/server-functions/src/post-receipt/index.ts:1891-1905` — filter purchase-order rows
- Modify: `packages/server-functions/src/convert/index.ts:1434-1437` — skip a null line id
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.tsx:76-104` — filter sales-order rows
- Modify: `apps/erp/app/routes/x+/receipt+/$receiptId.tsx:105-132` — filter purchase-order rows

**Steps:**
1. Run `pnpm db:migrate`. It applies both files and regenerates the types and swagger.
2. Run `pnpm run generate:types`.
3. In `post-shipment/index.ts:630-635`, add `companyId` to the `many(...)` filter object.
4. In `post-shipment/index.ts:636-638`, build `shippedFaSoLineIds` from `(shipmentFaLines ?? []).filter((r) => r.salesOrderLineId !== null)`.
5. In `post-receipt/index.ts:1891-1896`, add `companyId` to the `many(...)` filter object.
6. Directly after that read, narrow the rows once:

   ```ts
   const poFaLines = (receiptFaLines ?? []).filter(
     (r): r is typeof r & { purchaseOrderLineId: string } =>
       r.purchaseOrderLineId !== null
   );
   ```

7. Replace each `receiptFaLines ?? []` in `post-receipt/index.ts:1897-1905` with `poFaLines`.
8. In `convert/index.ts:1435`, add `if (!lineId) continue;` after `const lineId = line.salesOrderLineId;`.
9. In `$shipmentId.tsx`, add `.not("salesOrderLineId", "is", null)` to the `shipmentFixedAssetLine` query at line 79-84.
10. In `$receiptId.tsx`, add `.not("purchaseOrderLineId", "is", null)` to the `receiptFixedAssetLine` query at line 107-112.
11. Run the two typechecks below. Fix each error that the nullable order-line columns cause with a null check of the same shape.
12. If the `erp` typecheck shows TS2589 ("excessively deep") in a file that embeds `rentalAgreementLine`, `shipmentFixedAssetLine` or `receiptFixedAssetLine`, name the FK in that embed. Precedent: the TS2589 lesson in `.ai/lessons.md`.
13. If the typecheck shows any other kind of error, STOP and report — do not improvise.

**Verify:**
```bash
grep -c '"Rental Agreement"' packages/database/src/types.ts
# Expected: at least 2 (both enums)
grep -c "takeOutOfService" packages/database/src/types.ts
# Expected: at least 3 (Row, Insert, Update of receiptFixedAssetLine)
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: Tasks: 1 successful (or more), 0 failed
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
pnpm db:check:datasets
# Expected: exit 0; every dataset passes
pnpm db:check:backups
# Expected: exit 0
```

If the enum check prints 0, the migration was recorded empty. Run
`psql "$SUPABASE_DB_URL" -c "select version, array_length(statements,1) from supabase_migrations.schema_migrations order by version desc limit 3"`.
If a NULL count shows, STOP and report.

**Out of scope:** Any reader that already filters by `.in("salesOrderLineId", …)` or `.in("purchaseOrderLineId", …)`, such as `accounting.service.ts:8444-8455`. `.in()` never matches null.

---

## Task 4: Build the rental test fixture and pin today's return

**Depends on:** Task 3
**Files:**
- Create: `packages/server-functions/src/post-rental-agreement/rental-test-fixture.ts`
- Create: `packages/server-functions/src/post-rental-agreement/return-unit.test.ts`
- Copy from (precedent): `packages/server-functions/src/create-rental-invoices/create-rental-invoices.test.ts:21-185`

**Steps:**
1. Create `rental-test-fixture.ts`. Export this function:

   ```ts
   export async function rentalFixture(options?: {
     units?: number; // default 1
     billingTiming?: "Advance" | "Arrears"; // default "Advance"
   }): Promise<{
     db: Kysely<KyselyDatabase>;
     ctx: ServerFnContext; // ServerFnContext.system({ db, companyId, userId: "system" })
     companyId: string;
     agreementId: string;
     agreementReadableId: string; // "RA-TEST"
     locationId: string;
     otherLocationId: string;
     lineIds: string[];
     fixedAssetIds: string[];
     fixedAssetReadableIds: string[]; // "FA-1", "FA-2", …
     trackedEntityIds: string[];
     itemId: string;
     cleanup(): Promise<void>;
   }>;
   ```

2. Insert these rows in one transaction with `app.sync_in_progress` set, as the precedent does:
   1. `companyGroup`, `company` (timezone `America/New_York`), `currency` USD with 2 decimals, `companySettings`.
   2. `sequence` rows for `shipment` (prefix `SHP-`), `receipt` (prefix `RCV-`) and `fixedAsset` (prefix `FA`).
   3. One `customer`. Two `location` rows: `locationId` and `otherLocationId`.
   4. One `item`: type `Part`, `itemTrackingType` `Serial`.
   5. One `fixedAssetClass`, then one `fixedAsset` per unit: status `Active`, `locationId`, name `Scissor lift N`, `fixedAssetId` `FA-N`, `serialNumber` `SN-N`.
   6. One `trackedEntity` per unit. Set `fixedAsset.trackedEntityId` to it.
   7. One `rentalAgreement`: `rentalAgreementId` `RA-TEST`, status `Active`, `startDate` `2026-09-01`, `endDate` null, `billingCycle` `Calendar Month`, the `billingTiming` option, `discountRate` 0, `currencyCode` USD, `locationId`.
   8. One `rentalAgreementLine` per unit: status `Pending`, `rateUnit` `Month`, `rate` 300, `lessorClassification` `Rental`, its `fixedAssetId` and `trackedEntityId`.
   9. Two `rentalBillingPeriod` rows per line: `2026-09-01`–`2026-09-30` (30 days, 300, due `2026-09-01`, status `Invoiced`) and `2026-10-01`–`2026-10-31` (31 days, 300, due `2026-10-01`, status `Pending`).
3. Read the NOT NULL columns of `fixedAssetClass`, `fixedAsset` and `trackedEntity` in `packages/database/src/types.ts` (`Insert` types). Fill only the required ones.
4. Copy `cleanup()` from the precedent (`create-rental-invoices.test.ts:164-182`).
5. Create `return-unit.test.ts` with one `databaseTest` named `"an early return of an Advance unit re-cuts its periods"`:
   1. Build `rentalFixture()`.
   2. Set the line `On Rent` with `deliveredAt` `2026-09-01` by a direct Kysely update.
   3. Act through a local function `returnUnitOnSeptember20(f)`. For now it calls the default export of `./index` with `{ type: "return", rentalAgreementId: f.agreementId, rentalAgreementLineId: f.lineIds[0], returnedAt: "2026-09-20" }`.
   4. Expect `result.error` to be `null`.
   5. Read the line's periods: `periodStart::text`, `periodEnd::text`, `days`, `Number(amount)`, `isAdjustment`, `status`, `rateUnitApplied`, `dueOn::text`. Order by `periodStart`, then `isAdjustment`.
   6. Read the line's `status` and `returnedAt::text`.
   7. Run `expect({ periods, line }).toMatchSnapshot()`.
   8. Call `f.cleanup()` in a `finally`.

**Verify:**
```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions exec vitest run src/post-rental-agreement/return-unit.test.ts
# Expected: 1 passed; "1 written" snapshot on this first run
grep -c "isAdjustment\": true" packages/server-functions/src/post-rental-agreement/__snapshots__/return-unit.test.ts.snap
# Expected: 1 (the early-return adjustment row)
```

If the snapshot has no adjustment row, the fixture does not exercise an
invoiced Advance period. STOP and report.

**Out of scope:** Any change to `index.ts`.

---

## Task 5: Move the return body into `returnRentalUnit`

**Depends on:** Task 4

This task moves code and adds one optional input, `locationId` (spec Q7).
Without `locationId`, the output must stay byte-identical to today.

**Files:**
- Create: `packages/server-functions/src/post-rental-agreement/agreement.ts`
- Create: `packages/server-functions/src/post-rental-agreement/return-unit.ts`
- Modify: `packages/server-functions/src/post-rental-agreement/index.ts` — import the moved code; `returnUnit` becomes a wrapper

**Steps:**
1. Move these declarations from `index.ts` into `agreement.ts`, without edits, and export each one:
   - `type Db`, `type Trx`, `type Enums` (`index.ts:84-86`)
   - `type AgreementRow` (`index.ts:93-109`)
   - `lockAgreement` (`index.ts:116-154`), `currencyDecimals` (`:158-176`), `billingPeriodRow` (`:178-198`)
   - `type LeaseAccounting` and `loadLeaseAccounting` (`:202-285`)
   - `postLeaseJournal` (`:288-347`), `insertUnitActivity` (`:350-392`)
2. Move each import that only these declarations use into `agreement.ts`.
3. In `return-unit.ts`, export this type and function:

   ```ts
   export type RentalUnitReturn = {
     rentalAgreementLineId: string;
     returnedAt: string; // YYYY-MM-DD
     meterIn?: number | null;
     returnNotes?: string | null;
     takeOutOfService?: boolean;
     outOfServiceReason?: string | null;
     residualDestination?: ResidualDestination | null;
   };

   /** Returns one unit of a locked, Active agreement. The caller locks the
    *  agreement, checks it is Active and refuses a future return date. */
   export async function returnRentalUnit(
     trx: Trx,
     args: {
       agreement: AgreementRow;
       unit: RentalUnitReturn;
       companyId: string;
       userId: string;
       today: string;
       /** Where a `Sale` line's residual lands (stock or new fleet asset).
        *  Without it, the agreement's location, as today. */
       locationId?: string;
     }
   ): Promise<{ fixedAssetId: string | null }>;
   ```

4. Set the body of `returnRentalUnit` to `index.ts:1065-1253`: from the `rentalAgreementLine` read to the end of the out-of-service update.
5. In the moved body, rename `payload.` to `unit.`. Return `{ fixedAssetId: fleetAssetId }`. Change nothing else.
6. Move `returnResidual` with its doc comment (`index.ts:1258-1655`) into `return-unit.ts`.
7. Add `locationId: string` to the `args` type of `returnResidual`.
8. In `returnResidual`, replace `agreement.locationId` with `args.locationId` at exactly these 3 places:
   - the `fixedAsset` insert (`index.ts:1489`)
   - the `fixedAssetTransfer` insert (`index.ts:1520`)
   - the `bookAdjustment` ledger row (`index.ts:1565`)
9. Leave `tags.locationId` (`index.ts:1409`) on `agreement.locationId`. The journal stays the same as today (plan decision P4).
10. In `returnRentalUnit`, pass `locationId: args.locationId ?? agreement.locationId` to `returnResidual`.
11. Rewrite `returnUnit` in `index.ts` as this wrapper. It passes no `locationId`:

   ```ts
   async function returnUnit(
     { db, companyId, userId }: Scope,
     payload: Extract<RentalAgreementPayload, { type: "return" }>,
     today: string
   ): Promise<{ id: string }> {
     const future = futureReturnError(payload.returnedAt, today);
     if (future) throw new InvalidInputError(future);
     return db.transaction().execute(async (trx) => {
       const agreement = await lockAgreement(trx, companyId, payload.rentalAgreementId);
       if (agreement.status !== "Active") {
         throw new InvalidInputError(
           `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are returned from an Active agreement`
         );
       }
       await returnRentalUnit(trx, { agreement, unit: payload, companyId, userId, today });
       return { id: agreement.id };
     });
   }
   ```

12. Remove the imports from `index.ts` that nothing uses any more.
13. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions exec vitest run src/post-rental-agreement
# Expected: every test passes; return-unit.test.ts passes with NO "written" and NO "obsolete" snapshot
grep -c "agreement.locationId" packages/server-functions/src/post-rental-agreement/return-unit.ts
# Expected: 2 (the tags line and the fallback in returnRentalUnit)
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: 0 failed
grep -c "^export" packages/server-functions/src/post-rental-agreement/agreement.ts
# Expected: at least 9
```

Do not run vitest with `-u` in this task. A snapshot change means the move
changed behavior. If the snapshot fails, STOP and report.

**Out of scope:** Replacing the `return` type (Task 22). Any edit to the moved logic beyond steps 7–10.

---

## Task 6: Add the pure rental document rules

**Depends on:** Task 3
**Files:**
- Modify: `packages/server-functions/src/post-rental-agreement/validators.ts` — new fields object, validator and helpers
- Modify: `packages/server-functions/src/post-rental-agreement/validators.test.ts` — tests

**Steps:**
1. Split `returnValidator` (`validators.ts:45-63`). Move its fields except `type` and `rentalAgreementId` into `const unitReturnFields = { … }`.
2. Export `unitReturnValidator = z.object(unitReturnFields).refine(…)`. Use the existing out-of-service refine.
3. Rebuild `returnValidator` as `z.object({ type: z.literal("return"), ...unitReturnFields, ...scope }).refine(…)`. Keep the same refine.
4. Add these exports:

   ```ts
   /** The unit's name in a refusal: its asset number, else its asset name, else the line id. */
   export function unitLabel(
     asset: { fixedAssetId: string | null; name: string | null } | undefined,
     lineId: string
   ): string;

   /** Why a delivery cannot be dated `deliveredOn`, or null. */
   export function futureDeliveryError(deliveredOn: string, today: string): string | null;
   // returns "The delivery date cannot be in the future" when deliveredOn > today

   /** Why a rental shipment cannot be voided, or null. `accrual` is the worst
    *  Accrual row of the unit: "Posted", "Draft run" (Planned with a runLineId), or null. */
   export function rentalShipmentVoidBlocker(
     units: {
       label: string;
       status: Enums["rentalAgreementLineStatus"];
       accrual: "Posted" | "Draft run" | null;
     }[]
   ): string | null;

   /** Why an agreement cannot close while a rental document is still open, or null. */
   export function openRentalDocumentBlocker(args: {
     shipmentId: string | null; // readable id of an open shipment that has a line
     receiptId: string | null;  // readable id of an open receipt that has a line
   }): string | null;

   /** Why a unit on a rental receipt cannot be returned, or null.
    *  A receipt returns a Pending or an On Rent unit (spec Q8). */
   export function receiptReturnError(
     label: string,
     status: Enums["rentalAgreementLineStatus"]
   ): string | null;

   /** Why a release date is refused, or null. */
   export function futureReleaseError(releasedOn: string, today: string): string | null;
   // returns "The release date cannot be in the future" when releasedOn > today

   /** Why a unit cannot be released, or null (spec Q8, plan decisions P1 and P2). */
   export function releaseBlocker(args: {
     label: string;
     status: Enums["rentalAgreementLineStatus"];
     classification: Enums["lessorClassification"] | null;
     openDocument: string | null; // e.g. "shipment SHP-000004" or "receipt RCV-000002"
   }): string | null;
   ```

5. Use these exact messages:

   | Helper | Case | Message |
   |--------|------|---------|
   | `rentalShipmentVoidBlocker` | a unit is not `On Rent` | `` `${label} is ${status}; a rental shipment can be voided only while every unit is On Rent` `` |
   | `rentalShipmentVoidBlocker` | `accrual` = `"Posted"` | `` `A posted revenue recognition run holds accrued rent for ${label}; the shipment cannot be voided` `` |
   | `rentalShipmentVoidBlocker` | `accrual` = `"Draft run"` | `` `A draft revenue recognition run holds accrued rent for ${label}; delete the run before voiding the shipment` `` |
   | `openRentalDocumentBlocker` | `shipmentId` set | `` `Shipment ${shipmentId} is still open; post or delete it before closing the agreement` `` |
   | `openRentalDocumentBlocker` | `receiptId` set | `` `Receipt ${receiptId} is still open; post or delete it before closing the agreement` `` |
   | `receiptReturnError` | status not in `RETURNABLE_LINE_STATUSES` | `` `${label} is ${status}; only a Pending or On Rent unit can be returned` `` |
   | `releaseBlocker` | status not `Pending` | `` `${label} is ${status}; only a Pending unit can be released` `` |
   | `releaseBlocker` | `classification` = `"Sale"` | `` `${label} is treated as a sale; return it on a rental receipt instead` `` |
   | `releaseBlocker` | `openDocument` set | `` `${label} is on ${openDocument}; remove it there before releasing the unit` `` |

6. In `rentalShipmentVoidBlocker`, check the first unit that is not `On Rent` first. Then check accruals in unit order.
7. In `openRentalDocumentBlocker`, check the shipment first.
8. In `receiptReturnError`, use the existing `RETURNABLE_LINE_STATUSES` (`validators.ts:95-102`). It already holds `Pending` and `On Rent`.
9. In `releaseBlocker`, check in this order: status, classification, open document.
10. Add one test per message, one test for each null result, and 3 `unitReturnValidator` tests. Copy the shape of the existing return tests (`validators.test.ts:33-110`), without `type` and `rentalAgreementId`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/post-rental-agreement/validators.test.ts
# Expected: all tests pass, including the new ones
```

**Out of scope:** Removing `returnValidator` (Task 22).

---

## Task 7: Add the two `create` cases

**Depends on:** Tasks 3, 6
**Files:**
- Modify: `packages/server-functions/src/create/index.ts` — 2 union members (~line 60), 2 permission rules (~line 176), 2 cases before `case "journalEntry"` (line 3372)
- Create: `packages/server-functions/src/create/rental-agreement.test.ts`
- Modify: `packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap` — by `vitest -u` only
- Copy from (precedent): `create/index.ts:2007-2221` (`shipmentFromSalesReturnOrder`, the insert of the header) and `create/index.ts:3031-3051` (the asset-line insert)

**Steps:**
1. Add these members to `createInput`:

   ```ts
   z.object({
     type: z.literal("shipmentFromRentalAgreement"),
     rentalAgreementId: z.string(),
     rentalAgreementLineId: z.string().optional()
   }),
   z.object({
     type: z.literal("receiptFromRentalAgreement"),
     rentalAgreementId: z.string(),
     rentalAgreementLineId: z.string().optional()
   }),
   ```

2. Add `shipmentFromRentalAgreement: { create: "inventory" }` and `receiptFromRentalAgreement: { create: "inventory" }` to `permissions.rules`.
3. Add `case "shipmentFromRentalAgreement"`. Run the whole case in one `db.transaction()`. Do these steps in order:
   1. Read `rentalAgreement` (`id`, `rentalAgreementId`, `status`, `customerId`, `locationId`) by `id` and `companyId`, `forUpdate()`. If none, throw `NotFoundError("Rental agreement not found")`.
   2. If `status !== "Active"`, throw `InvalidInputError` with `` `Rental agreement ${rentalAgreementId} is ${status}; units are delivered from an Active agreement` ``.
   3. Read the Draft shipment: `sourceDocument = 'Rental Agreement'`, `sourceDocumentId = agreement.id`, `status = 'Draft'`, `companyId`, `forUpdate()`.
   4. Read the line ids on open documents: join `shipmentFixedAssetLine` to `shipment`, where the shipment is `Draft` or `Pending` and has this source.
   5. Read the candidate lines: `rentalAgreementLine` of this agreement and company, `status = 'Pending'`. If a line id is given, read only that id.
   6. If a line id is given and no `Pending` line matches, throw `InvalidInputError("Only a Pending unit can be delivered")`.
4. Then branch:

   | Draft exists | Line id given | Action | Result |
   |--------------|---------------|--------|--------|
   | yes | no | nothing | `{ id: draft.id }` |
   | yes | yes, already on the Draft and ticked | nothing | `{ id: draft.id }` |
   | yes | yes, already on the Draft and unticked | set its `shipped` to true (plan decision P3) | `{ id: draft.id }` |
   | yes | yes, on another open shipment | throw `InvalidInputError("The unit is already on an open shipment")` | — |
   | yes | yes, not on a document | insert 1 asset line into the Draft | `{ id: draft.id }` |
   | no | either | insert a Draft header and 1 asset line per candidate not on an open shipment | `{ id: newId }` |
   | no | either, and no candidate is left | throw `InvalidInputError("No units to deliver")` | — |

5. Insert the header with these values. Leave `postingDate` unset.

   ```ts
   {
     shipmentId: await getNextSequence(trx, "shipment", companyId),
     sourceDocument: "Rental Agreement",
     sourceDocumentId: agreement.id,
     sourceDocumentReadableId: agreement.rentalAgreementId,
     customerId: agreement.customerId,
     locationId: agreement.locationId,
     status: "Draft",
     companyId,
     createdBy: userId
   }
   ```

6. Insert each asset line as `{ shipmentId, rentalAgreementLineId, shipped: true, companyId, createdBy: userId }`.
7. Add `case "receiptFromRentalAgreement"` with the same structure and these differences (spec Q8):

   | Item | Shipment case | Receipt case |
   |------|---------------|--------------|
   | Candidate status | `Pending` | `Pending` or `On Rent` |
   | Header table and sequence | `shipment` | `receipt` (`receiptId` from `getNextSequence(trx, "receipt", companyId)`) |
   | `customerId` | set | not set (`receipt` has no such column) |
   | Asset line, no line id given | `shipmentFixedAssetLine`, `shipped: true` | `receiptFixedAssetLine`: `received: true` for an `On Rent` unit, `received: false` for a `Pending` unit; `residualDestination` left null |
   | Asset line, line id given | `shipped: true` | `received: true`, whether the unit is `Pending` or `On Rent` |
   | Unticked unit already on the Draft, line id given | set `shipped` to true | set `received` to true |
   | Agreement refusal | `units are delivered from an Active agreement` | `units are returned from an Active agreement` |
   | Line refusal | `Only a Pending unit can be delivered` | `Only a Pending or On Rent unit can be returned` |
   | Open-document refusal | `The unit is already on an open shipment` | `The unit is already on an open receipt` |
   | Empty refusal | `No units to deliver` | `No units to return` |

   The receipt case skips units on another open receipt only. A `Pending` unit can sit on an open shipment and an open receipt at once. The first document to post wins. The other one then refuses the unit by name.

8. Create `create/rental-agreement.test.ts`. Use `rentalFixture({ units: 5 })` from Task 4. Write these `databaseTest` cases:
   1. A shipment without a line id: one Draft, 5 asset lines with `shipped = true`, `locationId` = `f.locationId`, `sourceDocumentReadableId` = `RA-TEST`, `postingDate` null.
   2. A second call without a line id returns the same id. The shipment still has 5 lines.
   3. A raw Kysely insert of a second Draft `shipment` with this source fails. The error message contains `shipment_oneOpenDraftPerRentalAgreement_idx`.
   4. Set every line `Returned`. A receipt fails with `No units to return`.
   5. Set 3 lines `On Rent`. A receipt without a line id has 5 lines: 3 with `received = true`, 2 `Pending` units with `received = false`.
   6. In the same fixture, the receipt call with the line id of an unticked `Pending` unit returns the same receipt id. That line now has `received = true`.
   7. Set 2 lines `On Rent` and delete the Draft shipment. A shipment then holds only the 3 `Pending` units.
   8. On a `Closed` agreement, the shipment call fails with `is Closed`.
   9. With no Draft receipt, the receipt call with the line id of a `Pending` unit creates a receipt with 1 line, `received = true`.
9. Update the permissions snapshot.

**Verify:**
```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions exec vitest run src/create/rental-agreement.test.ts
# Expected: 9 passed
pnpm --filter @carbon/server-functions exec vitest run src/permissions-manifest.test.ts -u
git diff --stat packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap
# Expected: only the two new create rules in the diff
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: 0 failed
```

**Out of scope:** The ERP routes that call these cases (Tasks 13, 16).

---

## Task 8: Post a rental shipment

**Depends on:** Tasks 5, 6, 7
**Files:**
- Modify: `packages/server-functions/src/post-shipment/index.ts` — input (line 54), `run` signature (line 64), new case before `default` (line 3038)
- Modify: `packages/server-functions/src/post-rental-agreement/agreement.ts` — widen `insertUnitActivity`
- Create: `packages/server-functions/src/post-shipment/rental-agreement.ts`
- Create: `packages/server-functions/src/post-shipment/rental-agreement.test.ts`
- Copy from (precedent): `post-rental-agreement/index.ts:410-470` (`activate`: lock, then read lines) and `$id.$lineId.deliver.tsx:64-91` (the out-of-service rule)

**Steps:**
1. Change `postShipmentInput` to:

   ```ts
   export const postShipmentInput = z.object({
     type: z.enum(["post", "void"]),
     shipmentId: z.string(),
     /** The delivery date of a rental shipment. Other sources ignore it. */
     postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
   });
   ```

2. Destructure `postingDate` in `run(ctx, { type, shipmentId, postingDate })`.
3. In `agreement.ts`, widen `insertUnitActivity`: `type` adds `"Rental Delivery" | "Rental Return" | "Void Shipment"`. `sourceDocument` adds `"Shipment" | "Receipt"`.
4. In `post-shipment/rental-agreement.ts`, export:

   ```ts
   export async function postRentalShipment(
     db: Kysely<KyselyDatabase>,
     args: { shipmentId: string; companyId: string; userId: string; today: string; postingDate?: string }
   ): Promise<void>;
   ```

5. Write its body as one `db.transaction()`, in this order:
   1. Set `deliveredOn = postingDate ?? today`. If `futureDeliveryError(deliveredOn, today)` returns a message, throw it as `InvalidInputError`.
   2. Lock the shipment `forUpdate()` by `id` and `companyId`. Read `shipmentId`, `sourceDocumentId`, `status`.
   3. Read the ticked asset lines: `shipped = true`, `rentalAgreementLineId` not null. If none, throw `InvalidInputError("Select at least one unit to deliver")`.
   4. Lock the agreement with `lockAgreement(trx, companyId, sourceDocumentId)`. If it is not `Active`, refuse with the Task 7 agreement message.
   5. Lock the lines: `rentalAgreementLine` by id list, `companyId`, `forUpdate()`. Read `id`, `rentalAgreementId`, `status`, `fixedAssetId`, `trackedEntityId`.
   6. Read the assets: `fixedAsset` `id`, `fixedAssetId`, `name`, `outOfServiceSince`, `outOfServiceReason` by id list and `companyId`.
   7. For each line in asset-line order, build `label = unitLabel(asset, line.id)`.
   8. If a line is missing or belongs to another agreement, throw `NotFoundError("Rental agreement line not found")`.
   9. If a line is not `Pending`, throw `` `${label} is ${status}; only a Pending unit can be delivered` ``.
   10. If `outOfServiceSince` is set, throw `` `${label} is out of service: ${outOfServiceReason ?? "no reason given"}` ``.
   11. Update each line: `status: "On Rent"`, `deliveredAt: deliveredOn`, `meterOut: assetLine.meter`, `updatedBy`, `updatedAt: datetime.timestamp()`.
   12. For each line with a `trackedEntityId`, call `insertUnitActivity` with `type: "Rental Delivery"`, `direction: "input"`, `sourceDocument: "Shipment"`, the shipment ids, and `attributes: { Shipment: shipmentId, "Rental Agreement": agreement.id }`.
   13. Update the shipment: `status: "Posted"`, `postingDate: deliveredOn`, `postedBy: userId`.
6. In `post-shipment/index.ts`, add before `default` (line 3038):

   ```ts
   case "Rental Agreement": {
     await postRentalShipment(db, { shipmentId, companyId, userId, today, postingDate });
     break;
   }
   ```

7. Write no `itemLedger`, `costLedger` or journal row.
8. Create `post-shipment/rental-agreement.test.ts`. Use `rentalFixture({ units: 5 })` and the Task 7 `create` case to make the shipment. Write these `databaseTest` cases:
   1. Untick 2 asset lines and set `meter` 120 on one ticked line. Post with `postingDate` = company today minus 3 days (`datetime.today("America/New_York").subtract({ days: 3 }).toString()`). Expect: 3 lines `On Rent` with that `deliveredAt`, one with `meterOut` 120, 2 lines `Pending`, the shipment `Posted` with that `postingDate`.
   2. In the same case, expect 0 `itemLedger`, 0 `costLedger` and 0 `journalLine` rows for `f.companyId`. Expect 3 `trackedActivity` rows of type `Rental Delivery`.
   3. A `postingDate` of today plus 1 day fails with `The delivery date cannot be in the future`. The shipment status is `Draft` afterwards.
   4. Set `outOfServiceSince` and `outOfServiceReason` = `Hydraulic leak` on one asset. The post fails, and the message contains `Hydraulic leak`.
   5. Set one ticked line `On Rent` by a direct update. The post fails, and the message contains `FA-` and `is On Rent`.
   6. Untick every line. The post fails with `Select at least one unit to deliver`.
9. Add one more `databaseTest` for C1, the backdated accrual:
   1. Use `rentalFixture({ billingTiming: "Arrears" })`. Set both periods `Pending`.
   2. Post a shipment with `postingDate` `2026-09-25`.
   3. Call `synthesizeRentalAccruals` (exported from `../propose-revenue-recognition-run`) in a transaction with `periodEnd` `2026-10-31`. Expect no `Accrual` row with a `periodStart` in September.
   4. Call it again with `periodEnd` `2026-09-30`. Expect one `Accrual` row from `2026-09-25` to `2026-09-30`.
10. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions exec vitest run src/post-shipment/rental-agreement.test.ts
# Expected: 6 passed (cases 1–2 are one test)
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: 0 failed
```

**Out of scope:** The void case (Task 9). The `Sales Order` case.

---

## Task 9: Void a rental shipment

**Depends on:** Task 8
**Files:**
- Modify: `packages/server-functions/src/post-shipment/rental-agreement.ts` — add `voidRentalShipment`
- Modify: `packages/server-functions/src/post-shipment/index.ts` — new void case before `default` (line 4694)
- Modify: `packages/server-functions/src/post-shipment/rental-agreement.test.ts` — void tests
- Copy from (precedent): `post-shipment/index.ts:3487-3530` (the `Void Shipment` activity)

**Steps:**
1. Export from `rental-agreement.ts`:

   ```ts
   export async function voidRentalShipment(
     db: Kysely<KyselyDatabase>,
     args: { shipmentId: string; companyId: string; userId: string }
   ): Promise<void>;
   ```

2. Write its body as one `db.transaction()`, in this order:
   1. Lock the shipment `forUpdate()`. Read the ticked asset lines (`shipped = true`, `rentalAgreementLineId` not null).
   2. Lock the agreement with `lockAgreement`.
   3. Lock the lines `forUpdate()`. Read the assets for labels, as Task 8 does.
   4. Read the `Accrual` rows of the lines from `revenueRecognitionSchedule`: `type = 'Accrual'`, `companyId`, line id list. Select `rentalAgreementLineId`, `status`, `runLineId`.
   5. For each unit, set `accrual` to `"Posted"` if a row is `Posted`. Else set it to `"Draft run"` if a `Planned` row has a `runLineId`. Else set it to null.
   6. If `rentalShipmentVoidBlocker(units)` returns a message, throw it as `InvalidInputError`.
   7. Delete the `Planned` `Accrual` rows of the lines that have no `runLineId`.
   8. Update each line: `status: "Pending"`, `deliveredAt: null`, `meterOut: null`, `updatedBy`, `updatedAt`.
   9. For each line with a `trackedEntityId`, call `insertUnitActivity` with `type: "Void Shipment"`, `direction: "input"`, `sourceDocument: "Shipment"`, and the Task 8 attributes.
   10. Update the shipment: `status: "Voided"`, `updatedBy`, `updatedAt: datetime.timestamp()`.
3. In `post-shipment/index.ts`, add before the void `default` (line 4694):

   ```ts
   case "Rental Agreement": {
     await voidRentalShipment(db, { shipmentId, companyId, userId });
     break;
   }
   ```

4. Add these `databaseTest` cases:
   1. Post, then void. Expect each delivered line `Pending` with `deliveredAt` null and `meterOut` null. Expect the shipment `Voided`.
   2. Post. Insert a `Posted` `Accrual` row for one delivered line. Read the NOT NULL columns of `revenueRecognitionSchedule` in `20261006220201_revenue-recognition-core.sql:205-235`. The void fails with `A posted revenue recognition run holds accrued rent for FA-`. The shipment stays `Posted`.
   3. Post. Set one delivered line `Returned` by a direct update. The void fails with `is Returned`.

**Verify:**
```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions exec vitest run src/post-shipment/rental-agreement.test.ts
# Expected: 9 passed
```

**Out of scope:** Voids of other sources.

---

## Task 10: Post a rental receipt and refuse its void

**Depends on:** Tasks 5, 6, 7
**Files:**
- Modify: `packages/server-functions/src/post-receipt/index.ts` — input (line 56), `run` signature (line 66), void refusal (before line 280), new case before `default` (line 3553), import `InvalidInputError`
- Create: `packages/server-functions/src/post-receipt/rental-agreement.ts`
- Create: `packages/server-functions/src/post-receipt/rental-agreement.test.ts`
- Modify: `packages/server-functions/src/post-rental-agreement/return-unit.test.ts` — act through the receipt
- Copy from (precedent): `post-rental-agreement/index.ts` `returnUnit` wrapper (Task 5) for the lock order

**Steps:**
1. Change `postReceiptInput` to:

   ```ts
   export const postReceiptInput = z.object({
     type: z.enum(["post", "void"]).default("post"),
     receiptId: z.string(),
     /** The return date of a rental receipt. Other sources ignore it. */
     postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
   });
   ```

2. Destructure `postingDate` in `run`.
3. In the void block, after the `invoiced` check (`index.ts:274-279`), add:

   ```ts
   if (receiptHeader.sourceDocument === "Rental Agreement") {
     throw new InvalidInputError(
       "A rental return cannot be voided. Correct the unit by hand."
     );
   }
   ```

4. In `post-receipt/rental-agreement.ts`, export:

   ```ts
   export async function postRentalReceipt(
     db: Kysely<KyselyDatabase>,
     args: { receiptId: string; companyId: string; userId: string; today: string; postingDate?: string }
   ): Promise<void>;
   ```

5. Write its body as one `db.transaction()`, in this order:
   1. Set `returnedAt = postingDate ?? today`. If `futureReturnError(returnedAt, today)` returns a message, throw it as `InvalidInputError`.
   2. Lock the receipt `forUpdate()`. Read `receiptId`, `sourceDocumentId`, `locationId`.
   3. Read the ticked asset lines: `received = true`, `rentalAgreementLineId` not null. Read `meter`, `notes`, `takeOutOfService`, `outOfServiceReason`, `residualDestination`. If none, throw `InvalidInputError("Select at least one unit to return")`.
   4. Lock the agreement with `lockAgreement`. If it is not `Active`, refuse with the Task 5 wrapper message.
   5. Read the lines (`id`, `status`, `lessorClassification`, `trackedEntityId`) and the assets for labels.
   6. If `receiptReturnError(label, line.status)` returns a message, throw it as `InvalidInputError`. A receipt returns a `Pending` or an `On Rent` unit (spec Q8).
   7. Parse each unit with `unitReturnValidator` (Task 6): `rentalAgreementLineId`, `returnedAt`, `meterIn: meter`, `returnNotes: notes`, `takeOutOfService`, `outOfServiceReason`, `residualDestination`. On a parse error, throw `` `${label}: ${firstIssueMessage}` `` as `InvalidInputError`.
   8. Call `returnRentalUnit(trx, { agreement, unit, companyId, userId, today, locationId: receipt.locationId ?? undefined })` for each unit (spec Q7).
   9. If the result's `fixedAssetId` is set and the receipt has a `locationId`, update that `fixedAsset`: `locationId`, `updatedBy`, `updatedAt`. This also covers a `Pending` unit.
   10. If the line is `Rental` and has a `trackedEntityId`, call `insertUnitActivity` with `type: "Rental Return"`, `direction: "output"`, `sourceDocument: "Receipt"`, and `attributes: { Receipt: receiptId, "Rental Agreement": agreement.id }`.
   11. Update the receipt: `status: "Posted"`, `postingDate: returnedAt`, `postedBy: userId`.
6. In `post-receipt/index.ts`, add before `default` (line 3553):

   ```ts
   case "Rental Agreement": {
     await postRentalReceipt(db, { receiptId, companyId, userId, today, postingDate });
     break;
   }
   ```

7. Create `post-receipt/rental-agreement.test.ts`. Use `rentalFixture({ units: 3 })`. Set the 3 lines `On Rent` with `deliveredAt` `2026-09-01`. Write these `databaseTest` cases:
   1. Create a receipt with the Task 7 case. Untick 2 lines. On the ticked line set `meter` 130, `takeOutOfService` true, `outOfServiceReason` `Hydraulic leak`. Set the receipt `locationId` to `f.otherLocationId`. Post with `postingDate` `2026-09-20`.
   2. In the same case, expect these 5 facts:
      - the line is `Returned`, with `returnedAt` `2026-09-20` and `meterIn` 130
      - the asset `locationId` is `f.otherLocationId`
      - `fleetAssets.fleetStatus` is `In Maintenance`
      - 1 `Rental Return` activity exists
      - the receipt is `Posted`, with `postingDate` `2026-09-20`
   3. Untick every line. The post fails with `Select at least one unit to return`, and the receipt is `Draft` afterwards.
   4. Post a receipt, then call with `type: "void"`. It fails with `A rental return cannot be voided. Correct the unit by hand.` The receipt stays `Posted`.
   5. A `Sale` line: set `lessorClassification` `Sale` and `initialNetInvestment` 1000 on one line. Leave `residualDestination` null. The post fails, and the message names the missing destination (the `salesTypeReturnError` text).
   6. The same `Sale` line with `residualDestination` `Inventory`, `endDate` `2026-09-20` on the agreement, and an `itemCost` row for the item. Set the receipt `locationId` to `f.otherLocationId` (spec Q7). Expect 1 `itemLedger` row: `entryType` `Positive Adjmt.`, `documentType` `Rental Agreement`, quantity 1, `locationId` = `f.otherLocationId`.
   7. A `Pending` unit (spec Q8). Use `rentalFixture({ units: 2 })`. Set line 1 `On Rent` with `deliveredAt` `2026-09-01`. Leave line 2 `Pending`.
      1. Create a receipt. Expect line 2's asset line with `received = false`.
      2. Post with `postingDate` `2026-09-20`. Expect line 1 `Returned` and line 2 still `Pending`.
      3. Create a second receipt. Tick line 2. Post with `postingDate` `2026-09-25`.
      4. Expect line 2 `Returned` with `returnedAt` `2026-09-25`. Expect no `Pending` billing period of line 2 that starts after `2026-09-25`.
8. If case 6 needs more setup than an `itemCost` row (for example a lease schedule), STOP and report.
9. In `return-unit.test.ts`, change only `returnUnitOnSeptember20`:
   1. Create a receipt with the Task 7 case and `rentalAgreementLineId`.
   2. Post it with `postingDate` `2026-09-20`.
   3. Keep the test name and every assertion.
10. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions exec vitest run src/post-receipt/rental-agreement.test.ts
# Expected: 6 passed (cases 1–2 are one test)
pnpm --filter @carbon/server-functions exec vitest run src/post-rental-agreement/return-unit.test.ts
# Expected: 1 passed, NO "written" and NO "obsolete" snapshot — the receipt path re-cuts exactly as the old path did
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: 0 failed
```

Do not run vitest with `-u`. If the pinning snapshot fails, STOP and report.

**Out of scope:** The `default` case of the post switch: leave it as it is.

---

## Task 11: Add the Close guard

**Depends on:** Tasks 5, 6, 7
**Files:**
- Modify: `packages/server-functions/src/post-rental-agreement/index.ts` — `close` (`index.ts:1725-1764` before Task 5)
- Create: `packages/server-functions/src/post-rental-agreement/close.test.ts`

**Steps:**
1. In `close`, after the `Active` check and BEFORE `loadSettlementState`, read the first open shipment with a line:

   ```ts
   const openShipment = await trx
     .selectFrom("shipment as s")
     .innerJoin("shipmentFixedAssetLine as l", (join) =>
       join.onRef("l.shipmentId", "=", "s.id").onRef("l.companyId", "=", "s.companyId")
     )
     .select("s.shipmentId")
     .where("s.companyId", "=", companyId)
     .where("s.sourceDocument", "=", "Rental Agreement")
     .where("s.sourceDocumentId", "=", agreement.id)
     .where("s.status", "in", ["Draft", "Pending"])
     .orderBy("s.createdAt")
     .executeTakeFirst();
   ```

2. Read `openReceipt` the same way from `receipt` and `receiptFixedAssetLine`.
3. Throw `openRentalDocumentBlocker({ shipmentId: openShipment?.shipmentId ?? null, receiptId: openReceipt?.receiptId ?? null })` as `InvalidInputError` when it returns a message.
4. Create `close.test.ts` with one `databaseTest`:
   1. Use `rentalFixture()`. Set the line `On Rent`.
   2. Create a receipt with the Task 7 case.
   3. Call the default export of `./index` with `{ type: "close", rentalAgreementId }`.
   4. Expect the error message to contain `Receipt RCV-` and `is still open`.

**Verify:**
```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions exec vitest run src/post-rental-agreement/close.test.ts
# Expected: 1 passed
```

**Out of scope:** `cancel`. The FK cascade already removes a deleted `Pending` line from a Draft shipment.

---

## Task 12: Add the ERP models, service reads and the line-documents helper

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — source arrays (`:95-106`, `:353-362`), 2 validators
- Modify: `apps/erp/app/modules/inventory/inventory.models.test.ts` — validator tests
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — 2 reads after `getShipmentTracking` (`:1423`)
- Modify: `apps/erp/app/modules/inventory/types.ts` — 2 types
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — 1 read after `getRentalAgreementDeposits` (`:9582`)
- Modify: `apps/erp/app/modules/sales/sales.utils.ts` and `sales.utils.test.ts` — `rentalLineDocuments`
- Copy from (precedent): `inventory.service.ts:1423-1433` (`getShipmentTracking`), `sales.service.ts:1777-1834` (`getSalesOrderRelatedItems`)

**Steps:**
1. Add `"Rental Agreement"` to `receiptSourceDocumentType` and to `shipmentSourceDocumentType`.
2. Add these validators to `inventory.models.ts`:

   ```ts
   const meterValue = z
     .string()
     .refine(
       (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
       { message: "Enter a meter reading of 0 or more" }
     );

   export const shipmentFixedAssetLineUpdateValidator = z.discriminatedUnion("field", [
     z.object({ id: z.string().min(1), field: z.literal("shipped"), value: z.enum(["true", "false"]) }),
     z.object({ id: z.string().min(1), field: z.literal("serialNumber"), value: z.string() }),
     z.object({ id: z.string().min(1), field: z.literal("meter"), value: meterValue })
   ]);

   export const receiptFixedAssetLineUpdateValidator = z.discriminatedUnion("field", [
     z.object({ id: z.string().min(1), field: z.literal("received"), value: z.enum(["true", "false"]) }),
     z.object({ id: z.string().min(1), field: z.literal("serialNumber"), value: z.string() }),
     z.object({ id: z.string().min(1), field: z.literal("meter"), value: meterValue }),
     z.object({ id: z.string().min(1), field: z.literal("notes"), value: z.string() }),
     // "" takes the unit off the out-of-service list; any other text is the reason.
     z.object({ id: z.string().min(1), field: z.literal("outOfService"), value: z.string() }),
     z.object({ id: z.string().min(1), field: z.literal("residualDestination"), value: z.enum(["", "Fleet", "Inventory"]) })
   ]);
   ```

3. Add tests to `inventory.models.test.ts`: a meter of `-1` fails, `""` and `"120"` pass, an unknown `field` fails.
4. Add to `inventory.service.ts`:

   ```ts
   /** @mcp read */
   export async function getRentalShipmentLines(
     client: SupabaseClient<Database>,
     shipmentId: string,
     companyId: string
   ) {
     return client
       .from("shipmentFixedAssetLine")
       .select(
         "id, shipped, meter, rentalAgreementLineId, rentalAgreementLine!shipmentFixedAssetLine_rentalAgreementLineId_fkey(id, status, lessorClassification, fixedAsset(id, fixedAssetId, name, serialNumber), item(name, readableIdWithRevision), trackedEntity(readableId))"
       )
       .eq("shipmentId", shipmentId)
       .eq("companyId", companyId)
       .not("rentalAgreementLineId", "is", null)
       .order("createdAt");
   }
   ```

5. Add `getRentalReceiptLines` with the same shape. It reads `receiptFixedAssetLine` with `received`, `meter`, `notes`, `takeOutOfService`, `outOfServiceReason`, `residualDestination`, and the embed through `receiptFixedAssetLine_rentalAgreementLineId_fkey`.
6. If PostgREST refuses the embed of `fixedAsset`, `item` or `trackedEntity` from `rentalAgreementLine`, name its FK. Copy the name from `packages/database/src/types.ts`.
7. Add to `inventory/types.ts`:

   ```ts
   export type RentalShipmentLine = {
     id: string;
     rentalAgreementLineId: string;
     shipped: boolean;
     meter: number | null;
     unitName: string;
     assetReadableId: string | null;
     serialNumber: string | null;
     lineStatus: Database["public"]["Enums"]["rentalAgreementLineStatus"];
   };

   export type RentalReceiptLine = Omit<RentalShipmentLine, "shipped"> & {
     received: boolean;
     notes: string | null;
     takeOutOfService: boolean;
     outOfServiceReason: string | null;
     residualDestination: "Fleet" | "Inventory" | null;
     lessorClassification: Database["public"]["Enums"]["lessorClassification"] | null;
   };
   ```

8. Add to `sales.service.ts`:

   ```ts
   /** @mcp read */
   export async function getRentalAgreementRelatedDocuments(
     client: SupabaseClient<Database>,
     rentalAgreementId: string,
     companyId: string
   ) {
     const [shipments, receipts] = await Promise.all([
       client
         .from("shipment")
         .select("id, shipmentId, status, postingDate, shipmentFixedAssetLine(rentalAgreementLineId, shipped)")
         .eq("sourceDocument", "Rental Agreement")
         .eq("sourceDocumentId", rentalAgreementId)
         .eq("companyId", companyId)
         .order("createdAt"),
       client
         .from("receipt")
         .select("id, receiptId, status, postingDate, receiptFixedAssetLine(rentalAgreementLineId, received)")
         .eq("sourceDocument", "Rental Agreement")
         .eq("sourceDocumentId", rentalAgreementId)
         .eq("companyId", companyId)
         .order("createdAt")
     ]);
     return {
       data: { shipments: shipments.data ?? [], receipts: receipts.data ?? [] },
       error: shipments.error ?? receipts.error
     };
   }
   ```

9. Add to `sales.utils.ts`:

   ```ts
   /** The last Posted shipment that delivered the unit and the last Posted receipt that returned it. */
   export function rentalLineDocuments(
     lineId: string,
     shipments: { id: string; shipmentId: string; status: string; shipmentFixedAssetLine: { rentalAgreementLineId: string | null; shipped: boolean }[] }[],
     receipts: { id: string; receiptId: string; status: string; receiptFixedAssetLine: { rentalAgreementLineId: string | null; received: boolean }[] }[]
   ): {
     shipment: { id: string; shipmentId: string } | null;
     receipt: { id: string; receiptId: string } | null;
   };
   ```

10. Add 3 tests to `sales.utils.test.ts`: no documents, a Posted shipment with the unit ticked, a Draft shipment ignored.
11. Regenerate the MCP manifest digest.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/inventory/inventory.models.test.ts app/modules/sales/sales.utils.test.ts
# Expected: all pass
pnpm run generate:mcp && pnpm check:manifest
# Expected: check:manifest exits 0
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
```

**Out of scope:** Callers of these reads (Tasks 14, 16).

---

## Task 13: Add the rental branches to the inventory `new` and `details` routes

**Depends on:** Tasks 7, 12
**Files:**
- Modify: `apps/erp/app/routes/x+/shipment+/new.tsx` — new case before `default` (line 271)
- Modify: `apps/erp/app/routes/x+/receipt+/new.tsx` — new case before `default` (line 131)
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.details.tsx` — refuse a source change (lines 61-67), widen the cast (lines 278-281)
- Modify: `apps/erp/app/routes/x+/receipt+/$receiptId.details.tsx` — refuse a source change (lines 56-62), widen the cast (lines 179-181)
- Copy from (precedent): `receipt+/new.tsx:56-111` (the `Sales Return Order` branch)

**Steps:**
1. In `shipment+/new.tsx`, add `case "Rental Agreement":`. Copy `receipt+/new.tsx:56-111` with these changes:
   - The Draft lookup reads `shipment` with `.eq("sourceDocument", "Rental Agreement")`.
   - If a Draft exists, `throw redirect(path.to.shipmentDetails(draft.id))`.
   - The invoke is `{ type: "shipmentFromRentalAgreement", rentalAgreementId: sourceDocumentId }`.
   - Each failure redirects to `path.to.rentalAgreementDetails(sourceDocumentId)`. The fallback text is `"Failed to create shipment"`.
2. In `receipt+/new.tsx`, add the same case with `receipt`, `receiptFromRentalAgreement`, `path.to.receiptDetails` and `"Failed to create receipt"`.
3. In `$shipmentId.details.tsx`, before `if (shipmentDataHasChanged)`, add:

   ```ts
   const sourceChanged =
     currentShipment.data.sourceDocument !== d.sourceDocument ||
     currentShipment.data.sourceDocumentId !== d.sourceDocumentId;
   const isRental =
     currentShipment.data.sourceDocument === "Rental Agreement" ||
     d.sourceDocument === "Rental Agreement";
   if (isRental && sourceChanged) {
     return data(
       {},
       await flash(request, error(null, "A rental shipment keeps its rental agreement. Create it from the agreement."))
     );
   }
   ```

4. Change `if (shipmentDataHasChanged)` to `if (shipmentDataHasChanged && !isRental)`. A location change on a rental shipment then saves through `upsertShipment`.
5. Add `| "Rental Agreement"` to the cast at lines 278-281.
6. Do steps 3–5 in `$receiptId.details.tsx`. Use the text `"A rental receipt keeps its rental agreement. Create it from the agreement."`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
grep -c "Rental Agreement" apps/erp/app/routes/x+/shipment+/new.tsx apps/erp/app/routes/x+/receipt+/new.tsx
# Expected: at least 2 per file
```

**Out of scope:** The source picker in the form (Task 19).

---

## Task 14: Load the rental lines and save their fields

**Depends on:** Task 12
**Files:**
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.tsx` — rental branch after line 104, return `rentalLines` (lines 106-116)
- Modify: `apps/erp/app/routes/x+/receipt+/$receiptId.tsx` — rental branch after line 132, return `rentalLines` (lines 134-154)
- Modify: `apps/erp/app/routes/x+/shipment+/fixed-asset-lines.update.tsx` — validator and `meter`
- Modify: `apps/erp/app/routes/x+/receipt+/fixed-asset-lines.update.tsx` — validator and 4 new fields
- Copy from (precedent): `$shipmentId.tsx:76-104` (the service-role read)

**Steps:**
1. In `$shipmentId.tsx`, declare `let rentalLines: RentalShipmentLine[] = [];`.
2. If `shipment.data.sourceDocument === "Rental Agreement"`, call `getRentalShipmentLines(getCarbonServiceRole(), shipmentId, companyId)`. Use the service role: `rentalAgreementLine` needs `sales_view`, which an inventory user may not hold.
3. On an error, redirect to `path.to.shipments` with the flash `"Failed to load the rental units"`.
4. Map each row:

   | Field | Value |
   |-------|-------|
   | `rentalAgreementLineId` | `row.rentalAgreementLineId!` |
   | `unitName` | `fixedAsset?.name ?? item?.name ?? "Rental unit"` |
   | `assetReadableId` | `fixedAsset?.fixedAssetId ?? null` |
   | `serialNumber` | `fixedAsset?.serialNumber ?? trackedEntity?.readableId ?? null` |
   | `lineStatus` | `rentalAgreementLine.status` |
   | `meter` | `row.meter === null ? null : Number(row.meter)` |

5. Return `rentalLines` with the other loader values.
6. Do steps 1–5 in `$receiptId.tsx` with `getRentalReceiptLines` and `RentalReceiptLine`. Map the 5 receipt fields and `lessorClassification` as they are.
7. In `shipment+/fixed-asset-lines.update.tsx`, parse `Object.fromEntries(await request.formData())` with `shipmentFixedAssetLineUpdateValidator.safeParse`.
8. On a parse failure, return `data({ error: parsed.error.issues[0]?.message }, { status: 400 })`.
9. Build the update from the parsed field:

   | `field` | Update |
   |---------|--------|
   | `shipped` | `{ shipped: value === "true" }` |
   | `serialNumber` | `{ serialNumber: value || null }` |
   | `meter` | `{ meter: value === "" ? null : Number(value) }` |

10. Keep the existing service-role write with `.eq("id", id).eq("companyId", companyId)`. Add `updatedBy: userId` to the update.
11. In `receipt+/fixed-asset-lines.update.tsx`, do steps 7–10 with `receiptFixedAssetLineUpdateValidator` and this map:

    | `field` | Update |
    |---------|--------|
    | `received` | `{ received: value === "true" }` |
    | `serialNumber` | `{ serialNumber: value || null }` |
    | `meter` | `{ meter: value === "" ? null : Number(value) }` |
    | `notes` | `{ notes: value.trim() || null }` |
    | `outOfService` | `value.trim() === "" ? { takeOutOfService: false, outOfServiceReason: null } : { takeOutOfService: true, outOfServiceReason: value.trim() }` |
    | `residualDestination` | `{ residualDestination: value || null }` |

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
```

**Out of scope:** The UI that sends these fields (Tasks 17, 18). A Draft-status guard on these routes.

---

## Task 15: Pass the posting date from the post routes

**Depends on:** Tasks 8, 10
**Files:**
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx` — read `postingDate` (near line 50), pass it (lines 372-377)
- Modify: `apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx` — read `postingDate` (near line 37), pass it (lines 221-225)

**Steps:**
1. In `$shipmentId.post.tsx`, after the `acknowledged` read, add:

   ```ts
   const postingDateValue = formData.get("postingDate");
   const postingDate =
     typeof postingDateValue === "string" && postingDateValue !== ""
       ? postingDateValue
       : undefined;
   ```

2. Change the invoke to `{ type: "post", shipmentId, postingDate }`.
3. Do steps 1–2 in `$receiptId.post.tsx`. The invoke becomes `{ receiptId, postingDate }`.
4. Leave the rule evaluation as it is. A rental document has no `shipmentLine` or `receiptLine` rows, so the storage and sales rules see no lines.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
grep -c "postingDate" "apps/erp/app/routes/x+/shipment+/\$shipmentId.post.tsx" "apps/erp/app/routes/x+/receipt+/\$receiptId.post.tsx"
# Expected: at least 2 per file
```

**Out of scope:** The void routes. They call `post-shipment` / `post-receipt` unchanged.

---

## Task 16: Turn the per-unit Deliver and Return routes into shortcuts

**Depends on:** Tasks 7, 12
**Files:**
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.deliver.tsx` — replace the action
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.return.tsx` — replace the action
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.tsx` — load the related documents (lines 65-83, 162-177)
- Modify: `apps/erp/app/modules/sales/ui/Rentals/types.ts` — `RentalAgreementRouteData` (line 68)
- Copy from (precedent): `receipt+/new.tsx:87-111` (invoke and error flash)

**Steps:**
1. Replace the whole action of `$id.$lineId.deliver.tsx` with:

   ```ts
   export async function action({ request, params }: ActionFunctionArgs) {
     assertIsPost(request);
     const { companyId, userId } = await requirePermissions(request, {
       update: "sales",
       create: "inventory"
     });
     const { id, lineId } = params;
     if (!id) throw notFound("id not found");
     if (!lineId) throw notFound("lineId not found");

     const result = await serverFns
       .system({ db: getDatabaseClient(), companyId, userId })
       .invoke("create", {
         type: "shipmentFromRentalAgreement",
         rentalAgreementId: id,
         rentalAgreementLineId: lineId
       });
     if (result.error || !result.data) {
       throw redirect(
         requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
         await flash(request, error(result.error, getErrorMessage(result.error, "Failed to create the shipment")))
       );
     }
     throw redirect(path.to.shipmentDetails(result.data.id));
   }
   ```

2. Replace the action of `$id.$lineId.return.tsx` the same way with `receiptFromRentalAgreement`, `path.to.receiptDetails` and `"Failed to create the receipt"`. The `create` case accepts a `Pending` or an `On Rent` unit and adds it ticked (spec Q8).
   - Task 23 copies the old body of this route for the release route. It reads that body from commit `11a7a60999` with `git show`.
3. Remove the imports that the old actions used and the new ones do not.
4. In `$id.tsx`, add `getRentalAgreementRelatedDocuments(client, id, companyId)` to the `Promise.all` at lines 65-83.
5. Return `shipments: related.data.shipments` and `receipts: related.data.receipts` from the loader. On `related.error`, keep the empty lists and do not fail the page.
6. In `types.ts`, add to `RentalAgreementRouteData`:

   ```ts
   shipments: RentalAgreementShipment[];
   receipts: RentalAgreementReceipt[];
   ```

7. Derive the two types from `getRentalAgreementRelatedDocuments`:

   ```ts
   type RelatedDocuments = NonNullable<
     Awaited<ReturnType<typeof getRentalAgreementRelatedDocuments>>["data"]
   >;
   export type RentalAgreementShipment = RelatedDocuments["shipments"][number];
   export type RentalAgreementReceipt = RelatedDocuments["receipts"][number];
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
grep -c "post-rental-agreement" "apps/erp/app/routes/x+/rental-agreement+/\$id.\$lineId.return.tsx"
# Expected: 0
```

**Out of scope:** The buttons that post to these routes (Tasks 21, 22).

---

## Task 17: Show the rental units on the shipment page

**Depends on:** Tasks 14, 15
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentLines.tsx` — route-data type (lines 91-105), hide the lines card (lines 238-299), new card and item
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentHeader.tsx` — `canPost` (lines 54-59)
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentPostModal.tsx` — route data (lines 46-53), empty check (lines 119-134), date field, submit (lines 350-354)
- Copy from (precedent): `ShipmentLines.tsx:300-395` (`ShipmentFixedAssetLineItem`), `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementDetailsForm.tsx:213-226` (a date field with a bound)

**Steps:**
1. Add `rentalLines: RentalShipmentLine[]` to the route-data type in `ShipmentLines.tsx`.
2. Set `const isRental = routeData?.shipment?.sourceDocument === "Rental Agreement";`.
3. Render the "Shipment Lines" card (lines 238-299) only when `!isRental`.
4. Add a "Rental Units" card after the "Fixed Assets" card. Copy the card at lines 300-324. It renders `ShipmentRentalLineItem` for each `rentalLines` row.
5. Create `ShipmentRentalLineItem` in the same file. Copy `ShipmentFixedAssetLineItem` (lines 330-395) with these changes:
   - It shows the `shipped` checkbox, `unitName`, then `assetReadableId` and `serialNumber` in small muted text.
   - It has no serial `Input`, no storage-unit picker and no tracking form.
   - It shows a `NumberField` labelled "Meter". It submits `field` `meter` on blur when the value changed. An empty field sends `""`.
6. In `ShipmentHeader.tsx`, read `rentalLines` from the same route data. `canPost` is also true when a `rentalLines` row has `shipped`.
7. In `ShipmentPostModal.tsx`, add `rentalLines: { id: string; shipped: boolean }[]` to the route data.
8. Treat a ticked rental line as "not empty" in the check at lines 119-134.
9. If the source is `Rental Agreement`, render a `DatePicker` from `@carbon/react` above the alerts:
   - label "Delivered on"
   - `value={parseDate(postingDate)}`, with `const companyToday = useCompanyToday();` and `const [postingDate, setPostingDate] = useState(companyToday);`
   - `maxValue={parseDate(companyToday)}`
   - `onChange={(d) => d && setPostingDate(d.toString())}`
10. In the submit (lines 350-354), build a `FormData`. Set `postingDate` on it only for a rental shipment.
11. Import `useCompanyToday` from `~/hooks`. Import `parseDate` from `@internationalized/date`, which the file already imports.
12. Wrap every new visible string in `<Trans>` or `` t`…` ``.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
pnpm exec biome check apps/erp/app/modules/inventory/ui/Shipments
# Expected: no errors
```

**Out of scope:** `ShipmentFixedAssetLineItem` for sales-order assets: do not change it.

---

## Task 18: Show the rental units on the receipt page

**Depends on:** Tasks 14, 15
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx` — route-data type (lines 102-123), hide the lines card (lines 249-300), new card and item
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptHeader.tsx` — `canPost` (lines 56-62)
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptPostModal.tsx` — route data (lines 43-50), empty check (lines 86-101), Return To check, date field, submit (lines 230-234)
- Copy from (precedent): `ReceiptLines.tsx:301-396` (`ReceiptFixedAssetLineItem`), `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementReturnForm.tsx:124-161` (the Return To choice and the out-of-service fields), `apps/erp/app/modules/sales/ui/Quotes/QuoteSummary.tsx` (`RadioGroup` from `@carbon/react`)

**Steps:**
1. Add `rentalLines: RentalReceiptLine[]` to the route-data type. Set `isRental` as Task 17 does.
2. Render the "Receipt Lines" card only when `!isRental`. Add a "Rental Units" card that renders `ReceiptRentalLineItem`.
3. Create `ReceiptRentalLineItem`. Copy `ReceiptFixedAssetLineItem`. It shows these controls, each saved through `path.to.receiptFixedAssetLineUpdate`:

   | Control | `field` | Saves |
   |---------|---------|-------|
   | `received` checkbox | `received` | on change |
   | "Meter" `NumberField` | `meter` | on blur, when changed |
   | "Notes" `Textarea` | `notes` | on blur, when changed |
   | "Take out of service" `Checkbox` plus a "Reason" `Input` | `outOfService` | unticking sends `""` at once; ticking shows the input, and a non-empty reason saves on blur |
   | "Return To" `RadioGroup` (Fleet / Inventory), only when `lessorClassification === "Sale"` | `residualDestination` | on change |

4. Keep the tick of "Take out of service" in local state, seeded from `takeOutOfService`. Under the ticked box with no saved reason, show the helper text "Enter a reason to take the unit out of service".
5. If `lineStatus === "Pending"`, show a `Badge` "Not delivered" next to the unit name (spec Q8). The `create` case leaves such a row unticked.
6. In `ReceiptHeader.tsx`, `canPost` is also true when a `rentalLines` row has `received`.
7. In `ReceiptPostModal.tsx`, add `rentalLines` to the route data. Treat a received rental line as "not empty".
8. For each received rental line with `lessorClassification === "Sale"` and no `residualDestination`, add a validation error: `` t`Choose Return To for ${unitName}` ``. The existing errors list disables the Post button.
9. Add the date field as Task 17 step 9 does, with the label "Returned on".
10. Set `postingDate` on the submitted `FormData` only for a rental receipt.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
pnpm exec biome check apps/erp/app/modules/inventory/ui/Receipts
# Expected: no errors
```

**Out of scope:** The Void button. `ReceiptHeader.tsx:52-54` already shows it only for `Purchase Order` and `Sales Return Order`.

---

## Task 19: Add the source to tables, forms, document panels and traceability

**Depends on:** Tasks 12, 13
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentsTable.tsx` — link case (switch at line 117)
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptsTable.tsx` — link case (switch at line 117)
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentForm/useShipmentForm.tsx` — case (switch at lines 55-153)
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentForm/ShipmentForm.tsx` — source fields (lines 74-99)
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptForm/useReceiptForm.tsx` — case (switch at lines 53-118)
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptForm/ReceiptForm.tsx` — source fields (lines 69-93)
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentDocuments.tsx` — `PACKING_SLIP_SOURCES` (lines 33-38), `useSourceDocument` (lines 47-106)
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptDocuments.tsx` — `useSourceDocument` (lines 58-101), supplier row (line 165)
- Modify: `apps/erp/app/modules/inventory/ui/Traceability/utils.ts` — `sourceLinkHref` (lines 739-762)
- Copy from (precedent): `ShipmentsTable.tsx:128-135` (the `Sales Order` link case), `ShipmentDocuments.tsx:94-105` (the `Sales Return Order` case)

**Steps:**
1. In both tables, add `case "Rental Agreement":`. It renders a `Hyperlink` to `path.to.rentalAgreementDetails(row.original.sourceDocumentId!)` with `sourceDocumentReadableId`.
2. In `useShipmentForm.tsx` and `useReceiptForm.tsx`, add `case "Rental Agreement": break;`. The initial option already holds the agreement's readable id.
3. In `ShipmentForm.tsx`, set `const isRental = initialValues.sourceDocument === "Rental Agreement";`.
4. Filter the `Select` options: drop `"Rental Agreement"` unless `isRental`.
5. Set `isReadOnly={isPosted || isRental}` on the source `Select` and the source `Combobox`.
6. Do steps 3–5 in `ReceiptForm.tsx`.
7. In `ShipmentDocuments.tsx`, add `"Rental Agreement"` to `PACKING_SLIP_SOURCES`.
8. In both `useSourceDocument` switches, add a `"Rental Agreement"` case. Copy the `Sales Return Order` case. Link to `path.to.rentalAgreementDetails(id)`, gate on `permissions.can("view", "sales")`, and use the label "Rental Agreement".
9. In `ReceiptDocuments.tsx` line 165, hide the supplier row for a rental receipt too: `const isSalesReturn = … || receipt.sourceDocument === "Rental Agreement"`. If that variable also gates `ReturnCustomerRow` (lines 433-438), use a second variable for the supplier row only.
10. In `sourceLinkHref`, add this case before `default`:

    ```ts
    case "Rental Agreement":
      return `/x/rental-agreement/${id}/details`;
    ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
grep -c "Rental Agreement" apps/erp/app/modules/inventory/ui/Traceability/utils.ts apps/erp/app/modules/inventory/ui/Shipments/ShipmentsTable.tsx apps/erp/app/modules/inventory/ui/Receipts/ReceiptsTable.tsx
# Expected: at least 1 per file
```

**Out of scope:** A customer row on the rental receipt. `receipt` has no `customerId`.

---

## Task 20: Print a Delivery Ticket

**Depends on:** Tasks 12, 14
**Files:**
- Modify: `packages/documents/src/pdf/blocks/packingSlip/types.ts` — `title`, `rentalUnits` on `PackingSlipData`
- Modify: `packages/documents/src/pdf/blocks/packingSlip/HeaderBlock.tsx` — line 12
- Modify: `packages/documents/src/pdf/blocks/packingSlip/LineItemsBlock.tsx` — rental rows
- Modify: `packages/documents/src/pdf/PackingSlipPDF.tsx` — props (lines 23-40), `data` (lines 82-101)
- Modify: `apps/erp/app/routes/file+/shipment+/$id[.]pdf.tsx` — new case before `default` (line 596)
- Copy from (precedent): `$id[.]pdf.tsx:123-240` (the `Sales Order` case)

**Steps:**
1. In `types.ts`, export:

   ```ts
   export type PackingSlipRentalUnit = {
     id: string;
     name: string;
     assetReadableId: string | null;
     serialNumber: string | null;
   };
   ```

2. Add `title: string` and `rentalUnits?: PackingSlipRentalUnit[]` to `PackingSlipData`.
3. In `HeaderBlock.tsx`, change `title="Packing Slip"` to `title={data.title}`.
4. In `PackingSlipPDF.tsx`, add `rentalUnits?: PackingSlipRentalUnit[]` to `PackingSlipProps`. Put `title` and `rentalUnits` into `data`.
5. In `LineItemsBlock.tsx`, if `data.rentalUnits` has rows, render one row per unit and return:
   - Description column: `name`, then `assetReadableId` in the small grey text.
   - Qty column: `1`.
   - A `Serial` column: `serialNumber`.
   - Use the same zebra and border styles as the shipment rows.
6. In `$id[.]pdf.tsx`, add `case "Rental Agreement":`. Copy the `Sales Order` case with these changes:
   - Read the agreement with `getRentalAgreement(serviceRole, shipment.data.sourceDocumentId, companyId)`.
   - Read the customer and the customer location from `rentalAgreement.customerId` and `customerLocationId`.
   - Read the units with `getRentalShipmentLines(serviceRole, id, companyId)`. Keep only `shipped` rows. Map them with the Task 14 rules to `PackingSlipRentalUnit`.
   - Pass `sourceDocument="Rental Agreement"`, `sourceDocumentId={rentalAgreement.rentalAgreementId}`, `title="Delivery Ticket"`, `rentalUnits`, `trackedEntities={[]}`.
   - Set the PDF meta subject to "Delivery Ticket".
   - Pass `paymentTerm` and `shippingMethod` the way the `Outbound Transfer` case does (lines 483-595) when the agreement has none.
7. Pass `title="Packing Slip"` explicitly in every other case, so `data.title` is always set.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: 0 failed
pnpm --filter @carbon/documents test
# Expected: all pass
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
```

**Out of scope:** The packing-slip template editor.

---

## Task 21: Add Deliver and Return to the agreement header

**Depends on:** Task 16
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementHeader.tsx` — props (lines 43-46), buttons (inside the `HStack` at line 190)
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.tsx` — pass `shipments` and `receipts` to the header (lines 196-202)
- Copy from (precedent): `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx:506-577` (Ship / Shipments), `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderHeader.tsx:77-89` (submit to the create route)

**Steps:**
1. Add `"shipments" | "receipts"` to the `Pick` in `RentalAgreementHeaderProps`. Pass both from `$id.tsx`.
2. Add `const submit = useSubmit();` and these two functions. Copy the shape of `SalesReturnOrderHeader.tsx:77-89`:
   - `deliver()` posts `sourceDocument` `Rental Agreement` and `sourceDocumentId` `id` to `path.to.newShipment`.
   - `returnUnits()` posts the same to `path.to.newReceipt`.
3. Set these flags:

   ```ts
   const canMoveUnits = canUpdate && permissions.can("create", "inventory");
   const hasPendingUnit = lines.some((line) => line.status === "Pending");
   const hasUnitOnRent = …; // already exists at line 85
   ```

4. Before the Invoice button, render the delivery control when `isActive && canMoveUnits`:
   - If `shipments.length === 0`, render a `Button` "Deliver" with `LuTruck`, disabled when `!hasPendingUnit`. It calls `deliver()`.
   - Else render a "Shipments" `DropdownMenu`. Copy `SalesOrderHeader.tsx:506-555`. "New Shipment" is disabled when `!hasPendingUnit` and calls `deliver()`. Each shipment row links to `path.to.shipment(shipment.id)` and shows `ShipmentStatus`.
5. After it, render the return control the same way:
   - "Return" with `LuPackageCheck`, disabled when `!hasUnitOnRent && !hasPendingUnit`, calls `returnUnits()`. A receipt also holds `Pending` units (spec Q8).
   - The "Receipts" dropdown has "New Receipt", disabled on the same rule, and links to `path.to.receipt(receipt.id)` with `ReceiptStatus`.
6. Import `ShipmentStatus` from `~/modules/inventory/ui/Shipments` and `ReceiptStatus` from `~/modules/inventory/ui/Receipts`.
7. Use the variant `primary` for Deliver when `hasPendingUnit`, else `secondary`. Use `secondary` for Return.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
pnpm exec biome check apps/erp/app/modules/sales/ui/Rentals/RentalAgreementHeader.tsx
# Expected: no errors
```

**Out of scope:** Close and Cancel buttons.

---

## Task 22: Replace the `return` type with `release`

**Depends on:** Tasks 10, 16
**Files:**
- Modify: `packages/server-functions/src/post-rental-agreement/validators.ts` — replace `returnValidator` with `releaseValidator`
- Modify: `packages/server-functions/src/post-rental-agreement/validators.test.ts` — replace the `type: "return"` tests
- Modify: `packages/server-functions/src/post-rental-agreement/index.ts` — replace `case "return"` and the `returnUnit` wrapper; header comment (lines 60-81)
- Create: `packages/server-functions/src/post-rental-agreement/release.test.ts`
- Copy from (precedent): the `returnUnit` wrapper written in Task 5, and the open-document query of Task 11

**Steps:**
1. Run `grep -rn 'type: "return"' apps/erp/app packages/jobs/src`. If a caller still sends `type: "return"` to `post-rental-agreement`, STOP and report. (`post-asset-transfer` also has a `return` type; ignore its callers.)
2. In `validators.ts`, delete `returnValidator`. Keep `unitReturnFields` and `unitReturnValidator`. Keep the out-of-service refine on `unitReturnValidator`.
3. Add and export, then put it into `payloadValidator` in place of `returnValidator`:

   ```ts
   /** A Pending unit that never left the yard: stop its billing at
    *  `returnedAt` and free the unit, with no document (spec Q8). */
   export const releaseValidator = z.object({
     type: z.literal("release"),
     rentalAgreementLineId: z.string().min(1),
     returnedAt: calendarDate,
     ...scope
   });
   ```

4. Keep `RETURNABLE_LINE_STATUSES`. `returnRentalUnit` and `receiptReturnError` use it.
5. In `index.ts`, replace the `returnUnit` wrapper with `releaseUnit`. Write its body in this order:
   1. If `futureReleaseError(payload.returnedAt, today)` returns a message, throw it as `InvalidInputError`.
   2. Open `db.transaction()`. Lock the agreement with `lockAgreement`.
   3. If the agreement is not `Active`, throw `` `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are released from an Active agreement` ``.
   4. Read the line `forUpdate()`: `id`, `status`, `lessorClassification`, `fixedAssetId`, by `id`, `rentalAgreementId = agreement.id` and `companyId`. If none, throw `NotFoundError("Rental agreement line not found")`.
   5. Read the asset (`fixedAssetId`, `name`) for `unitLabel`.
   6. Find the first open document that holds the line. Copy the Task 11 queries and add `.where("l.rentalAgreementLineId", "=", line.id)`. Set `openDocument` to `` `shipment ${shipmentId}` ``, else `` `receipt ${receiptId}` ``, else null.
   7. If `releaseBlocker({ label, status, classification, openDocument })` returns a message, throw it as `InvalidInputError`.
   8. Call `returnRentalUnit(trx, { agreement, unit: { rentalAgreementLineId: line.id, returnedAt: payload.returnedAt }, companyId, userId, today })`. Pass no `locationId`, no meter, no notes and no out-of-service fields.
   9. Return `{ id: agreement.id }`.
6. In the dispatch, replace `case "return"` with `case "release"`. It computes `today` exactly as the old case did and calls `releaseUnit`.
7. Release passes no residual destination. So a `Sale` line can never pass `salesTypeReturnError`. Step 5.7 refuses it first with a clear message (plan decision P1).
8. In the header comment, replace the `return` paragraph with these 2 lines:
   - "A unit comes back through a rental receipt (`post-receipt`), which calls `returnRentalUnit`."
   - "release: a Pending unit that never left the yard stops billing at the release date and is free again."
9. Update the doc comment above `postRentalAgreement` (`/** Activates, returns a unit of, closes or cancels …`): it activates, releases a unit of, closes or cancels.
10. In `validators.test.ts`, delete each test that parses `type: "return"`. Add 2 `release` tests: it needs the line id and a `YYYY-MM-DD` date; it strips `meterIn`.
11. Create `release.test.ts`. Use `rentalFixture()` from Task 4 (the line is `Pending`, Advance billing, September invoiced, October pending). Write these `databaseTest` cases:
    1. Release with `returnedAt` `2026-09-20`. Expect the line `Returned` with `returnedAt` `2026-09-20`. Expect no `Pending` period that starts after `2026-09-20`. Expect 1 `isAdjustment` row. Expect `fleetAssets.fleetStatus` = `Available`. Expect `fixedAsset.locationId` unchanged.
    2. Set the line `On Rent`. The release fails with `is On Rent; only a Pending unit can be released`.
    3. A `returnedAt` of company today plus 1 day fails with `The release date cannot be in the future`.
    4. Set `lessorClassification` `Sale`. The release fails with `is treated as a sale; return it on a rental receipt instead`.
    5. Create a Draft shipment with the Task 7 case. The release fails with `is on shipment SHP-`.

**Verify:**
```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions exec vitest run src/post-rental-agreement src/post-receipt src/post-shipment src/create
# Expected: all pass, release.test.ts has 5 passed; return-unit.test.ts with no snapshot change
grep -c 'literal("return")' packages/server-functions/src/post-rental-agreement/validators.ts
# Expected: 0
pnpm --filter @carbon/server-functions exec vitest run src/permissions-manifest.test.ts
# Expected: passes with no snapshot change (still update: sales)
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: 0 failed
```

**Out of scope:** The `activate`, `close` and `cancel` types. The release UI (Task 23).

---

## Task 23: Repoint the unit actions and add Release unit

**Depends on:** Tasks 16, 22
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add `rentalAgreementLineRelease` after `rentalAgreementLineReturn` (lines 2174-2175)
- Create: `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.release.tsx`
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — replace `rentalAgreementReturnValidator` (lines 1528-1566) with `rentalAgreementReleaseValidator`
- Rename: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementReturnForm.tsx` → `RentalAgreementReleaseForm.tsx` (`git mv`), then cut it down
- Modify: `apps/erp/app/modules/sales/ui/Rentals/index.ts` — the form's import and export (lines 15, 54)
- Modify: `apps/erp/app/modules/sales/ui/Rentals/useRentalLineActions.tsx` — action type (line 13), state (lines 15-26, 63-82), modals (lines 92-139)
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementLineSummary.tsx` — Release button in the footer (after lines 97-106); Delivered / Returned rows (lines 76-81)
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementExplorer.tsx` — Release item after the Return item (lines 213-220)
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementSummary.tsx` — `SummaryLine` (lines 190-295)
- Copy from (precedent): `git show 11a7a60999:'apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.return.tsx'` (the route at commit `11a7a60999`, before Task 16), `SalesReturnOrderHeader.tsx:77-89` (submit)

**Steps:**
1. In `path.ts`, add:

   ```ts
   rentalAgreementLineRelease: (id: string, lineId: string) =>
     generatePath(`${x}/rental-agreement/${id}/${lineId}/release`),
   ```

2. In `sales.models.ts`, replace `rentalAgreementReturnValidator` with:

   ```ts
   export const rentalAgreementReleaseValidator = z.object({
     rentalAgreementLineId: z
       .string()
       .min(1, { message: "Rental agreement line is required" }),
     returnedAt: z.string().min(1, { message: "Release date is required" })
   });
   ```

3. Keep `rentalResidualDestinations`. Task 12's receipt validator and Task 18 use it.
4. Create `$id.$lineId.release.tsx`. Copy the old return route from `git show`. Change it like this:
   - Permissions: `{ update: "sales" }`.
   - Validate with `rentalAgreementReleaseValidator`.
   - Drop the line re-read and the `isSalesType` branch. The server function checks the line.
   - Invoke `{ type: "release", rentalAgreementId: id, rentalAgreementLineId: lineId, returnedAt }`.
   - On error, flash `getErrorMessage(result.error, "Failed to release the unit")`.
   - On success, flash `"Unit released"`.
   - Redirect to `requestReferrer(request) ?? path.to.rentalAgreementDetails(id)`, as the old route did.
5. Run `git mv` to rename the form to `RentalAgreementReleaseForm.tsx`. Rename the component and its props type.
6. In the form, keep the `ValidatedForm`, the fetcher, the `Hidden` line id and the `DatePicker`. Delete the meter, notes, out-of-service and Return To fields and the `isSalesType` hidden field.
7. Set the `DatePicker` label to "Release date". Pass `maxValue={parseDate(today)}`, with `today` from `useCompanyToday()`.
8. Set the modal title to `` t`Release ${unitLabel}` ``. Add the text "The unit never left the yard. Billing stops on the release date, and the unit is free again." Set the submit label to "Release unit".
9. Update `index.ts` to import and export `RentalAgreementReleaseForm`.
10. In `useRentalLineActions.tsx`:
    1. Add `"release"` to `RentalLineAction`. Add `canRelease` and `releaseDisabled` to `RentalLineActionState`.
    2. Set `canReturn = isActive && (line.status === "On Rent" || line.status === "Pending")` (spec Q8).
    3. Set `canRelease = isActive && line.status === "Pending" && line.lessorClassification !== "Sale"` (plan decision P1).
    4. Set `canSell` on `isActive && line.status === "On Rent"`, not on `canReturn`, so a `Pending` unit is never offered Sell.
    5. Set `const canMoveUnits = canUpdate && permissions.can("create", "inventory")`. Set `deliverDisabled` and `returnDisabled` to `!canMoveUnits`. Set `releaseDisabled` to `!canUpdate`.
    6. Make `open("deliver", line)` call `submit(new FormData(), { method: "post", action: path.to.rentalAgreementLineDeliver(id, line.id) })`. Use `useSubmit` from `react-router`.
    7. Make `open("return", line)` post the same way to `path.to.rentalAgreementLineReturn(id, line.id)`.
    8. Make `open("release", line)` set the pending action, as `sell` does.
    9. Delete the Deliver `Confirm` and the return modal. Add a modal for `"release"`: `RentalAgreementReleaseForm` with `action={path.to.rentalAgreementLineRelease(id, pending.line.id)}` and `initialValues={{ rentalAgreementLineId: pending.line.id, returnedAt: today }}`.
    10. Update the hook's doc comment: Deliver and Return open a document; Release unit opens a date modal.
11. In `RentalAgreementLineSummary.tsx`, add a "Release unit" `Button` after the Return button. Show it when `state.canRelease`. Use `variant="secondary"`, `leftIcon={<LuCircleSlash />}` and `isDisabled={state.releaseDisabled}`.
12. In `RentalAgreementExplorer.tsx`, add a "Release unit" `DropdownMenuItem` after the Return item, with the same rule.
13. In `RentalAgreementSummary.tsx` and `RentalAgreementLineSummary.tsx`, read `shipments` and `receipts` from `useRouteData<RentalAgreementRouteData>(path.to.rentalAgreement(id))`.
14. Call `rentalLineDocuments(line.id, shipments, receipts)` for each unit.
15. In `SummaryLine`, show a `Link` to `path.to.shipment(shipment.id)` labelled with `shipmentId`, and one to `path.to.receipt(receipt.id)` labelled with `receiptId`, when each exists.
16. In `RentalAgreementLineSummary`, put the same links next to the "Delivered" and "Returned" dates.
17. If `grep -rn "rentalAgreementReturnValidator\|RentalAgreementReturnForm" apps/erp/app` finds a user, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
grep -rn "rentalAgreementReturnValidator\|RentalAgreementReturnForm" apps/erp/app | wc -l
# Expected: 0
grep -c "rentalAgreementLineRelease" apps/erp/app/utils/path.ts
# Expected: 1
pnpm run generate:mcp && pnpm check:manifest
# Expected: check:manifest exits 0
pnpm exec biome check apps/erp/app/modules/sales/ui/Rentals
# Expected: no errors
```

**Out of scope:** The Sell action and its route.

---

## Task 24: Run the full verification sweep

**Depends on:** Tasks 1–23
**Files:**
- Modify: only files that a check below fixes

**Steps:**
1. Run `pnpm --filter @carbon/checks license-headers`.
2. Run each command below in order.
3. Fix a failure only when its cause is a file this plan changed. Otherwise STOP and report.

**Verify:**
```bash
pnpm run lint
# Expected: exit 0
pnpm exec turbo run typecheck --filter=@carbon/server-functions --filter=@carbon/documents --filter=erp --concurrency=1
# Expected: 0 failed
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
pnpm --filter @carbon/server-functions test
# Expected: 0 failed; the rental tests report "passed", not "skipped"
pnpm --filter erp test
# Expected: 0 failed
pnpm --filter @carbon/checks test
# Expected: 0 failed
pnpm check:manifest
# Expected: exit 0
pnpm db:check:datasets
# Expected: exit 0
pnpm db:check:backups
# Expected: exit 0
pnpm build:erp
# Expected: build succeeds; no "Server-only module referenced by client"
```

**Out of scope:** A whole-repo typecheck.

---

## Task 25: Extract and translate the new strings

**Depends on:** Task 24
**Files:**
- Modify: `packages/locale/locales/*/*.po` — by the extractor and the `/translate` skill only

**Steps:**
1. Run `pnpm lingui:extract`.
2. Invoke the `/translate` skill to fill the empty `msgstr` entries.
3. Run `pnpm lingui:clean`.

**Verify:**
```bash
pnpm lingui:check
# Expected: exit 0
git status --short packages/locale/locales | head
# Expected: only .po files changed; no compiled .mjs files
```

**Out of scope:** Server-function error messages. They are English only.

---

## Task 26: Update the docs

**Depends on:** Tasks 22, 23
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — Rentals section (lines 125, 140, 147, 150, 156, 159)
- Modify: `apps/erp/app/modules/inventory/AGENTS.md` — Receipt and Shipment concepts (lines 10-11), data model (lines 51-52)
- Modify: `packages/server-functions/AGENTS.md` — the `post-rental-agreement` mention (around line 134)
- Modify: `.claude/rules/shipments-receipts-ui-patterns.md` — the rental source and `PACKING_SLIP_SOURCES`
- Modify: `.claude/rules/fixed-asset-lifecycle.md` — the Deliver and return lines (lines 449-470)
- Modify: `docs/content/docs/reference/rental-agreements.mdx` — lines 55-67, 225, 295, 312
- Modify: `docs/content/docs/reference/shipments.mdx` and `docs/content/docs/reference/receipts.mdx` — the source document field

Do not edit the spec. It already carries the planning corrections.

**Steps:**
1. Load the `carbon-docs` skill before you edit an `.mdx` file.
2. In `sales/AGENTS.md`, state these facts:
   - Deliver and Return go through a rental shipment and a rental receipt (`create` types `shipmentFromRentalAgreement` / `receiptFromRentalAgreement`).
   - `post-shipment` and `post-receipt` own the `Rental Agreement` source. They take an optional `postingDate`.
   - `$id.$lineId.deliver` / `return` are shortcuts that open a one-unit document. They need `update: sales` and `create: inventory`.
   - `returnRentalUnit` (`post-rental-agreement/return-unit.ts`) holds the return body. It takes an optional `locationId`: a rental receipt passes its own location, so a `Sale` line's residual lands there (spec Q7).
   - A rental receipt holds every `On Rent` unit ticked and every `Pending` unit unticked (spec Q8).
   - `post-rental-agreement` has no `return` type. Its `release` type ends a `Pending` unit with no document. It refuses a `Sale` line and a unit on an open rental document. The route is `$id.$lineId.release` (`update: sales`).
   - Close refuses while an open rental document has a line.
   - Rentals safety line 156: no app code writes a line status; Deliver is no longer the exception.
3. In `inventory/AGENTS.md`, add `Rental Agreement` to both source lists. Describe `rentalAgreementLineId`, `meter` and the receipt condition columns on the fixed-asset line tables.
4. In `server-functions/AGENTS.md`, list `post-rental-agreement` as `activate` / `release` / `close` / `cancel` if the file lists its types.
5. In the two rules files, replace the old Deliver route facts with the document flow.
6. In `rental-agreements.mdx`:
   - Rewrite the Deliver and Return bullets (lines 60-61): a unit leaves on a shipment and comes back on a receipt.
   - Link `[shipment](/docs/reference/shipments)` and `[receipt](/docs/reference/receipts)`.
   - Name the "Delivered on" and "Returned on" fields.
   - State that a receipt lists the units not yet delivered, unticked. Ticking one stops its billing at the return date.
   - Add a **"Release unit"** bullet: it ends a pending unit that never left the yard, at a date no later than today. It is not offered for a unit treated as a sale.
   - State that a unit treated as a sale and returned to inventory goes into stock at the receipt's location.
   - Add the Close refusal "Shipment … is still open; post or delete it before closing the agreement" to the troubleshooting list.
7. In `shipments.mdx` and `receipts.mdx`, add the rental agreement to the source document field. State that a rental unit posts no inventory or journal entry.
8. Note for the release: the changelog entry, written later with `/changelog-entry`, must say that delivery now needs inventory create permission.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: exit 0
cd docs && for l in $(grep -oh "](/docs/[^)]*)" content/docs/reference/rental-agreements.mdx content/docs/reference/shipments.mdx content/docs/reference/receipts.mdx | sed 's|](/docs/||;s|)||' | sort -u); do [ -f "content/docs/$l.mdx" ] || [ -f "content/docs/$l/index.mdx" ] || echo "MISSING $l"; done; cd ..
# Expected: no MISSING line
grep -c "updates the line directly" apps/erp/app/modules/sales/AGENTS.md
# Expected: 0
```

**Out of scope:** The changelog entry itself.

---

## Task 27: Verify in the browser

**Depends on:** Tasks 24, 25, 26
**Files:**
- Create: `.ai/playbooks/` entry — by the `/test` skill only

**Steps:**
1. Ask the user for permission to drive the browser.
2. Invoke the `/test` skill with this plan's acceptance table below as the test list.
3. Use the `/auth` skill to sign in.
4. Set up an Active agreement with 5 serial fleet units. Use the agreement setup wizard, or `pnpm db:seed:dev` data if it has rentals.
5. For the release rows, use a second Active agreement with 1 `Pending` unit. Release it with a date 2 days ago. Then check the Billing Periods card and the fleet register.
6. Run each row of the coverage table that names Task 27.
7. On any failure, use the `/error` skill and STOP. Report the row and the screenshot path.

**Verify:**
```text
Every coverage row that names Task 27 is PASS in the /test report.
```

**Out of scope:** Fixing failures in this task.

---

## Acceptance coverage

| Spec acceptance criterion | Tasks |
|---------------------------|-------|
| Deliver on RA-1 with 5 Pending units creates one Draft rental shipment with 5 ticked lines at RA-1's location | 7, 13, 21, 27 |
| Untick 2, Delivered on = 3 days ago, meter 120 on one, post: 3 lines On Rent with that `deliveredAt`, `meterOut` 120; 2 stay Pending | 8, 14, 15, 17, 27 |
| No new `itemLedger`, `costLedger` or `journalLine` row; one `Rental Delivery` activity per tracked unit | 8 |
| A second Deliver creates a Draft with the 2 remaining units; Deliver while the Draft exists opens it | 7, 13, 21, 27 |
| Two Draft rental shipments for one agreement fail on `shipment_oneOpenDraftPerRentalAgreement_idx` | 2, 7 |
| `post-shipment` refuses a unit that another document delivered, and names the unit | 8 |
| `post-shipment` refuses a Delivered on date in the future | 6, 8, 17 |
| `post-shipment` refuses an out-of-service unit and names the reason | 8 |
| Return with 3 units On Rent creates a Draft receipt with 3 lines; receiving 1 at location B with "Hydraulic leak" makes it Returned, moves the asset to B and shows In Maintenance | 7, 10, 18, 27 |
| A returned Advance-billed Rental line gets the same early-return adjustment as today; a test pins the periods against the old path | 4, 5, 10 |
| A Sale line cannot post without Return To; with Inventory it writes the same `itemLedger` row and journal as today | 10, 18 |
| The per-unit Return shortcut creates a one-unit Draft receipt that posts in 2 clicks | 7, 16, 23, 27 |
| Voiding a rental shipment returns its units to Pending and clears `deliveredAt` and `meterOut`; a posted Accrual row blocks the void | 6, 9, 27 |
| `post-receipt` refuses to void a rental receipt with the exact message | 10 |
| Close refuses an agreement with a Draft rental receipt that has a line, and names the receipt | 6, 11 |
| Inventory → Shipments lists the rental shipment with source "Rental Agreement", linked to the agreement | 12, 19, 27 |
| The rental shipment's PDF prints a Delivery Ticket with the 3 delivered units and their serial numbers | 20, 27 |
| A sales order shipment with a fixed-asset line posts as before; `rentalAgreementLineId` stays null | 3, 24, 27 |
| A `Sale` line returned to Inventory on a receipt at location B books its `itemLedger` row at B (spec Q7) | 5, 10 |
| A `Pending` unit released with a backdated date stops billing and frees the unit | 6, 22, 23, 27 |
| A `Pending` unit on a receipt is unticked by default; ticking it and posting returns it | 7, 10, 18, 27 |
| Release is refused for a line that is not `Pending` and for a future date | 6, 22, 23 |

## Self-check

- [x] STE-80 review pass done. Instructions stay within 20 words and facts within 25. No passive hides its actor. Sequences are numbered lists. Each concept has one term ("rental shipment", "rental receipt", "asset line", "unit", "release"). No "etc.", "various", "as appropriate" or "TBD".
- [x] Every task has exact paths, exact commands and an expected output.
- [x] Both migration tasks follow the hard rules, and Task 3 runs `generate:types` after them.
- [x] Every UI task names its precedent file.
- [x] No whole-repo typecheck.
- [x] Every acceptance criterion maps to a task, and the last task is browser verification through `/test`.

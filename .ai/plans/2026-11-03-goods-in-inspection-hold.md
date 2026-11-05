# Goods-In Inspection Hold — implementation plan

**Spec:** .ai/specs/2026-11-03-goods-in-inspection-hold.md
**Research:** .ai/research/2026-11-03-goods-in-inspection-hold.md
**Closest sibling:** no new record type. Siblings per part: `location.responsibleEmployee` + `ResponsibleEmployeeCard` (settings), `stockTransfer.kanbanId` (putaway link), `app.storage_unit_nettable_refresh` (release GUC), `RejectLotModal` (Partial modal).
**Branch:** naveenkash/goods-in-inspection-hold

## Progress
- [x] Task 1: Migration — enum values
- [x] Task 2: Migration — columns, view, functions, backfill
- [x] Task 3: Interceptors — hold guard and status roll-up
- [x] Task 4: Regenerate types and apply
- [x] Task 5: SQL test for the guard and the roll-up
- [x] Task 6: Status constants, colors and badges
- [x] Task 7: Location settings operation and card
- [x] Task 8: Receipt line defaults and flag
- [x] Task 9: Post checks and lot storage unit
- [x] Task 10: Receipt void cancels open lots
- [x] Task 11: Release GUC helper and unpick fix
- [x] Task 12: Disposition engine — Partial quantity, rejected move, write-off unit
- [x] Task 13: Partial Lot operation, route and modal
- [x] Task 14: Inventory count warning
- [x] Task 15: Put Away operation and button
- [x] Task 16: Receipt UI — badges, column, filter, sidebar
- [x] Task 17: Demo datasets
- [x] Task 18: Database tests for service paths
- [x] Task 19: Rules, AGENTS.md and docs
- [x] Task 20: Gates and browser verification (gates green 2026-11-04 and 2026-11-05; browser checks done 2026-11-05: receive and post an inspected receipt, the hold guard's refusal, Partial, Put Away, pick the put-away stock, and a worst-case UI pass)

## Dependencies
- Task 2 needs Task 1. Task 3 needs Task 2. Task 4 needs Tasks 1–3.
- Every task from 5 on needs Task 4 (types).
- Tasks 6, 7, 8, 11, 17 are independent of each other.
- Task 9 needs Task 8. Task 10 needs Task 11 (GUC helper).
- Task 12 needs Task 11. Task 13 needs Task 12. Task 14 needs Task 11.
- Task 15 needs Tasks 6 and 9. Task 16 needs Tasks 6 and 15.
- Task 18 needs Tasks 9–15. Tasks 19 and 20 come last.

## Conventions for every task
- Run commands from the repo root `/Users/naveenkashyap/conductor/workspaces/carbon/seattle`.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after creating files.
- Use `@internationalized/date` and `@carbon/utils` for dates, never JS `Date`.
- Every user-facing string goes through Lingui (`<Trans>`, `` t`…` `` from `useLingui`).
- The release GUC is `app.inspection_release`. Its value is `'on'`. Set it with `set_config(..., true)` (transaction-local).
- Do not rebuild the database. `pnpm db:migrate` applies pending migrations only.

---

## Task 1: Migration — enum values

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_inspection-hold-enums.sql`

**Steps:**
1. Run `pnpm db:migrate:new inspection-hold-enums`.
2. If the file name has `000000` as HHMMSS, rename it to a real time.
3. Write this SQL:
```sql
-- Goods-in inspection hold (spec 2026-11-03). Enum values go in their own
-- migration: a new value cannot be used in the transaction that adds it.
ALTER TYPE "inspectionStatusType" ADD VALUE IF NOT EXISTS 'Cancelled';

DO $$ BEGIN
  CREATE TYPE "receiptInspectionStatus" AS ENUM (
    'Not Required',
    'Pending Inspection',
    'Inspection In Progress',
    'Inspection Passed',
    'Inspection Failed',
    'Partially Passed',
    'Put Away'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```
4. Write the SQL into the file before you run any migrate command (lesson: an empty file can be recorded as applied).

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: <timestamp>_inspection-hold-enums.sql, newer than 20261102182626
```

**Out of scope:** any column or function.

---

## Task 2: Migration — columns, view, functions, backfill

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_inspection-hold.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261012232517_kanban-replenishment-level.sql:58-67` (FK + partial index), `packages/database/supabase/migrations/20260811123616_widen-purchasing-scale.sql:453-464` (newest `receiptLines` view)

**Steps:**
1. Run `pnpm db:migrate:new inspection-hold`.
2. Add the location columns:
```sql
ALTER TABLE "location"
  ADD COLUMN IF NOT EXISTS "inspectionStorageUnitId" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedStorageUnitId" TEXT;
ALTER TABLE "location" DROP CONSTRAINT IF EXISTS "location_inspectionStorageUnitId_fkey";
ALTER TABLE "location" ADD CONSTRAINT "location_inspectionStorageUnitId_fkey"
  FOREIGN KEY ("inspectionStorageUnitId") REFERENCES "storageUnit"("id") ON DELETE RESTRICT;
ALTER TABLE "location" DROP CONSTRAINT IF EXISTS "location_rejectedStorageUnitId_fkey";
ALTER TABLE "location" ADD CONSTRAINT "location_rejectedStorageUnitId_fkey"
  FOREIGN KEY ("rejectedStorageUnitId") REFERENCES "storageUnit"("id") ON DELETE RESTRICT;
```
3. Add the receipt columns:
```sql
ALTER TABLE "receipt"
  ADD COLUMN IF NOT EXISTS "inspectionStatus" "receiptInspectionStatus" NOT NULL DEFAULT 'Not Required';
CREATE INDEX IF NOT EXISTS "receipt_companyId_inspectionStatus_idx"
  ON "receipt" ("companyId", "inspectionStatus");
ALTER TABLE "receiptLine"
  ADD COLUMN IF NOT EXISTS "requiresInspection" BOOLEAN NOT NULL DEFAULT false;
```
4. Recreate the `receiptLines` view. Copy its body verbatim from `20260811123616_widen-purchasing-scale.sql:453-464`. Use `DROP VIEW IF EXISTS "receiptLines"; CREATE VIEW ... WITH (security_invoker = true)` exactly as that file does. Keep every column.
5. If a newer migration than `20260811123616` redefines `receiptLines`, copy that one instead. Check with `grep -l 'VIEW "receiptLines"' packages/database/supabase/migrations/* | tail -1`.
6. Add the lot columns:
```sql
ALTER TABLE "inspection"
  ADD COLUMN IF NOT EXISTS "storageUnitId" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptedQuantity" NUMERIC;
ALTER TABLE "inspection" DROP CONSTRAINT IF EXISTS "inspection_storageUnitId_fkey";
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_storageUnitId_fkey"
  FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "inspection_hold_idx"
  ON "inspection" ("storageUnitId", "itemId")
  WHERE "status" IN ('Pending', 'In Progress', 'Partial') AND "storageUnitId" IS NOT NULL;
```
7. Add the putaway link:
```sql
ALTER TABLE "stockTransfer" ADD COLUMN IF NOT EXISTS "receiptId" TEXT;
ALTER TABLE "stockTransfer" DROP CONSTRAINT IF EXISTS "stockTransfer_receiptId_fkey";
ALTER TABLE "stockTransfer" ADD CONSTRAINT "stockTransfer_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "stockTransfer_receiptId_idx"
  ON "stockTransfer" ("receiptId") WHERE "receiptId" IS NOT NULL;
ALTER TABLE "stockTransferLine" ADD COLUMN IF NOT EXISTS "receiptLineId" TEXT;
ALTER TABLE "stockTransferLine" DROP CONSTRAINT IF EXISTS "stockTransferLine_receiptLineId_fkey";
ALTER TABLE "stockTransferLine" ADD CONSTRAINT "stockTransferLine_receiptLineId_fkey"
  FOREIGN KEY ("receiptLineId") REFERENCES "receiptLine"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "stockTransferLine_receiptLineId_idx"
  ON "stockTransferLine" ("receiptLineId") WHERE "receiptLineId" IS NOT NULL;
```
8. Add the held-quantity function. It counts open lots and Partial lots whose NCR is not closed:
```sql
CREATE OR REPLACE FUNCTION public.inspection_held_quantity(
  p_company_id TEXT, p_item_id TEXT, p_storage_unit_id TEXT
) RETURNS NUMERIC
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN i."status" IN ('Pending', 'In Progress') THEN i."lotSize"
      ELSE GREATEST(i."lotSize" - COALESCE(i."acceptedQuantity", 0), 0)
    END
  ), 0)
  FROM "inspection" i
  JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
  WHERE i."companyId" = p_company_id
    AND i."itemId" = p_item_id
    AND i."storageUnitId" = p_storage_unit_id
    AND it."itemTrackingType" = 'Inventory'
    AND (
      i."status" IN ('Pending', 'In Progress')
      OR (
        i."status" = 'Partial'
        AND i."acceptedQuantity" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "nonConformanceInspection" nci
          JOIN "nonConformance" nc ON nc."id" = nci."nonConformanceId"
          WHERE nci."inspectionId" = i."id" AND nc."status" = 'Closed'
        )
      )
    );
$$;
```
9. Add the roll-up function. It follows the spec table, in order, and ignores `Cancelled` lots:
```sql
CREATE OR REPLACE FUNCTION public.refresh_receipt_inspection_status(p_receipt_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_total INT; v_pending INT; v_open INT; v_passed INT; v_failed INT;
  v_passed_qty NUMERIC; v_put_away_qty NUMERIC;
  v_status "receiptInspectionStatus";
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE "status" = 'Pending'),
    COUNT(*) FILTER (WHERE "status" IN ('Pending', 'In Progress')),
    COUNT(*) FILTER (WHERE "status" = 'Passed'),
    COUNT(*) FILTER (WHERE "status" = 'Failed'),
    COALESCE(SUM(CASE
      WHEN "status" = 'Passed' THEN "lotSize"
      WHEN "status" = 'Partial' THEN COALESCE("acceptedQuantity", 0)
      ELSE 0 END), 0)
  INTO v_total, v_pending, v_open, v_passed, v_failed, v_passed_qty
  FROM "inspection"
  WHERE "sourceDocument" = 'Receipt'
    AND "sourceDocumentId" = p_receipt_id
    AND "status" <> 'Cancelled';

  SELECT COALESCE(SUM(stl."pickedQuantity"), 0) INTO v_put_away_qty
  FROM "stockTransferLine" stl
  JOIN "stockTransfer" st ON st."id" = stl."stockTransferId" AND st."companyId" = stl."companyId"
  WHERE st."receiptId" = p_receipt_id AND st."status" = 'Completed';

  v_status := CASE
    WHEN v_total = 0 THEN 'Not Required'
    WHEN v_pending = v_total THEN 'Pending Inspection'
    WHEN v_open > 0 THEN 'Inspection In Progress'
    WHEN v_passed_qty > 0 AND v_put_away_qty >= v_passed_qty THEN 'Put Away'
    WHEN v_failed = v_total THEN 'Inspection Failed'
    WHEN v_passed = v_total THEN 'Inspection Passed'
    ELSE 'Partially Passed'
  END;

  UPDATE "receipt" SET "inspectionStatus" = v_status
  WHERE "id" = p_receipt_id AND "inspectionStatus" IS DISTINCT FROM v_status;
END;
$$;
```
10. Add the backfill, in this order:
```sql
UPDATE "receiptLine" rl SET "requiresInspection" = true
WHERE EXISTS (SELECT 1 FROM "inspection" i
  WHERE i."sourceDocument" = 'Receipt' AND i."sourceDocumentLineId" = rl."id");

UPDATE "inspection" i SET "storageUnitId" = rl."storageUnitId"
FROM "receiptLine" rl
WHERE i."sourceDocument" = 'Receipt' AND i."sourceDocumentLineId" = rl."id"
  AND i."storageUnitId" IS NULL;

UPDATE "inspection" i SET "status" = 'Cancelled'
FROM "receipt" r
WHERE i."sourceDocument" = 'Receipt' AND i."sourceDocumentId" = r."id"
  AND r."status" = 'Voided' AND i."status" IN ('Pending', 'In Progress');

SELECT public.refresh_receipt_inspection_status(r."id")
FROM "receipt" r
WHERE EXISTS (SELECT 1 FROM "inspection" i
  WHERE i."sourceDocument" = 'Receipt' AND i."sourceDocumentId" = r."id");

NOTIFY pgrst, 'reload schema';
```
11. If the Task 1 enum is not applied yet when this file runs, the `'Cancelled'` literal fails. Task 1's timestamp is older, so `pnpm db:migrate` applies it first.

**Verify:**
```bash
pnpm --filter @carbon/checks clobbers
# Expected: exit 0, no finding for the receiptLines view
```

**Out of scope:** triggers and interceptors (Task 3). The `location` RLS policies stay as they are.

---

## Task 3: Interceptors — hold guard and status roll-up

**Depends on:** Task 2
**Files:**
- Create: `packages/database/src/event-system/handlers/check_inspection_hold.sql`
- Create: `packages/database/src/event-system/handlers/sync_receipt_inspection_status.sql`
- Modify: `packages/database/src/event-system/attachments.ts` — `itemLedger` gains `before`, `inspection` and `stockTransfer` gain `after`
- Copy from (precedent): `packages/database/src/event-system/handlers/storage_unit_enforce_same_location.sql` (a raising BEFORE handler)

**Steps:**
1. Write `check_inspection_hold.sql`:
```sql
CREATE OR REPLACE FUNCTION public.check_inspection_hold(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_qty NUMERIC := (p_new->>'quantity')::numeric;
  v_unit TEXT := p_new->>'storageUnitId';
  v_entity TEXT := p_new->>'trackedEntityId';
  v_held NUMERIC;
  v_on_hand NUMERIC;
  v_item TEXT;
  v_unit_name TEXT;
BEGIN
  IF p_operation <> 'INSERT' OR v_qty IS NULL OR v_qty >= 0 THEN
    RETURN;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  IF v_entity IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "trackedEntity" WHERE "id" = v_entity AND "status" = 'On Hold') THEN
      SELECT COALESCE(it."readableIdWithRevision", it."readableId") INTO v_item
      FROM "item" it WHERE it."id" = p_new->>'itemId';
      RAISE EXCEPTION '% is held for inspection. Quality must decide its inspection lot before it can move.', COALESCE(v_item, p_new->>'itemId')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN;
  END IF;

  IF v_unit IS NULL THEN
    RETURN;
  END IF;
  -- Fast path: no open hold names this storage unit.
  IF NOT EXISTS (
    SELECT 1 FROM "inspection"
    WHERE "storageUnitId" = v_unit AND "itemId" = p_new->>'itemId'
      AND "status" IN ('Pending', 'In Progress', 'Partial')
  ) THEN
    RETURN;
  END IF;

  v_held := public.inspection_held_quantity(p_new->>'companyId', p_new->>'itemId', v_unit);
  IF v_held <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM("quantity"), 0) INTO v_on_hand
  FROM "itemLedger"
  WHERE "itemId" = p_new->>'itemId' AND "storageUnitId" = v_unit
    AND "companyId" = p_new->>'companyId';

  IF v_on_hand + v_qty < v_held THEN
    SELECT COALESCE(it."readableIdWithRevision", it."readableId") INTO v_item
    FROM "item" it WHERE it."id" = p_new->>'itemId';
    SELECT "name" INTO v_unit_name FROM "storageUnit" WHERE "id" = v_unit;
    RAISE EXCEPTION '% is held for inspection in %. Quality must decide its inspection lot before it can move.', COALESCE(v_item, p_new->>'itemId'), COALESCE(v_unit_name, v_unit)
      USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;
```
2. If `item` has no `readableIdWithRevision` column, use `readableId` only. Check with `grep -n "readableIdWithRevision" packages/database/src/types.ts | head -3`.
3. Write `sync_receipt_inspection_status.sql`. It handles both tables:
```sql
CREATE OR REPLACE FUNCTION public.sync_receipt_inspection_status(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_table = 'inspection' THEN
    IF COALESCE(p_new->>'sourceDocument', p_old->>'sourceDocument') <> 'Receipt' THEN
      RETURN;
    END IF;
    IF p_operation = 'UPDATE'
       AND p_new->>'status' IS NOT DISTINCT FROM p_old->>'status'
       AND p_new->>'acceptedQuantity' IS NOT DISTINCT FROM p_old->>'acceptedQuantity' THEN
      RETURN;
    END IF;
    PERFORM public.refresh_receipt_inspection_status(
      COALESCE(p_new->>'sourceDocumentId', p_old->>'sourceDocumentId'));
  ELSIF p_table = 'stockTransfer' THEN
    IF p_operation <> 'UPDATE' OR p_new->>'receiptId' IS NULL THEN
      RETURN;
    END IF;
    IF p_new->>'status' IS NOT DISTINCT FROM p_old->>'status' THEN
      RETURN;
    END IF;
    PERFORM public.refresh_receipt_inspection_status(p_new->>'receiptId');
  END IF;
END;
$function$;
```
4. Edit `attachments.ts`:
   - `inspection: { after: ["sync_receipt_inspection_status"], statement: ["broadcast_table_changes"] },`
   - `itemLedger: { before: ["check_inspection_hold"], statement: [ ...unchanged ] },`
   - `stockTransfer: { after: ["sync_advance_document_sequence", "sync_receipt_inspection_status"], events: true, statement: [...unchanged] },`
5. Run `pnpm db:migrate`.
6. Run `pnpm --filter @carbon/database authz migration inspection-hold-handlers`.
7. If the generated migration fails locally with "must be owner", run `ALTER FUNCTION public.<name>(text,text,jsonb,jsonb) OWNER TO postgres;` as `supabase_admin`, then `pnpm db:migrate` again (lesson 4248). Do not edit the generated file.

**Verify:**
```bash
pnpm --filter @carbon/database authz check
# Expected: exit 0 (no drift)
```

**Out of scope:** any other table's attachments.

---

## Task 4: Regenerate types and apply

**Depends on:** Tasks 1–3
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/kysely.ts` (or whatever `generate:types` writes)

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -n "inspectionStorageUnitId\|receiptInspectionStatus\|requiresInspection: boolean\|acceptedQuantity" packages/database/src/types.ts | head
# Expected: hits for location, receipt enum, receiptLine and inspection
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: success
```

**Out of scope:** hand edits of generated files.

---

## Task 5: SQL test for the guard and the roll-up

**Depends on:** Task 4
**Files:**
- Create: `packages/database/supabase/tests/inspection-hold.test.sql`
- Copy from (precedent): `packages/database/supabase/tests/non-nettable-storage.test.sql`

**Steps:**
1. Copy the precedent's shape: `BEGIN`, `pg_temp.expect`, a `DO $proof$` block, `ROLLBACK`.
2. Turn off `app.sync_in_progress` with `PERFORM set_config('app.sync_in_progress', 'false', true);`.
3. Seed: one untracked item, one storage unit, a `Positive Adjmt.` ledger row of 120, and a `Pending` `inspection` row (`sourceDocument 'Receipt'`, `lotSize 100`, `storageUnitId` = the unit, a real receipt id).
4. Prove these cases, each in its own `BEGIN … EXCEPTION` sub-block:
   1. A `-30` row at the unit raises "held for inspection".
   2. A `-20` row at the unit succeeds.
   3. With `set_config('app.inspection_release','on',true)`, a `-50` row succeeds.
   4. An `On Hold` tracked entity's negative row raises.
   5. Setting the lot to `Passed` makes `-50` succeed.
   6. A `Partial` lot with `acceptedQuantity 92` holds 8.
   7. The receipt's `inspectionStatus` follows each lot change: `Pending Inspection` → `Inspection Passed`.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/inspection-hold.test.sql
# Expected: exit 0, every expect line passes, ROLLBACK at the end
```

**Out of scope:** service-path tests (Task 18).

---

## Task 6: Status constants, colors and badges

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/quality/quality.models.ts:430-436` — add `"Cancelled"` to `inspectionStatusType`
- Modify: `packages/database/src/quality.ts:126` — add `"Cancelled"` to `INSPECTION_CLOSED_STATUSES`
- Modify: `packages/utils/src/status-colors.ts` — `INSPECTION_STATUS_COLOR_MAP` gains `Cancelled: "gray"`; add `RECEIPT_INSPECTION_STATUS_COLOR_MAP` and register it next to `RECEIPT_STATUS_COLOR_MAP`
- Modify: `apps/erp/app/modules/quality/ui/Inspections/InspectionStatus.tsx` — `Cancelled` maps to `"secondary"`
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts:110-115` — add `receiptInspectionStatusType`
- Create: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptInspectionStatus.tsx`
- Modify: `packages/database/supabase/migrations` — none
- Modify: `packages/database/src/datasets/validate.ts:368-373` — mark `Cancelled: NOT_AUTHORABLE` with a reason comment
- Modify: `packages/database/supabase/migrations/…` — none; `prevent_deleting_gauge_recorded_on_closed_inspection` is left as is (a cancelled lot has no gauge readings)
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/Receipts/ReceiptStatus.tsx`

**Steps:**
1. Add the colors:
```ts
export const RECEIPT_INSPECTION_STATUS_COLOR_MAP = {
  "Not Required": "gray",
  "Pending Inspection": "orange",
  "Inspection In Progress": "blue",
  "Inspection Passed": "green",
  "Inspection Failed": "red",
  "Partially Passed": "yellow",
  "Put Away": "green"
} as const;
```
2. Add `export const receiptInspectionStatusType = ["Not Required", "Pending Inspection", "Inspection In Progress", "Inspection Passed", "Inspection Failed", "Partially Passed", "Put Away"] as const;`.
3. Write `ReceiptInspectionStatus.tsx` as a `switch` copy of `ReceiptStatus.tsx`, one `<Trans>` per value. Return `null` for `"Not Required"` unless a `showNotRequired` prop is true.
4. Search for literal closed-status checks and add `Cancelled` where a closed lot is meant: `apps/erp/app/modules/quality/ui/Inspections/InspectionView.tsx:389,510-512`, `apps/mes/app/components/Inspection/InspectionView.tsx:381-383,597-601`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/database
# Expected: success
```

**Out of scope:** the receipts table (Task 16).

---

## Task 7: Location settings operation and card

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — add `setLocationGoodsInStorage` next to `setLocationResponsibleEmployee` (:1445)
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — `updateQualitySettings` (:544) gains `locationGoodsInStorage`
- Create: `apps/erp/app/modules/settings/ui/Quality/GoodsInStorageCard.tsx`
- Modify: `apps/erp/app/routes/x+/settings+/quality.tsx` — loader reads locations and units; action adds intent `setLocationGoodsInStorage`
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Planning/ResponsibleEmployeeCard.tsx`, `apps/erp/app/routes/x+/settings+/planning.tsx:57-61,130-141`, `settings.server.ts:888-913`

**Steps:**
1. In `updateQualitySettings`, add to the input:
```ts
locationGoodsInStorage: z.object({
  locationId: z.string().min(1),
  inspectionStorageUnitId: z.string().nullable(),
  rejectedStorageUnitId: z.string().nullable()
}).optional()
```
2. Split it from `input` before `saveCompanySettings`, the way `updatePlanningSettings` splits `locationResponsibleEmployee`.
3. Before the write, read each chosen unit with `ctx.asCaller.supabase.from("storageUnit").select("id, locationId, effectiveNettable")`.
4. If a unit's `locationId` differs, return `ctx.error("rule", "Choose a storage unit at this location.")`.
5. If a unit's `effectiveNettable` is true, return `ctx.error("rule", "Choose a non-nettable storage unit.")`.
6. Write with `setLocationGoodsInStorage(ctx.asCaller.supabase, { companyId, locationId, inspectionStorageUnitId, rejectedStorageUnitId, userId })`. Copy the zero-rows `forbidden` check from `settings.server.ts:906-912`.
7. Return `{ locationGoodsInStorage: … }` so the card can pick its toast.
8. In `quality.tsx` loader, read `location` (`id, name, inspectionStorageUnitId, rejectedStorageUnitId`) and `storageUnit` (`id, name, locationId`) where `effectiveNettable = false` and `active = true`, both for the company. Log a failed read like `planning.tsx:83-95`.
9. Add the intent:
```ts
z.object({
  intent: z.literal("setLocationGoodsInStorage"),
  locationId: z.string().min(1),
  inspectionStorageUnitId: z.string().optional().transform((v) => v || null),
  rejectedStorageUnitId: z.string().optional().transform((v) => v || null)
}).transform(({ locationId, inspectionStorageUnitId, rejectedStorageUnitId }) => ({
  locationGoodsInStorage: { locationId, inspectionStorageUnitId, rejectedStorageUnitId }
}))
```
10. Write `GoodsInStorageCard` from `ResponsibleEmployeeCard`. Use one row per location: icon `LuMapPin`, the location name, then two 240 px `Combobox` controls (Inspection, Rejected), options = that location's non-nettable units. Placeholder: `` t`Not set` ``. Title `<Trans>Goods-in storage</Trans>`. Description `<Trans>Received parts that need inspection go to the inspection storage unit. Rejected stock moves to the rejected storage unit. Both must be non-nettable.</Trans>`.
11. Render the card in the Inspections section of `quality.tsx`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** company-level defaults; MES.

---

## Task 8: Receipt line defaults and flag

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — Purchase Order case (:12005-12117) and Sales Return Order case (:12433-12503)

**Steps:**
1. In the Purchase Order case, after the `item` read, read assignments: `many(db, "itemInspectionDocumentAssignment", { companyId, usage: "Receipt", itemId: itemIds }, { columns: ["itemId"] })`. Build `inspectedItemIds: Set<string>`.
2. Read the header location's `inspectionStorageUnitId` with `maybeSingle(db, "location", { id: locationId, companyId }, { columns: ["inspectionStorageUnitId"] })`.
3. If the PO is outside processing for a line, treat the line as not inspected. Use the same outside-processing test the posting uses. If you cannot find it in this function, STOP and report.
4. In the `acc.push({...})`, set:
```ts
requiresInspection: inspectedItemIds.has(d.itemId!),
storageUnitId:
  (inspectedItemIds.has(d.itemId!) ? inspectionStorageUnitId : null) ??
  d.storageUnitId ??
  defaultStorageUnitByItemLocation.get(pickMethodKey(d.itemId!, d.locationId ?? null)) ??
  null,
```
5. In the Sales Return Order case, read the same location column and set `storageUnitId: inspectionStorageUnitId ?? defaultStorageUnitByItem.get(d.itemId) ?? null`. Leave `requiresInspection` false.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** Inbound Transfer and Rental Agreement receipts.

---

## Task 9: Post checks and lot storage unit

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts:348-460` — the refusals before `Pending`
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts:12818-12845` — stamp `storageUnitId` on each lot

**Steps:**
1. In the `postReceipt` operation, add `requiresInspection` to the line select at :363-370.
2. After the rules block and before `Pending`, collect the lines with `requiresInspection && receivedQuantity > 0`.
3. If there are any, read the location's `inspectionStorageUnitId` and `name`.
4. If it is null, return `ctx.error("rule", \`${locationName} has no inspection storage unit. Set one in Settings → Quality.\`)`.
5. Read `storageUnit.effectiveNettable` for the lines' units in one `.in()` call.
6. If a line has no unit or a nettable unit, read its item's readable id, then return `ctx.error("rule", \`${readableId} needs inspection. Choose a non-nettable storage unit.\`)`.
7. In the posting's lot push, add `storageUnitId: receiptLine.storageUnitId ?? null`.
8. Make sure the lot loop's `receiptLine` select includes `storageUnitId`. If it does not, add it.
9. Make the lot loop skip outside-processing lines (`isOutsideProcessing`), matching the ledger loop at :13220.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** the void (Task 10).

---

## Task 10: Receipt void cancels open lots

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — Purchase Order void transaction (:12385-12615)

**Steps:**
1. At the start of the void transaction, call `await setInspectionRelease(trx);` (Task 11).
2. Before the `receipt` status update at :12605, add:
```ts
await trx
  .updateTable("inspection")
  .set({ status: "Cancelled", updatedBy: userId, updatedAt: today })
  .where("companyId", "=", companyId)
  .where("sourceDocument", "=", "Receipt")
  .where("sourceDocumentId", "=", receiptId)
  .where("status", "in", ["Pending", "In Progress"])
  .execute();
```
3. Keep `assertNoRejectedUntrackedLot` and the existing checks as they are.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** the Sales Return Order void.

---

## Task 11: Release GUC helper and unpick fix

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/src/quality.ts` — export `setInspectionRelease`
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — unpick (:9651-9663, :9896-9904, :9968-9981), batch split child status (:9406), return shipments (:17576, :18014, :19486, :19809)

**Steps:**
1. Add to `packages/database/src/quality.ts`:
```ts
/** Lets this transaction move stock the inspection hold guards (spec 2026-11-03). */
export async function setInspectionRelease(trx: Kysely<KyselyDatabase>) {
  await sql`SELECT set_config('app.inspection_release', 'on', true)`.execute(trx);
}
```
2. Import `sql` from `kysely` if the file does not have it.
3. In `unpickSerial` (:9651-9663), remove `status: "Available",` from the `.set()`.
4. In the direct `unpickBatch` branch (:9968-9981), remove `status: "Available",`.
5. In the legacy `unpickBatch` branch (:9896-9904), set `status: originalEntity.status` (the remainder read at :9861-9866). If that variable has no `status`, add it to its select.
6. In the batch pick split (:9406), pass the parent's status as `childStatus`. If the parent row has no `status` in its select, add it.
7. In the four return-shipment transactions, call `await setInspectionRelease(trx);` as the first statement.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database
# Expected: success
```

**Out of scope:** pick refusals (the guard handles them).

---

## Task 12: Disposition engine — Partial quantity, rejected move, write-off unit

**Depends on:** Task 11
**Files:**
- Modify: `packages/database/src/quality.ts` — `InspectionDispositionInput` (:56-79), `dispositionInspection` (:417-709)
- Modify: `apps/erp/app/modules/quality/quality.service.ts` — `postNonConformanceInput` (:5619-5639), `bookAdjustment` call (:5878-5893), wrapper (:4527)
- Modify: `apps/erp/app/modules/quality/quality.server.ts` — `rejectInspection` (:1361-1364)

**Steps:**
1. Add `acceptedQuantity?: number` to `InspectionDispositionInput`.
2. In the transaction, call `await setInspectionRelease(trx);` first.
3. Extend the `receiptLine` read to columns `locationId, storageUnitId`. Read the lot's `storageUnitId` too.
4. Read `location.rejectedStorageUnitId` for `receiptLine.locationId`.
5. For Partial on an untracked lot: require `acceptedQuantity` with `0 <= acceptedQuantity < lotSize`. Throw "Enter the accepted quantity" when missing. Store it on the lot update.
6. Build the rejected move. It runs only when a rejected unit is set and differs from the lot's unit:
   - Reject, tracked: every lot entity that is now `Rejected` and has stock at the lot's unit.
   - Partial, tracked: the entities that failed a sample.
   - Partial, untracked: quantity `lotSize - acceptedQuantity`.
   - Reject, untracked: no move (the write-off runs instead).
7. Write the move as two `itemLedger` rows per entity or quantity, inside `trx`: `entryType "Transfer"`, `documentType "Direct Transfer"`, `documentId` = the lot id, one negative row at the lot's unit and one positive row at the rejected unit. Copy the row shape from the stock transfer post (`inventory.service.ts:9139-9286`).
8. If the rejected move ran, set `inspection.storageUnitId` to the rejected unit in the lot update.
9. Add `storageUnitId: inspection.storageUnitId ?? receiptLine?.storageUnitId ?? null` to the `writeOff` descriptor.
10. In `postNonConformanceInput`, add `storageUnitId: z.string().nullish()` to each movement.
11. In `bookAdjustment`, use `storageUnitId: movement.storageUnitId ?? null`.
12. In `postNonconformance`, call `await setInspectionRelease(trx);` as the first statement of its transaction.
13. In `rejectInspection`, pass `storageUnitId: writeOff.storageUnitId` in the movement.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database
# Expected: success
pnpm --filter @carbon/database test
# Expected: existing quality tests pass
```

**Out of scope:** the MES disposition route (it passes `requireSource: "Job Operation"` and never reaches the receipt branches).

---

## Task 13: Partial Lot operation, route and modal

**Depends on:** Task 12
**Files:**
- Modify: `apps/erp/app/modules/quality/quality.server.ts` — add `partialInspection`; extract the NCR creation of `rejectInspection` (:1379-1588) into a building block both use
- Modify: `apps/erp/app/routes/x+/inspection+/$id.partial.tsx` — new route shape
- Create: `apps/erp/app/modules/quality/ui/Inspections/PartialLotModal.tsx`
- Modify: `apps/erp/app/modules/quality/ui/Inspections/InspectionView.tsx:624-640,839-873` — Partial Lot button and modal
- Copy from (precedent): `apps/erp/app/modules/quality/ui/Inspections/RejectLotModal.tsx`, `apps/erp/app/routes/x+/inspection+/$id.reject.tsx`

**Steps:**
1. Move the NCR creation in `rejectInspection` into `createInspectionNcr(ctx, { inspectionId, nonConformanceTypeId, reason, quantity })` in `quality.service.ts`. Keep `rejectInspection`'s behavior identical.
2. Add `partialInspection = defineServiceFn({ input: { id, acceptedQuantity?: number, nonConformanceTypeId?, reason? }, permission: { update: "quality" }, run })`.
3. In `run`, call `engine.dispositionInspection(ctx.asSystem.pg, { id, decision: "Partial", acceptedQuantity, reason, companyId, dispositionedBy, requireSource: "Receipt" })`.
4. If the lot is untracked and `acceptedQuantity < lotSize`, create the NCR with `quantity = lotSize - acceptedQuantity`. This NCR is required: refuse with "Choose a non-conformance type" when `nonConformanceTypeId` is missing.
5. Rewrite `$id.partial.tsx` from `$id.reject.tsx`: a local zod validator (`acceptedQuantity: zfd.numeric(z.number().min(0).optional())`, `nonConformanceTypeId`, `reason`), then `api.quality.partialInspection`, then redirect to the issue or the inspection.
6. Write `PartialLotModal` from `RejectLotModal`. Add a `Number` field "Accepted quantity" shown only for an untracked lot. Make the NCR type required for an untracked lot.
7. Add a "Partial" button between Reject Lot and Accept Lot in `InspectionView.tsx`, inside the same `isReceiptSource` block.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** MES `DispositionModal`.

---

## Task 14: Inventory count warning

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `postInventoryCount` (:8187, transaction at :8479)
- Modify: the inventory count post operation and route that call it (find with `grep -rn "postInventoryCount" apps/erp/app --include=*.ts*`)

**Steps:**
1. Call `await setInspectionRelease(trx);` first in the count's transaction.
2. Before the transaction, find held stock the count moves out of its unit:
   - tracked: counted entities whose status is `On Hold` and whose counted unit differs from their ledger unit;
   - untracked: count lines at a unit where `inspection_held_quantity` > 0 and the counted quantity is below it.
3. Return those as `warnings: string[]`, each "{part} is held for inspection and was found outside {unit}."
4. In the route, show each warning as a `toast.warning` (or the route's flash `warning`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** refusing counts.

---

## Task 15: Put Away operation and button

**Depends on:** Tasks 6, 9
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `insertStockTransfer` (:6205) takes `status`, `receiptId`, line `receiptLineId`; add `getReceiptPutAwayLines`
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` — add `createReceiptPutAway`
- Create: `apps/erp/app/routes/x+/receipt+/$receiptId.put-away.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `receiptPutAway(id)`
- Copy from (precedent): `createStockTransfer` (`inventory.server.ts:2286-2341`), `apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx`

**Steps:**
1. Extend `insertStockTransfer`'s input with `status?: "Draft" | "Released"` (default `"Released"`) and `receiptId?: string`, and each line with `receiptLineId?: string`. Pass them to the inserts.
2. Write `getReceiptPutAwayLines(db, companyId, receiptId)`. It returns one entry per receipt line:
   - Lots on the receipt with status `Passed` or `Partial`.
   - Passed quantity: `lotSize` for `Passed`, `acceptedQuantity` for an untracked `Partial`.
   - For tracked lots: the lot's entities (`attributes ->> 'Receipt Line'` = the line id) with status `Available`, each as one line of quantity 1 for serial or its quantity for batch.
   - Minus the quantity on linked `stockTransferLine` rows of transfers that are not deleted.
   - From: the lot's `storageUnitId`. To: `getNettableDefaultStorageUnitId` for the item and location, else null.
3. Add `createReceiptPutAway = defineServiceFn({ input: { receiptId }, permission: { create: "inventory" }, run })`.
4. If there is nothing to put away, return `ctx.error("rule", "Nothing is ready for putaway on this receipt.")`.
5. Else call `insertStockTransfer` with `status: "Draft"`, the receipt's location, `receiptId` and the lines. Return `{ id, stockTransferId }`.
6. Write the route: `assertIsPost`, `carbon(request)`, call the op, redirect to `path.to.stockTransfer(id)` with a success flash.
7. The receipt loader (`apps/erp/app/routes/x+/receipt+/$receiptId.tsx`) returns `putAwayReadyCount` (lines from `getReceiptPutAwayLines`) and `putAwayTransfers` (`stockTransfer` rows with this `receiptId`: `id, stockTransferId, status`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** auto-creating transfers on Accept.

---

## Task 16: Receipt UI — badges, column, filter, sidebar

**Depends on:** Tasks 6, 15
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptHeader.tsx` (:38-44, :101, :189)
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx` (:288-300, :785-787, :881-897)
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptsTable.tsx` (:181-200)
- Modify: `apps/erp/app/modules/inventory/ui/useInventorySubmodules.tsx` (:66-90)
- Copy from (precedent): the same files' existing Status badge, Post button and Receipts nav entry

**Steps:**
1. Header: render `<ReceiptInspectionStatus status={receipt.inspectionStatus} />` next to `<ReceiptStatus />` at :101.
2. Header: before posting, show a `<Badge variant="secondary"><Trans>Inspection required</Trans></Badge>` when any line has `requiresInspection`.
3. Header: when `putAwayReadyCount > 0`, show a "Put Away" button (icon `LuPackageCheck` or `LuArrowRightLeft`) that posts to `path.to.receiptPutAway(id)` with a `fetcher.Form`.
4. Header: list `putAwayTransfers` as links in the header's secondary actions or a small "Putaway" link group.
5. Lines: drive `requiresInspection` from `line.requiresInspection` first, then the existing fallbacks. Add a `<Badge>` with `<Trans>Inspection required</Trans>` beside `ReceiptLineInspectionMark`.
6. Lines: for an inspected line, filter the `StorageUnit` picker's choice. If the chosen unit is nettable, show `<Trans>Choose a non-nettable storage unit for inspected parts.</Trans>` under the picker. Read nettable flags from the loader (add `nonNettableStorageUnitIds` for the receipt's location).
7. Table: add a column after Status:
```tsx
{
  accessorKey: "inspectionStatus",
  header: t`Inspection`,
  cell: (item) => <ReceiptInspectionStatus status={item.getValue()} />,
  meta: {
    filter: { type: "static", options: receiptInspectionStatusType.map((s) => ({ value: s, label: <ReceiptInspectionStatus status={s} showNotRequired /> })) },
    pluralHeader: t`Inspection Statuses`,
    icon: <LuClipboardCheck />
  }
},
```
8. Sidebar: after Receipts, add three entries with `to: \`${path.to.receipts}?filter=inspectionStatus:in:Pending Inspection,Inspection In Progress\``, `…:in:Inspection Passed,Partially Passed` and `…:eq:Inspection Failed`. Names: `` t`Pending inspection` ``, `` t`Ready for putaway` ``, `` t`Inspection failed` ``. Check the filter syntax in `apps/erp/app/components/Table` (`in` operator) before you write it. If `in` is not supported, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
pnpm run lint
# Expected: no new Biome errors
```

**Out of scope:** MES.

---

## Task 17: Demo datasets

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/src/datasets/data/{defense,motor,precision,robotics,satellite}/foundation.ts` — add a QC shelf
- Modify: `packages/database/src/datasets/types.ts` — `FoundationData` gains `inspectionShelf` and `rejectedShelf` names
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` — set the Plant's two columns after shelves exist
- Modify: `packages/database/src/datasets/validate.ts` — both names must be shelves whose storage type is non-nettable

**Steps:**
1. In each dataset's `shelves`, add `{ name: "QC-Inspection", warehouse: "<the dataset's QC warehouse key>", storageType: "Quarantine" }`.
2. Add `inspectionShelf: "QC-Inspection"` and `rejectedShelf: "MRB-Hold"` to each `foundation`.
3. In tier 01, after the shelves loop, run:
```ts
await ctx.client.query(
  `UPDATE "location" SET "inspectionStorageUnitId" = $1, "rejectedStorageUnitId" = $2 WHERE id = $3 AND "companyId" = $4`,
  [need(ctx.refs.shelves, data.inspectionShelf), need(ctx.refs.shelves, data.rejectedShelf), plantId, ctx.companyId]
);
```
4. In tier 07 `receiptLot`, set the lot's `storageUnitId` from its receipt line.
5. Raise `storageUnit` in `coverage.ts` only if the check asks for it. Do not lower any floor.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all five datasets pass
```

**Out of scope:** moving seeded receipts into the QC shelf.

---

## Task 18: Database tests for service paths

**Depends on:** Tasks 9–15
**Files:**
- Create: `apps/erp/test/database/inspection-hold.test.ts`
- Copy from (precedent): `apps/erp/test/database/non-nettable-fullest-bin.test.ts`

**Steps:**
1. Use `alwaysPostFixture()` and `seed()`.
2. In each case that must reach the guard, run `set_config('app.sync_in_progress','false',true)` inside the case's transaction.
3. Cover these cases:
   1. A stock transfer `inventory` pick of held untracked stock fails with "held for inspection".
   2. The same pick of free stock in the same unit succeeds.
   3. Unpicking a held serial keeps `On Hold`.
   4. `getReceiptPutAwayLines` returns the passed quantity and excludes `Rejected` units.
   5. `refresh_receipt_inspection_status` gives `Put Away` after a completed linked transfer.

**Verify:**
```bash
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:63240/postgres pnpm --filter erp exec vitest run test/database/inspection-hold.test.ts
# Expected: all tests pass (not skipped)
```

**Out of scope:** browser flows.

---

## Task 19: Rules, AGENTS.md and docs

**Depends on:** Tasks 1–17
**Files:**
- Modify: `.claude/rules/inspection-system.md` — receipt flow, hold, Partial, Cancelled; remove stale `receiptLineId`/`receiptId` claims
- Modify: `.claude/rules/inventory-system.md` — the hold guard and `app.inspection_release`
- Modify: `apps/erp/app/modules/inventory/AGENTS.md`, `apps/erp/app/modules/quality/AGENTS.md`, `apps/erp/app/modules/settings/AGENTS.md`
- Modify: `docs/content/docs/reference/receipts.mdx` (and the inspections reference page if one exists)
- Modify: `.ai/specs/2026-11-03-goods-in-inspection-hold.md` — changelog and any divergence

**Steps:**
1. Describe only committed behavior.
2. Use the `carbon-docs` skill for the docs page.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: success
```

**Out of scope:** the changelog entry.

---

## Task 20: Gates and browser verification

**Depends on:** all
**Steps:**
1. Run `pnpm --filter @carbon/checks license-headers`.
2. Run `pnpm run lint`.
3. Run `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/database --filter=@carbon/utils`.
4. Run `pnpm --filter @carbon/database test` and `pnpm --filter erp test`.
5. Run `pnpm --filter @carbon/checks clobbers`.
6. Run `pnpm db:check:datasets` and `pnpm db:check:backups`.
7. Run `/translate` if Lingui catalogs show new empty strings.
8. With the user's permission, run `/test` on: settings card, inspected receipt default and refusals, the receipts list filter, Partial, Put Away.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** pushing or opening a PR (ask first).

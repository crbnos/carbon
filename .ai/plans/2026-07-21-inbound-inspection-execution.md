# Inbound Inspection Execution — implementation plan

**Spec:** .ai/specs/implemented/2026-07-21-inbound-inspection-execution.md
**Research:** .ai/research/inbound-inspection-execution.md
**Branch:** feat/mes-assembly

## Progress
- [x] Task 1: Create the migration (enum, tables, columns, RPC fork)
- [x] Task 2: Apply migration + regenerate types
- [x] Task 3: Per-feature sampling resolution in both engine copies + unit test
- [x] Task 4: Zod validators + row/type extensions
- [x] Task 5: post-receipt — attach document + per-feature plan rows
- [x] Task 6: quality.service reads + assignment upsert
- [x] Task 7: quality.server — measurement upsert, derived status, reconcile, disposition gating
- [x] Task 8: Route tree x+/inbound-inspection+ + path.ts
- [x] Task 9: InspectionDrawingPane (read-only PDF + balloons)
- [x] Task 10: InspectionMeasurementGrid (features × samples)
- [x] Task 11: InboundInspectionView wiring + fallback + drawer retirement
- [x] Task 12: Item Quality tab — documents card + assignments card (4 routes)
- [x] Task 13: Reject NCR enrichment (failed-feature table)
- [x] Task 14: Docs sync (rule + AGENTS.md)
- [ ] Task 15: Browser verification (/test)

## Dependencies
- Task 2 needs Task 1. Task 3 is independent (can run parallel with 1–2).
- Task 4 needs Task 2 (generated types). Task 5 needs Tasks 2 + 3.
- Tasks 6, 7 need Tasks 2 + 4 (7 also uses 3's helper via app copy import in tests only — runtime valuation is local math).
- Task 8 needs 6 + 7. Task 9 needs nothing DB-side (props only). Task 10 needs 4 + 6 types.
- Task 11 needs 8 + 9 + 10. Task 12 needs 4 + 6. Task 13 needs 7.
- Tasks 14, 15 last. Tasks 9 and 12 are independent of each other and of 5–8; parallelizable.

---

## Task 1: Create the migration (enum, tables, columns, RPC fork)

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_inbound-inspection-execution.sql` (via `pnpm db:migrate:new inbound-inspection-execution` — never hand-pick the timestamp; the generated HHMMSS must not be `000000`)
- Copy from (precedent): `packages/database/supabase/migrations/20260419163058_inbound-inspection-sampling.sql` (table + RLS style for the inbound family), `packages/database/supabase/migrations/20260526142837_inspection-feature-type.sql` (newest `save_inspection_document_atomic` definition to fork)

**Steps:**
1. Run `pnpm db:migrate:new inbound-inspection-execution`. Confirm the generated filename's HHMMSS portion is not `000000`; if it is, rename the file changing only HHMMSS to a random value.
2. Write the SQL below into the file. Notes on conventions used: the inbound-inspection family uses **PK ("id")** (not composite) and RLS SELECT tightened to `quality_view` — follow it exactly. NUMERIC columns carry **no precision**. `inspectionDocument`/`inspectionFeature` have `UNIQUE("id")` constraints, so single-column FKs to them are valid.

```sql
-- Inbound inspection execution: document assignment, per-feature sampling,
-- per-lot feature plans, per-sample measurements.

-- 1) Usage enum (extensible: 'FAI', 'Production' later)
DO $$ BEGIN
  CREATE TYPE "inspectionDocumentUsage" AS ENUM ('Receipt');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Item-level document assignment per usage slot
CREATE TABLE IF NOT EXISTS "itemInspectionDocumentAssignment" (
  "itemId" TEXT NOT NULL,
  "usage" "inspectionDocumentUsage" NOT NULL,
  "inspectionDocumentId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "itemInspectionDocumentAssignment_pkey" PRIMARY KEY ("itemId", "usage"),
  CONSTRAINT "itemInspectionDocumentAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "itemInspectionDocumentAssignment_inspectionDocumentId_fkey" FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE CASCADE,
  CONSTRAINT "itemInspectionDocumentAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "itemInspectionDocumentAssignment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemInspectionDocumentAssignment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX IF NOT EXISTS "itemInspectionDocumentAssignment_companyId_idx" ON "itemInspectionDocumentAssignment" ("companyId");
CREATE INDEX IF NOT EXISTS "itemInspectionDocumentAssignment_inspectionDocumentId_idx" ON "itemInspectionDocumentAssignment" ("inspectionDocumentId");

ALTER TABLE "itemInspectionDocumentAssignment" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "SELECT" ON "itemInspectionDocumentAssignment"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_view'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "INSERT" ON "itemInspectionDocumentAssignment"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_create'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "UPDATE" ON "itemInspectionDocumentAssignment"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_update'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "DELETE" ON "itemInspectionDocumentAssignment"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Per-feature sampling rule (nullable = inherit itemSamplingPlan)
ALTER TABLE "inspectionFeature"
  ADD COLUMN IF NOT EXISTS "samplingPlanType" "samplingPlanType",
  ADD COLUMN IF NOT EXISTS "samplingSampleSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "samplingPercentage" NUMERIC,
  ADD COLUMN IF NOT EXISTS "samplingAql" NUMERIC,
  ADD COLUMN IF NOT EXISTS "samplingInspectionLevel" "inspectionLevel",
  ADD COLUMN IF NOT EXISTS "samplingSeverity" "inspectionSeverity";

-- 4) Lot → document live reference
ALTER TABLE "inboundInspection"
  ADD COLUMN IF NOT EXISTS "inspectionDocumentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "inboundInspection"
    ADD CONSTRAINT "inboundInspection_inspectionDocumentId_fkey"
    FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "inboundInspection_inspectionDocumentId_idx" ON "inboundInspection" ("inspectionDocumentId");

-- 5) Per-lot per-feature resolved sampling plan
CREATE TABLE IF NOT EXISTS "inboundInspectionFeature" (
  "id" TEXT NOT NULL DEFAULT id('iif'),
  "inboundInspectionId" TEXT NOT NULL,
  "inspectionFeatureId" TEXT NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "acceptanceNumber" INTEGER NOT NULL,
  "rejectionNumber" INTEGER NOT NULL,
  "codeLetter" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "inboundInspectionFeature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inboundInspectionFeature_unique" UNIQUE ("inboundInspectionId", "inspectionFeatureId"),
  CONSTRAINT "inboundInspectionFeature_inboundInspectionId_fkey" FOREIGN KEY ("inboundInspectionId") REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionFeature_inspectionFeatureId_fkey" FOREIGN KEY ("inspectionFeatureId") REFERENCES "inspectionFeature"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionFeature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionFeature_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id")
);

CREATE INDEX IF NOT EXISTS "inboundInspectionFeature_companyId_idx" ON "inboundInspectionFeature" ("companyId");
CREATE INDEX IF NOT EXISTS "inboundInspectionFeature_inboundInspectionId_idx" ON "inboundInspectionFeature" ("inboundInspectionId");
CREATE INDEX IF NOT EXISTS "inboundInspectionFeature_inspectionFeatureId_idx" ON "inboundInspectionFeature" ("inspectionFeatureId");

ALTER TABLE "inboundInspectionFeature" ENABLE ROW LEVEL SECURITY;

-- RLS: same four policies as itemInspectionDocumentAssignment above, with
-- quality_view / quality_create / quality_update / quality_delete. Copy the
-- four DO-blocks, changing only the table name.

-- 6) Per sample × feature measurement
CREATE TABLE IF NOT EXISTS "inboundInspectionMeasurement" (
  "id" TEXT NOT NULL DEFAULT id('iim'),
  "inboundInspectionId" TEXT NOT NULL,
  "inboundInspectionSampleId" TEXT NOT NULL,
  "inspectionFeatureId" TEXT NOT NULL,
  "value" NUMERIC,
  "status" "inboundInspectionSampleStatus" NOT NULL DEFAULT 'Pending',
  "notes" TEXT,
  "inspectedBy" TEXT,
  "inspectedAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "inboundInspectionMeasurement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inboundInspectionMeasurement_unique" UNIQUE ("inboundInspectionSampleId", "inspectionFeatureId"),
  CONSTRAINT "inboundInspectionMeasurement_inboundInspectionId_fkey" FOREIGN KEY ("inboundInspectionId") REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionMeasurement_sampleId_fkey" FOREIGN KEY ("inboundInspectionSampleId") REFERENCES "inboundInspectionSample"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionMeasurement_inspectionFeatureId_fkey" FOREIGN KEY ("inspectionFeatureId") REFERENCES "inspectionFeature"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionMeasurement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionMeasurement_inspectedBy_fkey" FOREIGN KEY ("inspectedBy") REFERENCES "user"("id"),
  CONSTRAINT "inboundInspectionMeasurement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "inboundInspectionMeasurement_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_companyId_idx" ON "inboundInspectionMeasurement" ("companyId");
CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_inboundInspectionId_idx" ON "inboundInspectionMeasurement" ("inboundInspectionId");
CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_sampleId_idx" ON "inboundInspectionMeasurement" ("inboundInspectionSampleId");
CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_inspectionFeatureId_idx" ON "inboundInspectionMeasurement" ("inspectionFeatureId");

ALTER TABLE "inboundInspectionMeasurement" ENABLE ROW LEVEL SECURITY;

-- RLS: same four DO-block policies again (quality_view/create/update/delete).
```

3. Write the four RLS DO-blocks for `inboundInspectionFeature` and the four for `inboundInspectionMeasurement` exactly like the `itemInspectionDocumentAssignment` set (only the table name changes).
4. **Fork the RPC.** Extract the newest `save_inspection_document_atomic` body verbatim:
   ```bash
   grep -rln "save_inspection_document_atomic" packages/database/supabase/migrations/ | sort | tail -1
   # Expected: .../20260526142837_inspection-feature-type.sql (verify; if a newer file appears, fork THAT one)
   sed -n '/CREATE OR REPLACE FUNCTION/,$p' packages/database/supabase/migrations/20260526142837_inspection-feature-type.sql > /tmp/rpc-fork.sql
   ```
   Append to the migration: `DROP FUNCTION IF EXISTS save_inspection_document_atomic;` (match the exact signature from the source file if Postgres complains about ambiguity), then the copied `CREATE OR REPLACE FUNCTION` with exactly two edits, preserving everything else byte-for-byte (diff against the source to prove only these changed):
   - In the `inspectionFeature` **create** INSERT: add columns `"samplingPlanType", "samplingSampleSize", "samplingPercentage", "samplingAql", "samplingInspectionLevel", "samplingSeverity"` and the corresponding value expressions reading the JSONB item keys `samplingPlanType` (`::"samplingPlanType"`, `NULLIF(item->>'samplingPlanType','')`), `samplingSampleSize` (`::integer`), `samplingPercentage` (`::numeric`), `samplingAql` (`::numeric`), `samplingInspectionLevel` (`::"inspectionLevel"`), `samplingSeverity` (`::"inspectionSeverity"`) — all NULL when absent.
   - In the **update** branch: add the same six columns to the SET list with the same JSONB extraction, only overwriting when the key is present (follow how the existing optional keys in that function handle presence; if it overwrites unconditionally for other columns, do the same for consistency).
5. If the assumption that `20260526142837` is the newest RPC definition turns out false (grep finds a newer file), fork from the newer file instead; if the function body structure differs materially from what Step 4 describes, STOP and report — do not improvise.

**Verify:**
```bash
ls packages/database/supabase/migrations/ | tail -3
# Expected: the new <timestamp>_inbound-inspection-execution.sql is the newest file, timestamp > 20260721170301
grep -c "CREATE POLICY" packages/database/supabase/migrations/*inbound-inspection-execution.sql
# Expected: 12 (4 policies × 3 new tables)
```

**Out of scope:** seeding data; touching `itemSamplingPlan`; editing any applied migration.

---

## Task 2: Apply migration + regenerate types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`

**Steps:**
1. Run `pnpm db:migrate` (applies pending migrations to the local DB and regenerates types + swagger). If the local DB is unreachable, STOP and report — do not attempt to rebuild the database.

**Verify:**
```bash
grep -c "itemInspectionDocumentAssignment\|inboundInspectionFeature\|inboundInspectionMeasurement" packages/database/src/types.ts
# Expected: a number > 10 (all three tables present in generated types)
grep "inspectionDocumentUsage" packages/database/src/types.ts | head -2
# Expected: the enum with "Receipt"
```

**Out of scope:** hand-editing generated types.

---

## Task 3: Per-feature sampling resolution in both engine copies + unit test

**Depends on:** none (parallel with 1–2)
**Files:**
- Modify: `apps/erp/app/modules/quality/samplingStandards.ts` — add `resolveFeatureSamplingPlan`
- Modify: `packages/database/supabase/functions/shared/sampling-engine.ts` — add the identical function
- Create: `apps/erp/app/modules/quality/samplingStandards.test.ts` (if a test file already exists, extend it)

**Steps:**
1. In `samplingStandards.ts`, below `resolveSamplingPlan` (L881), add and export:
   ```ts
   export type FeatureSamplingRule = {
     samplingPlanType?: SamplingPlanType | null;
     samplingSampleSize?: number | null;
     samplingPercentage?: number | null;
     samplingAql?: number | null;
     samplingInspectionLevel?: InspectionLevel | null;
     samplingSeverity?: InspectionSeverity | null;
   };

   export function resolveFeatureSamplingPlan(
     feature: FeatureSamplingRule | null | undefined,
     itemPlan: SamplingPlanInput | null | undefined,
     lotSize: number,
     standard: SamplingStandard
   ): SamplingResult {
     const plan: SamplingPlanInput = feature?.samplingPlanType
       ? {
           type: feature.samplingPlanType,
           sampleSize: feature.samplingSampleSize ?? undefined,
           percentage: feature.samplingPercentage ?? undefined,
           aql: feature.samplingAql ?? undefined,
           inspectionLevel: feature.samplingInspectionLevel ?? undefined,
           severity: feature.samplingSeverity ?? undefined,
         }
       : itemPlan ?? { type: "All" };
     return resolveSamplingPlan(plan, lotSize, standard);
   }
   ```
2. Add the byte-equivalent function (adjusting only the type-import style to the edge file's inline-union types) to `sampling-engine.ts`, exported. Update the header comment noting both files must stay in sync.
3. Write `samplingStandards.test.ts` (vitest, mirror the import style of `apps/erp/app/modules/production/inspectionDocumentSave.test.ts`) covering: feature rule present (AQL) overrides item plan; feature rule absent falls back to item plan (Percentage); both absent falls back to `All` (sampleSize === lotSize, acceptance 0); First-N clamps to lot size.

**Verify:**
```bash
pnpm --filter=erp test -- samplingStandards
# Expected: new tests pass (4+ passing, 0 failing)
```

**Out of scope:** changing `resolveSamplingPlan` itself or the AQL tables.

---

## Task 4: Zod validators + row/type extensions

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/quality/quality.models.ts` — new validators + const
- Modify: `apps/erp/app/modules/quality/types.ts` — derived types
- Modify: `apps/erp/app/modules/production/inspectionDocumentDb.ts` — extend `InspectionFeatureRow`
- Modify: `apps/erp/app/modules/production/production.models.ts` — extend the feature-save payload validator

**Steps:**
1. `quality.models.ts` — add next to the inbound validators (L487+):
   ```ts
   export const inspectionDocumentUsages = ["Receipt"] as const;

   export const itemInspectionDocumentAssignmentValidator = z.object({
     itemId: z.string().min(1, { message: "Item is required" }),
     usage: z.enum(inspectionDocumentUsages),
     inspectionDocumentId: zfd.text(z.string().optional()), // empty = clear the slot
   });

   export const inboundInspectionMeasurementValidator = z.object({
     inspectionId: z.string().min(1, { message: "Inspection is required" }),
     sampleId: zfd.text(z.string().optional()), // absent = create anonymous sample (non-serial columns)
     inspectionFeatureId: z.string().min(1, { message: "Feature is required" }),
     value: zfd.text(z.string().optional()), // numeric string for Measurement features; empty clears
     passed: zfd.text(z.enum(["true", "false"]).optional()), // attribute features only
     notes: zfd.text(z.string().optional()),
   });
   ```
   Also change `inboundInspectionSampleValidator.status` to `z.enum(["Pending", "Passed", "Failed"])` (adding `"Pending"`) so the identify-only scan flow (Task 11) can create a Pending sample; existing pass/fail submissions keep working.
2. `quality.types.ts` (`apps/erp/app/modules/quality/types.ts`) — add after the existing inbound types:
   ```ts
   export type InboundInspectionFeature = NonNullable<
     Awaited<ReturnType<typeof getInboundInspectionFeatures>>["data"]
   >[number];
   export type InboundInspectionMeasurement = NonNullable<
     Awaited<ReturnType<typeof getInboundInspectionMeasurements>>["data"]
   >[number];
   export type ItemInspectionDocumentAssignment =
     Database["public"]["Tables"]["itemInspectionDocumentAssignment"]["Row"];
   ```
   (Import the two service functions from `../quality.service` in the same style the file already uses. This compiles only after Task 6 adds them — if executing tasks strictly in order, add these two `Awaited<...>` types during Task 6 instead and only the `ItemInspectionDocumentAssignment` row type here.)
3. `inspectionDocumentDb.ts` — add to `InspectionFeatureRow`: `samplingPlanType: Database["public"]["Enums"]["samplingPlanType"] | null; samplingSampleSize: number | null; samplingPercentage: number | null; samplingAql: number | null; samplingInspectionLevel: Database["public"]["Enums"]["inspectionLevel"] | null; samplingSeverity: Database["public"]["Enums"]["inspectionSeverity"] | null;`.
4. `production.models.ts` — find `inspectionSaveFeaturesPayloadValidator`; add the six optional sampling keys to both the `create` and `update` item schemas: `samplingPlanType: z.enum(["All","First","Percentage","AQL"]).nullable().optional()`, `samplingSampleSize: z.number().int().positive().nullable().optional()`, `samplingPercentage: z.number().positive().max(100).nullable().optional()`, `samplingAql: z.number().positive().nullable().optional()`, `samplingInspectionLevel: z.enum(["I","II","III","S1","S2","S3","S4"]).nullable().optional()`, `samplingSeverity: z.enum(["Normal","Tightened","Reduced"]).nullable().optional()`. If the validator uses a shared item schema for create/update, edit it once. If the payload validator strips unknown keys elsewhere before reaching the RPC, STOP and report.
5. Export the new quality validators/const from the module barrel if `index.ts` enumerates exports explicitly (check `apps/erp/app/modules/quality/index.ts`; mirror how `inboundInspectionSampleValidator` is exported).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (note: quality types referencing Task 6 functions may be deferred to Task 6 as described)
```

**Out of scope:** UI components; service functions.

---

## Task 5: post-receipt — attach document + per-feature plan rows

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `packages/database/supabase/functions/post-receipt/index.ts`

**Steps:**
1. In the parallel load block (~L108–142), add two loads for receipt items: `itemInspectionDocumentAssignment` rows (`.from("itemInspectionDocumentAssignment").select("itemId, inspectionDocumentId").eq("companyId", companyId).eq("usage", "Receipt").in("itemId", itemIds)`) and, for the assigned document ids, their features: `.from("inspectionFeature").select("id, inspectionDocumentId, type, samplingPlanType, samplingSampleSize, samplingPercentage, samplingAql, samplingInspectionLevel, samplingSeverity").in("inspectionDocumentId", assignedDocumentIds)`. Build `assignmentByItemId` and `featuresByDocumentId` Maps.
2. Import `resolveFeatureSamplingPlan` from `../shared/sampling-engine.ts`.
3. In the build block (~L663–711): for each line that gets an inspection, look up `assignmentByItemId.get(receiptLine.itemId)`. When present:
   - Set `inspectionDocumentId` on the `inboundInspection` insert payload.
   - For each feature of that document, compute `resolveFeatureSamplingPlan(feature, plan, safeReceivedQuantity, samplingStandard)` (where `plan` is the existing item plan variable, and pass `undefined` instead of the synthesized `{type:"All"}` default object when no `itemSamplingPlan` row existed, so the helper's own fallback applies). Collect pending child rows `{ receiptLineId, inspectionFeatureId, sampleSize, acceptanceNumber: r.acceptance, rejectionNumber: r.rejection, codeLetter: r.codeLetter, companyId, createdBy: userId }` keyed by receiptLineId.
   - Set the lot-level snapshot `sampleSize` to `Math.max(...featureSampleSizes)` (keep `acceptanceNumber`/`rejectionNumber` from the item-plan resolution as today — they remain the fallback-flow numbers).
4. In the transaction insert block (~L1815–1827): change the insert to `.returning(["id", "receiptLineId"])`; then map returned ids by `receiptLineId` and batch-insert the collected `inboundInspectionFeature` rows with `inboundInspectionId` filled in. All audit `createdBy` values are `userId` (non-null — it comes from the validated payload).
5. If `.returning` is unavailable on this Kysely version, STOP and report — do not switch to a post-insert SELECT without flagging it.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-receipt/index.ts 2>&1 | tail -5
# Expected: no errors mentioning post-receipt/index.ts or sampling-engine.ts (pre-existing unrelated
# type noise from lib/types.ts is acceptable if it exists on main — compare with git stash if unsure)
```

**Out of scope:** the `Inbound Transfer` receipt branch (creates no inspections today — leave it); `config.toml` (post-receipt already registered).

---

## Task 6: quality.service reads + assignment upsert

**Depends on:** Tasks 2, 4
**Files:**
- Modify: `apps/erp/app/modules/quality/quality.service.ts` — four functions near L2214–2330
- Modify: `apps/erp/app/modules/quality/types.ts` — the two `Awaited<ReturnType>` types deferred from Task 4

**Steps:**
1. Add (client-first, return raw `{data, error}`, companyId-scoped — copy the style of `getItemSamplingPlan`):
   ```ts
   export async function getInboundInspectionFeatures(
     client: SupabaseClient<Database>, inboundInspectionId: string, companyId: string
   ) {
     return client
       .from("inboundInspectionFeature")
       .select("*, inspectionFeature(id, label, description, pageNumber, type, nominalValue, tolerancePlus, toleranceMinus, unit)")
       .eq("inboundInspectionId", inboundInspectionId)
       .eq("companyId", companyId);
   }
   ```
   Embed by **target table name** (`inspectionFeature(...)`), never `alias:fkColumn(...)` — composite-FK embed lesson. `inspectionFeature`'s FK here is single-column, but use the table-name form regardless.
2. `getInboundInspectionMeasurements(client, inboundInspectionId, companyId)` — `.from("inboundInspectionMeasurement").select("*").eq("inboundInspectionId", ...).eq("companyId", ...)`.
3. `getItemInspectionDocumentAssignments(client, itemId, companyId)` — `.from("itemInspectionDocumentAssignment").select("*").eq("itemId", ...).eq("companyId", ...)`.
4. `upsertItemInspectionDocumentAssignment(client, assignment: z.infer<typeof itemInspectionDocumentAssignmentValidator> & { companyId: string; userId: string })` — when `inspectionDocumentId` is empty/undefined: `.delete().eq("itemId").eq("usage").eq("companyId")`; else read-then-update-or-insert exactly like `upsertItemSamplingPlan` (keyed on itemId + usage + companyId; `createdBy` on insert, `updatedBy`/`updatedAt` on update).
5. Complete the two deferred `Awaited<ReturnType>` types in `types.ts` (Task 4 Step 2).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** Kysely/write orchestration (Task 7); UI.

---

## Task 7: quality.server — measurement upsert, derived status, reconcile, disposition gating

**Depends on:** Tasks 2, 4
**Files:**
- Modify: `apps/erp/app/modules/quality/quality.server.ts`

**Steps:**
1. **Extract the entity side-effect block** (L103–151 of `upsertInboundInspectionSample`: trackedEntity status flip + trackedActivity/input/output inserts) into a local async helper `applySampleEntityStatus(trx, args: { trackedEntityId: string; status: "Passed" | "Failed"; inspectionId: string; receiptId: string; notes: string | null; userId: string; companyId: string })`, and call it from `upsertInboundInspectionSample` unchanged. Also: when the incoming sample status is `"Pending"` (new identify-only flow), skip the entity flip entirely (leave the entity `On Hold`).
2. Add a module-level pure helper (exported for tests):
   ```ts
   export function valuateMeasurement(feature: { type: string; nominalValue: string | null; tolerancePlus: string | null; toleranceMinus: string | null }, value: number | null, passed?: boolean | null): "Pending" | "Passed" | "Failed"
   ```
   Rules: for `type === "Measurement"`, parse `nominal = Number(nominalValue)`, `tolPlus = Math.abs(Number(tolerancePlus ?? 0))`, `tolMinus = Math.abs(Number(toleranceMinus ?? 0))` (strip a leading `+` before `Number()`; `Number.isNaN(nominal)` ⇒ treat the feature as attribute). Numeric path: `value == null` ⇒ `Pending`; in `[nominal - tolMinus, nominal + tolPlus]` ⇒ `Passed`; else `Failed`. Attribute path (non-Measurement type or unparseable nominal): `passed == null` ⇒ `Pending`, `passed` ⇒ `Passed`, else `Failed`.
3. Add `export async function upsertInboundInspectionMeasurement(args: z.infer<typeof inboundInspectionMeasurementValidator> & { companyId: string; userId: string }): Promise<Result<{ sampleId: string; measurementId: string; measurementStatus: string; sampleStatus: string }>>`. One Kysely transaction:
   - Load the inspection (`id, status, receiptId, inspectionDocumentId`); reject when terminal (`Passed`/`Failed`).
   - Load the live feature (`inspectionFeature` by `inspectionFeatureId`: `type, nominalValue, tolerancePlus, toleranceMinus`).
   - Resolve the sample: if `sampleId` present, load it (must belong to the inspection); else insert an anonymous `inboundInspectionSample` (`trackedEntityId: null, status: "Pending", companyId, createdBy: userId`).
   - Compute `status = valuateMeasurement(feature, args.value ? Number(args.value) : null, args.passed ? args.passed === "true" : null)`.
   - Upsert the measurement on `(inboundInspectionSampleId, inspectionFeatureId)`: insert with `createdBy`, or update `value/status/notes/updatedBy/updatedAt`; set `inspectedBy: userId, inspectedAt: nowIso` when status !== "Pending", clear both when an existing value is cleared back to Pending.
   - **Derive the sample status**: load the lot's `inboundInspectionFeature` rows (`inspectionFeatureId, sampleSize`) and this sample's measurements; compute the sample's 1-based column index as its position in the lot's samples ordered by `createdAt, id`. Required features for this sample = those whose `sampleSize >= columnIndex`. Derived: any measurement `Failed` ⇒ `Failed`; else all required features have a `Passed` measurement ⇒ `Passed`; else `Pending`.
   - When the derived status differs from the stored sample status: update it, and if the sample has a `trackedEntityId`, apply entity effects — `Passed` ⇒ flip via `applySampleEntityStatus` with `"Passed"`; `Failed` ⇒ `"Failed"`; back to `Pending` ⇒ set the entity's status back to `"On Hold"` directly (no trackedActivity for the revert; only write activity on Pending→Passed/Failed transitions, not on every cell edit).
   - Recompute the lot's non-terminal status via the existing `computeLotStatus` logic (same as sample path).
4. Add `export async function reconcileInboundInspectionFeatures(serviceRole client-or-db, inboundInspectionId, companyId)`: load the lot (`inspectionDocumentId, lotSize, createdBy`) — no document ⇒ no-op; load the document's current `inspectionFeature` ids + sampling fields, the lot's existing `inboundInspectionFeature` rows, the `itemSamplingPlan` for the lot's item, and `companySettings.samplingStandard`; for features with no row, `resolveFeatureSamplingPlan` + insert (`createdBy: COALESCE(lot.createdBy)` — never null). Leave rows whose live feature is gone.
5. **Disposition gating** in `dispositionInboundInspection`: after loading samples (L253–264), also load the lot's `inboundInspectionFeature` rows and all measurements. When the lot has features (document flow), replace the caller-side gating data by returning richer errors: `Accept` must verify every feature has `recordedCount >= sampleSize` (recordedCount = measurements with status !== 'Pending' for that feature) and `failsForFeature <= acceptanceNumber`, else `errResult("Sampling incomplete or acceptance number exceeded", { featureId })`. `Reject` requires `failsForFeature >= rejectionNumber` for at least one feature OR at least one Failed sample. When the lot has no features, keep today's behavior untouched. Everything downstream (entity flips, history, ledger) stays as-is.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm --filter=erp test -- quality
# Expected: existing quality tests still pass; add valuateMeasurement unit tests in
# apps/erp/app/modules/quality/quality.server.test.ts if no test file exists (numeric in/out of
# tolerance, unparseable nominal -> attribute, attribute passed/failed/null) and expect them green
```

**Out of scope:** routes; NCR enrichment (Task 13); touching `quality-disposition.server.ts`.

---

## Task 8: Route tree x+/inbound-inspection+ + path.ts

**Depends on:** Tasks 6, 7
**Files:**
- Create: `apps/erp/app/routes/x+/inbound-inspection+/_layout.tsx`
- Create: `apps/erp/app/routes/x+/inbound-inspection+/$id.tsx`
- Create: `apps/erp/app/routes/x+/inbound-inspection+/$id.measurement.tsx`
- Create: `apps/erp/app/routes/x+/inbound-inspection+/$id.document.tsx`
- Move (create new + delete old): `$id.sample.tsx`, `$id.accept.tsx`, `$id.partial.tsx`, `$id.reject.tsx` from `x+/quality+/inbound-inspections.$id.*.tsx`
- Modify: `apps/erp/app/routes/x+/quality+/inbound-inspections.$id.tsx` — becomes a redirect stub
- Modify: `apps/erp/app/utils/path.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/assembly+/_layout.tsx` (layout), `apps/erp/app/routes/x+/inspection+/$id.tsx` (full-screen loader + ClientOnly/lazy pattern)

**Steps:**
1. `path.ts` — replace the two inbound entries (L1119–1121) with a full set (keep the same export names so existing imports keep compiling):
   ```ts
   inboundInspection: (id: string) => generatePath(`${x}/inbound-inspection/${id}`),
   inboundInspections: `${x}/quality/inbound-inspections`,
   inboundInspectionMeasurement: (id: string) => generatePath(`${x}/inbound-inspection/${id}/measurement`),
   inboundInspectionSample: (id: string) => generatePath(`${x}/inbound-inspection/${id}/sample`),
   inboundInspectionAccept: (id: string) => generatePath(`${x}/inbound-inspection/${id}/accept`),
   inboundInspectionReject: (id: string) => generatePath(`${x}/inbound-inspection/${id}/reject`),
   inboundInspectionPartial: (id: string) => generatePath(`${x}/inbound-inspection/${id}/partial`),
   inboundInspectionDocument: (id: string) => generatePath(`${x}/inbound-inspection/${id}/document`),
   ```
   Then grep for the old ad-hoc concatenations (`${path.to.inboundInspection(...)}/accept` etc. in `InboundInspectionLotView.tsx`, `ScanInspectionSample.tsx`) — they will be replaced in Task 11; note them, don't fix here.
2. `_layout.tsx`: copy the assembly layout verbatim, minus `requireAssembliesInternal`; permissions `view: "quality"`; `handle: { breadcrumb: msg\`Quality\`, to: path.to.quality, module: "quality" }`; title `Carbon | Inbound Inspection`.
3. `$id.tsx` loader: `requirePermissions(request, { view: "quality", role: "employee" })`. Load in parallel: `getInboundInspection(client, id)`, `getCompanySettings(client, companyId)`, `getIssueTypesList(client, companyId)`. Company-mismatch/error ⇒ `throw redirect(path.to.inboundInspections)` (copy the old drawer route's guards verbatim). Then `await reconcileInboundInspectionFeatures(getCarbonServiceRole(), id, companyId)`, then load `getInboundInspectionFeatures(client, id, companyId)`, `getInboundInspectionMeasurements(client, id, companyId)`, `getInboundInspectionLotTrackedEntities(client, inspection.receiptLineId, companyId)`, and — when `inspection.inspectionDocumentId` — `getInspectionDocument(getCarbonServiceRole(), inspection.inspectionDocumentId)` (service role, same as `x+/inspection+/$id.tsx`; gives `content.pdfUrl`). Return everything the old drawer loader returned plus `features`, `measurements`, `document`. Default export renders `<InboundInspectionView …/>` (Task 11) — until Task 11 lands, a placeholder `<div/>` is acceptable to keep this task's verify green.
4. `$id.measurement.tsx`: action-only, copy the shape of the old `$id.sample.tsx` (assertIsPost, `requirePermissions({ update: "quality", role: "employee" })`, validate `inboundInspectionMeasurementValidator`, guard `inspectionId === params.id`), call `upsertInboundInspectionMeasurement`, return `data(result)` **without** flash on success (per-cell saves must be quiet; return the `{sampleId, measurementStatus, sampleStatus}` payload so the grid can update) and a flash error on failure.
5. Move `$id.sample.tsx`, `$id.accept.tsx`, `$id.partial.tsx`, `$id.reject.tsx` to the new tree unchanged except: redirect targets — accept keeps redirecting to `path.to.inboundInspections` list; partial/reject-no-NCR redirect to `path.to.inboundInspection(id)` (unchanged semantics, new URL).
6. `$id.document.tsx`: action-only, `requirePermissions({ update: "quality" })`. FormData: `inspectionDocumentId` (may be empty). Guards: inspection non-terminal AND zero `inboundInspectionMeasurement` rows for the lot, else flash error "Cannot change document after measurements are recorded". On change: Kysely transaction — update `inboundInspection.inspectionDocumentId` (null when empty), delete the lot's `inboundInspectionFeature` rows; the next loader pass reconciles new rows. Redirect to `path.to.inboundInspection(id)`.
7. Old `x+/quality+/inbound-inspections.$id.tsx`: replace body with a loader-only redirect `throw redirect(generatePath(\`${x}/inbound-inspection/${params.id}\`))` (preserve query string). Delete the old `$id.sample/accept/partial/reject` files.
8. `x+/quality+/inbound-inspections.tsx`: remove `<Outlet />` if the drawer was its only child (check remaining children first; the redirect stub from step 7 still needs the parent to NOT swallow it — since the stub throws a redirect in its loader, keeping `<Outlet />` is harmless; keep it and note it).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -rn "inbound-inspections/" apps/erp/app --include="*.tsx" | grep -v "quality+/inbound-inspections"
# Expected: no stragglers building old-style /x/quality/inbound-inspections/{id} sub-URLs outside the list route
```

**Out of scope:** the view component internals (Tasks 9–11); MES.

---

## Task 9: InspectionDrawingPane (read-only PDF + balloons)

**Depends on:** none (types from Task 2 helpful but not required)
**Files:**
- Create: `apps/erp/app/modules/quality/ui/InboundInspections/InspectionDrawingPane.tsx`
- Copy from (precedent): `apps/erp/app/modules/production/ui/InspectionDocument/InspectionDocumentEditor.tsx` — Document/Page render L2782–2820, Konva overlay + positioning math L2822–2865, percent conversion L481–529; `apps/erp/app/modules/documents/ui/Documents/PdfViewer.tsx` (simple react-pdf usage + worker note)

**Steps:**
1. Props:
   ```ts
   type InspectionDrawingPaneProps = {
     pdfUrl: string;
     balloons: { id: string; inspectionFeatureId: string; pageNumber: number; xCoordinate: number; yCoordinate: number; regionX: number; regionY: number; regionWidth: number; regionHeight: number }[];
     activeFeatureId: string | null;
     onBalloonClick: (inspectionFeatureId: string) => void;
   };
   ```
2. Render `react-pdf` `<Document file={pdfUrl}>` + single `<Page pageNumber={page} width={containerWidth} renderTextLayer={false} renderAnnotationLayer={false}/>` with page prev/next buttons and the container width measured via a `ResizeObserver` ref (the editor's `renderedWidth` pattern). The pdf.js worker is configured globally in `apps/erp/app/entry.client.tsx` — do not configure it again.
3. Overlay: absolutely-positioned `<div className="pointer-events-auto absolute inset-0">` containing a react-konva `<Stage width height>` → `<Layer>`; for each balloon on the current page draw a `<Circle>` at `x = balloon.xCoordinate * renderedWidth`, `y = balloon.yCoordinate * pageHeightPx` (DB values are normalized 0–1 — multiply directly; the editor's ×100/÷100 percent round-trip is an editor-internal convention, skip it) with a `<Text>` label of the feature's balloon number, `fill` highlighted when `inspectionFeatureId === activeFeatureId`, and `onClick/onTap → onBalloonClick(inspectionFeatureId)`. `pageHeightPx = renderedWidth × (defaultPageHeight/defaultPageWidth)` from the Page `onLoadSuccess` viewport, mirroring the editor's `overlayHeight`.
4. Auto-switch the visible page to the active feature's balloon page when `activeFeatureId` changes.
5. Export the component lazily-safe: no top-level `window` access; the parent (Task 11) wraps in `ClientOnly` + `lazy()` like `x+/inspection+/$id.tsx` does for the editor.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** any editing/ballooning; zoom-box tooling (page fit-to-width only).

---

## Task 10: InspectionMeasurementGrid (features × samples)

**Depends on:** Tasks 4, 6
**Files:**
- Create: `apps/erp/app/modules/quality/ui/InboundInspections/InspectionMeasurementGrid.tsx`
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountLines.tsx` — `editableComponents` map + `EditableNumber` config (L26, 627–641), `onCellEdit` (L155–181), Table props (`withInlineEditing`, `forceEditMode`), keyboard-nav data-attribute pattern (L508–625)

**Steps:**
1. Props:
   ```ts
   type InspectionMeasurementGridProps = {
     inspectionId: string;
     lotStatus: string;               // terminal => read-only
     isSerial: boolean;
     features: InboundInspectionFeature[];      // resolved plan + live inspectionFeature join
     samples: InboundInspectionSample[];        // ordered createdAt asc, id asc
     measurements: InboundInspectionMeasurement[];
     maxSampleSize: number;                     // max over features
     activeFeatureId: string | null;
     onActiveFeatureChange: (id: string | null) => void;
     onAddSample: () => void;                   // serial: opens scan modal
   };
   ```
2. Row model: one row per feature, sorted by `inspectionFeature.pageNumber` then `label`. Fixed leading columns: balloon label, description, `Nom` / `Tol+` / `Tol−` / `Unit` (blank for attribute features), `n/Ac` (e.g. `8 / 1`), and a pass-count chip (`passed/recorded` of `n`, red when fails ≥ Re).
3. Sample columns: for non-serial, render `maxSampleSize` columns headed `1…n` (columns beyond the existing sample rows have `sampleId=null` until the first save creates one — thread the `sampleId` returned by the measurement action back into local state, keyed by column index). For serial, one column per existing sample headed by `trackedEntity.readableId`, plus a trailing `+ Add sample` header button calling `onAddSample`. Cells where `columnIndex > feature.sampleSize` render disabled (muted, non-editable).
4. Editing: build the columns with the shared `Table` (`~/components/Table`) exactly like `InventoryCountLines` — `withInlineEditing`, `forceEditMode={lotStatus is non-terminal}` (sync with an effect, not seeded state — stale-`forceEditMode` lesson), `editableComponents` mapping each sample column to `EditableNumber` for Measurement-type rows. `onCellEdit(rowFeatureId, columnIndex, value)` posts `FormData {inspectionId, sampleId?, inspectionFeatureId, value}` to `path.to.inboundInspectionMeasurement(inspectionId)` via `fetch` and returns the `{data, error}`-shaped result so the cell reverts on failure (copy the InventoryCountLines `onCellEdit` return contract). For attribute rows, render a compact Pass/Fail toggle cell (two small buttons; POST with `passed` instead of `value`).
5. Cell state styling: measurement `Failed` ⇒ red text/background tint on the cell; `Passed` ⇒ default; empty required ⇒ subtle outline. Row focus (click anywhere in the row) calls `onActiveFeatureChange(feature.inspectionFeatureId)`; when `activeFeatureId` changes from outside (balloon click), scroll the row into view (`scrollIntoView({block:"nearest"})` via a ref keyed on active row).
6. Keep the capture-phase keyboard model from the precedent: Enter/Tab advance across sample cells within a row then down; rely on the shared `Table`'s existing key handling — copy the `data-column`/`data-row` marker approach from `InventoryCountLines` (L508–625) adapted to multiple editable columns.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** disposition buttons, scan modal, PDF pane (Task 11 wires them).

---

## Task 11: InboundInspectionView wiring + fallback + drawer retirement

**Depends on:** Tasks 8, 9, 10
**Files:**
- Create: `apps/erp/app/modules/quality/ui/InboundInspections/InboundInspectionView.tsx`
- Create: `apps/erp/app/modules/quality/ui/InboundInspections/RejectLotModal.tsx` (extracted)
- Modify: `apps/erp/app/modules/quality/ui/InboundInspections/ScanInspectionSample.tsx` — add identify-only mode
- Modify: `apps/erp/app/routes/x+/inbound-inspection+/$id.tsx` — render the view
- Modify: `apps/erp/app/modules/quality/ui/InboundInspections/InboundInspectionsTable.tsx` — row link → new route (drop the `?${params}` suffix carry-over if it breaks nothing else; keep filters via the list URL only)
- Delete: `apps/erp/app/modules/quality/ui/InboundInspections/InboundInspectionLotView.tsx`
- Modify: barrel `apps/erp/app/modules/quality/ui/InboundInspections/index.ts` (if it exists) — swap exports
- Copy from (precedent): `InboundInspectionLotView.tsx` (header KPIs, four-eyes alert, gating, Confirm/Reject wiring — port, don't redesign), `apps/erp/app/modules/documents/ui/Documents/DocumentView.tsx` + `apps/erp/app/components/Layout/Panels.tsx` (ResizablePanelGroup/Panel/Handle usage)

**Steps:**
1. `RejectLotModal.tsx`: lift the local component out of `InboundInspectionLotView.tsx` (L425–551) verbatim into its own file; add an optional `failedFeatureSummary?: { label: string; spec: string; failedValues: string[] }[]` prop rendered as a compact list above the checkbox (data supplied by the view; populated fully in Task 13).
2. `ScanInspectionSample.tsx`: add prop `mode: "record" | "identify"` (default `"record"` preserves today's behavior). In `identify` mode: hide the Pass/Fail submit pair and Notes; render a single primary `Add sample` submit that posts `status="Pending"` with the selected `trackedEntityId` (serial identity still required); action path becomes `path.to.inboundInspectionSample(inspectionId)`.
3. `InboundInspectionView.tsx` — props: everything the `$id` loader returns. Layout: full-height flex column; header bar (item + readableId, receipt link, supplier, status badge, plan summary `Std · Level · AQL`, document name + a `Change` button opening a small modal posting to `path.to.inboundInspectionDocument(id)` — options via `components/Form/InspectionDocument` combobox scoped to the item, disabled once measurements exist; four-eyes `Alert` when `enforceFourEyes && receiverId === currentUserId`); body:
   - **Document flow** (`document && features.length`): `ResizablePanelGroup direction="horizontal"` → left `ResizablePanel` (defaultSize 45, minSize 25) with `InspectionDrawingPane` (wrapped `ClientOnly`+`Suspense`+`lazy` like `x+/inspection+/$id.tsx`), `ResizableHandle withHandle`, right panel with `InspectionMeasurementGrid`. `activeFeatureId` state lives here and links the two panes both directions.
   - **Fallback flow** (no document): port the old drawer's body (progress bar, samples table, "Inspect Next Item" button opening `ScanInspectionSample mode="record"`) into the page unchanged.
4. Footer (both flows): port the old gating with the per-feature upgrade — document flow: `canAccept = every feature recordedCount >= sampleSize && failsForFeature <= acceptanceNumber`, `canReject = any feature failsForFeature >= rejectionNumber || samples.some(Failed)`, `canPartial = any measurement recorded`; fallback flow keeps the old sample-count math verbatim. Buttons post to the new `path.to.inboundInspectionAccept/Partial(id)` via the existing `Confirm` component; Reject opens `RejectLotModal` with `action={path.to.inboundInspectionReject(id)}`. "Create Issue from Inspection" link ported as-is.
5. Serial flow: `+ Add sample` (grid) opens `ScanInspectionSample mode={document ? "identify" : "record"}`.
6. Update `$id.tsx` to render the view; update `InboundInspectionsTable` hyperlink to `path.to.inboundInspection(row.original.id)`; delete `InboundInspectionLotView.tsx` and fix the barrel + any imports (`grep -rn "InboundInspectionLotView" apps/erp`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -rn "InboundInspectionLotView" apps/erp/app | wc -l
# Expected: 0
```

**Out of scope:** MES; NCR content payload (Task 13).

---

## Task 12: Item Quality tab — documents card + assignments card (4 routes)

**Depends on:** Tasks 4, 6
**Files:**
- Create: `apps/erp/app/modules/quality/ui/SamplingPlan/ItemQualityView.tsx` (shared: two new cards + existing SamplingPlanForm)
- Modify: `apps/erp/app/routes/x+/part+/$itemId.quality.tsx`, `x+/material+/$itemId.quality.tsx`, `x+/tool+/$itemId.quality.tsx`, `x+/consumable+/$itemId.quality.tsx`
- Copy from (precedent): `apps/erp/app/modules/quality/ui/SamplingPlan/SamplingPlanForm.tsx` (Card + ValidatedForm layout), `apps/erp/app/routes/x+/production+/inspection.new.tsx` + `InspectionDocumentForm` (create-document modal), `apps/erp/app/components/Form/InspectionDocument.tsx` (item-scoped combobox)

**Steps:**
1. `ItemQualityView.tsx` props: `{ itemId: string; actionPath: string; standard: SamplingStandard; plan: ...; documents: { id: string; fileName: string | null; drawingNumber: string | null; version: number }[]; assignments: ItemInspectionDocumentAssignment[] }`. Renders a vertical stack:
   - **Inspection Documents card**: `Card` with header action `New Inspection Document` (opens `InspectionDocumentForm` with `initialValues={{ name: "", partId: itemId, drawingNumber: "" }}`; on success the route revalidates). Body: simple table of documents (drawingNumber ?? fileName, `v{version}`), each row linking to `path.to.inspectionDocument(doc.id)`. Empty state: "No inspection documents".
   - **Assignments card**: `Card` titled "Inspection Document Assignments"; one row per usage in `inspectionDocumentUsages` (v1: `Receipt`) — a `ValidatedForm` with `validator(itemInspectionDocumentAssignmentValidator)`, `Hidden` fields `itemId` + `usage` + hidden `intent="assignment"`, the `InspectionDocument` combobox (`itemId` prop scopes options, `isOptional`), and a `Submit`. Posts to `actionPath`.
   - **Sampling plan**: render the existing `SamplingPlanForm` below, unchanged.
2. Each of the four routes: extend the loader (`Promise.all` adds `getInspectionDocumentsForItem(client, itemId, companyId)` and `getItemInspectionDocumentAssignments(client, itemId, companyId)`); extend the action to branch on `formData.get("intent")` — `"assignment"` ⇒ validate `itemInspectionDocumentAssignmentValidator` ⇒ `upsertItemInspectionDocumentAssignment` (permissions stay `update: "quality"`); otherwise the existing sampling-plan path unchanged (its form gains a hidden `intent="samplingPlan"` — add via `SamplingPlanForm`'s ValidatedForm, one-line change). Render `<ItemQualityView …/>` instead of the bare `SamplingPlanForm`. Keep the four files byte-identical apart from the `path.to.*Quality` helper, as they are today.
3. If `InspectionDocumentForm`'s props don't accept a preset `partId` initial value, STOP and report rather than modifying the production form's contract silently.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
diff <(sed 's/partQuality/XQuality/g' apps/erp/app/routes/x+/part+/\$itemId.quality.tsx) <(sed 's/materialQuality/XQuality/g' apps/erp/app/routes/x+/material+/\$itemId.quality.tsx)
# Expected: no diff (routes identical modulo the path helper)
```

**Out of scope:** FAI/Production usage slots (enum stays Receipt-only); editing sampling fields in the document editor grid (see note below — the editor's `featureColumns` gains the six sampling fields only if trivially additive; otherwise defer to a follow-up and record it in the plan changelog. The RPC + validators already persist them from Task 1/4, and `reconcileInboundInspectionFeatures` + post-receipt consume them.)

---

## Task 13: Reject NCR enrichment (failed-feature table)

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/routes/x+/inbound-inspection+/$id.reject.tsx`

**Steps:**
1. In the NCR branch (after `dispositionInboundInspection` succeeds and `createNcr` is true), load via the existing service-role client: `getInboundInspectionFeatures`, `getInboundInspectionMeasurements`, and the lot's samples (already loaded via `getInboundInspection`).
2. Build `failedFeatureLines: string[]` — for each feature with ≥1 Failed measurement: `- ${label}: nominal ${nominalValue} +${tolerancePlus}/−${toleranceMinus} ${unit ?? ""} — failed values: ${failedValues.join(", ")} (${failsForFeature}/${recordedCount} failed, n=${sampleSize}, Ac=${acceptanceNumber})`. For attribute features: `- ${label}: ${failsForFeature}/${recordedCount} failed`.
3. Append to the issue description passed to `insertIssue`: existing title/description + `\n\nFailed features:\n` + lines. When no measurements exist (fallback flow), skip — description unchanged.
4. Pass the same summary to the `RejectLotModal` preview: the `$id.tsx` loader already returns features + measurements; compute `failedFeatureSummary` in `InboundInspectionView` and pass it down (wire the prop added in Task 11 Step 1).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** issue content JSON blocks; workflow tasks; notifications.

---

## Task 14: Docs sync (rule + AGENTS.md)

**Depends on:** Tasks 1–13 (run after implementation is committed)
**Files:**
- Modify: `.claude/rules/inbound-inspection-system.md` — new tables, per-feature sampling, new route tree, derived sample status, document assignment; update the `paths:` frontmatter to include `apps/erp/app/routes/x+/inbound-inspection+/**`
- Modify: `apps/erp/app/modules/quality/AGENTS.md` — data-model table + service-function list + inbound description
- Modify: `apps/erp/app/modules/production/AGENTS.md` — only if it enumerates inspectionFeature columns or the RPC signature (check first)

**Steps:**
1. Update each file to describe the committed code only — verify every claim against the merged implementation (tables, function names, route paths). Follow `.claude/rules/keep-sources-in-sync.md`.

**Verify:**
```bash
grep -n "inboundInspectionMeasurement" .claude/rules/inbound-inspection-system.md apps/erp/app/modules/quality/AGENTS.md
# Expected: at least one hit in each file
```

**Out of scope:** product docs site (`docs/`) — separate follow-up if desired.

---

## Task 15: Browser verification (/test)

**Depends on:** Tasks 1–13
**Steps:**
1. Boot the stack with plain `crbn up` (portless). Enable nothing extra; log in via `/auth`.
2. Invoke the `/test` skill against this branch's diff with this scenario: (a) on a purchased part with `requiresInspection`, create an inspection document (upload any small PDF), add 2 Measurement features with numeric nominal/tolerances + 1 Checkbox feature, balloon them; assign the document to the Receipt slot on the part's Quality tab; set an item sampling plan (Percentage 10%); give one feature its own AQL rule. (b) Create + post a PO receipt for qty 20 of that part. (c) Verify an inbound inspection was created with the document attached and per-feature n/Ac/Re. (d) Open `/x/inbound-inspection/{id}`: PDF + balloons render; balloon↔row sync works; enter in-tolerance and out-of-tolerance values; verify cell coloring, derived sample status, disabled cells beyond n. (e) Verify Accept stays disabled until complete; force a feature past its Re and Reject with NCR — verify the issue contains the failed-features block. (f) Verify an item WITHOUT an assigned document still gets the fallback pass/fail flow.
3. Capture screenshots of the split view and the item Quality tab for the PR (surface-designs memory).

**Verify:** the /test run report shows every step above passing; screenshots saved.

**Out of scope:** MES surfacing; load/perf testing.

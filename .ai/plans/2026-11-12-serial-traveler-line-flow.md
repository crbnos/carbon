# Serial traveler and line flow, slice 1 — implementation plan

**Spec:** .ai/specs/2026-11-12-serial-traveler-line-flow.md
**Research:** none. The user skipped the research phase (run record `.ai/runs/2026-11-12-serial-traveler.md`). The design copies Carbon's kanban scan routes and strict backflush.
**Closest sibling:** the kanban scan (a scanned code that opens an MES operation), and strict backflush (a company setting that blocks completion).
**Branch:** `feat/serial-traveler`
**Scope:** slice 1 only (spec S1–S11). Slices 2 and 3 get their own plans.

## How to use this plan

- Work the phases in order. Inside a phase, tasks marked "parallel" can run as parallel subagents.
- After each phase, the user can test what the phase built. Phase C ends with seeded data, so the user can scan travelers after phase C.
- 🛑 Never rebuild or reset the local database. Apply migrations forward only (`pnpm db:migrate`). Ask the user before `pnpm db:seed:dev`.
- Only the main agent runs the `erp` typecheck. A subagent runs only the `mes`, `@carbon/*` typechecks and tests named in its task.
- Every new source file starts with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- Every UI task names its precedent. Read `.claude/skills/carbon-design/SKILL.md` before a UI task.

## Progress

Phase A — database
- [x] Task 1: Write the slice 1 schema migration
- [x] Task 2: Write the `get_traveler_target` migration
- [x] Task 3: Write the `get_line_feed_shortages` migration
- [x] Task 4: Declare the `materialRequest` RLS rule and its realtime broadcast
- [x] Task 5: Apply migrations, regenerate types and ship the authz rules
- [x] Task 6: Prove `get_traveler_target` with a database test

Phase B — the traveler scan
- [x] Task 7: Encode the traveler link in the default label QR
- [x] Task 8: Add the pure traveler helpers with tests
- [x] Task 9: Keep a scan pending while `onUnrecognized` runs
- [x] Task 10: Add traveler paths and server reads
- [x] Task 11: Add the raw-ID resolve route and the layout wedge changes
- [x] Task 12: Add the traveler wrong-item check to `issue-tracked-entity`
- [x] Task 13: Build the traveler route and its chooser
- [x] Task 14: Issue a traveler scan on the operation screens
- [x] Task 15: Read traveler links in the Issue dialog Scan tab

Phase C — test data (`motor-line`)
- [x] Task 16: Add the optional dataset fields to `types.ts`
- [x] Task 17: Validate the new fields, with a unit test
- [x] Task 18: Write the line-flow settings in tier 01
- [x] Task 19: Link BOM lines to their operation in tier 02
- [x] Task 20: Write per-lot opening ledger rows and kanban levels in tier 03
- [x] Task 21: Split serial job units in tier 06
- [x] Task 22: Write timing and print-on-completion on serial sequences in tier 10
- [x] Task 23: Register the dev-only dataset `motor-line`
- [x] Task 23a: Let a dev-only dataset borrow an industry's bundled assets
- [x] Task 24: Add the AJ-3 work centers, processes, bins and settings
- [x] Task 25: Add the AJ-3 items, methods and supplier links
- [x] Task 26: Add the AJ-3 opening stock, bearing lots and Transfer kanbans
- [x] Task 27: Add the AJ-3 jobs and serial sequences
- [x] Task 28: Add `materialRequest` demo rows and a coverage floor
- [x] Task 29: Run the dataset checks and the scoped typecheck
- [x] Task 30: Seed `motor-line` and check the AJ-3 rows (ask the user first)

Phase D — required scans
- [x] Task 31: Add the pure required-scan helper with tests
- [x] Task 32: Add the required-scan server building block
- [x] Task 33: Refuse completion on the server in the 3 routes
- [x] Task 34: Block the Complete button in `QuantityModal`

Phase E — labels and picking
- [x] Task 35: Add the traveler print helpers to `@carbon/database`
- [x] Task 36: Add the `PickingList` print source
- [x] Task 37: Print travelers when the ERP starts a picking list
- [x] Task 38: Print travelers when the MES starts a picking list
- [x] Task 39: Print travelers when a first pick starts a Draft list
- [x] Task 40: Add "Print travelers" to the MES picking list
- [x] Task 41: Print the finished-good label at the last operation
- [x] Task 42: Create a picking list for each released job
- [x] Task 43: Show unassigned picking lists to water spiders in the MES

Phase F — "Need material" and the line feeder screen
- [x] Task 44: Add the shared `materialRequest` building blocks
- [x] Task 45: Add the ERP operations `createMaterialRequest` and `resolveMaterialRequest`
- [x] Task 46: Add the MES "Need material" modal
- [x] Task 47: Add the pure line-feed row builder
- [x] Task 48: Add the MES line feeder screen

Phase G — settings screens, docs and verification
- [x] Task 49: Add the "Line Flow" toggles to Settings → Production
- [x] Task 50: Add "Print label on completion" to the serial number form
- [x] Task 51: Bring the rules and AGENTS.md files up to date
- [ ] Task 52: Verify slice 1 in the browser

## Dependencies

- Phase A: Tasks 1, 2 and 3 are parallel. Task 4 needs Task 1. Task 5 needs Tasks 1–4. Task 6 needs Task 5.
- Phase B: Tasks 7, 8 and 9 are parallel and need nothing. Task 10 needs Tasks 5 and 8. Task 11 needs Tasks 8, 9 and 10. Task 12 needs Task 10. Task 13 needs Tasks 8, 10 and 12. Task 14 needs Tasks 8, 11 and 12. Task 15 needs Task 8.
- Phase C: Task 16 first. Tasks 17, 19, 20 and 21 need only Task 16 and are parallel. Tasks 18 and 22 also need Task 5. Task 23 needs Task 16. Task 24 needs Tasks 17, 18 and 23. Task 25 needs Tasks 19 and 24. Task 26 needs Tasks 20 and 25. Task 27 needs Tasks 21, 22 and 25. Task 28 needs Task 5. Task 29 needs Tasks 16–28. Task 30 needs Task 29.
- Phase D: Task 31 needs nothing. Task 32 needs Tasks 5 and 31. Tasks 33 and 34 need Task 32.
- Phase E: Task 35 needs Task 5. Task 36 needs Task 35. Tasks 37, 38 and 40 need Task 36. Task 39 needs Tasks 37 and 38. Task 41 needs Tasks 32 and 35. Task 42 needs Task 5. Task 43 needs nothing.
- Phase F: Task 44 needs Task 5. Tasks 45 and 46 need Task 44. Task 47 needs Task 5. Task 48 needs Tasks 44 and 47.
- Phase G: Tasks 49 and 50 need Task 5. Task 51 needs Phases B–F. Task 52 needs every task.

## Decisions taken while planning

| Decision | Source |
|----------|--------|
| Picks go straight to each work center's lineside storage unit. No staging column on `location`. | User, spec Q12 |
| Test data is the dev-only dataset `motor-line`. `motor` stays unchanged. | Spec Q9 |
| The printing registry gets a new source `PickingList`. `packages/printing/AGENTS.md` lists this under Ask First; the user approves it with this plan. | Spec, Design Decisions |
| A traveler scan of a batch lot sends the operator to the Issue dialog. | Spec S5 |
| `batch.$batchId.complete.tsx` gets no required-scan check in slice 1. | Spec S7 |

---

# Phase A — database

## Task 1: Write the slice 1 schema migration

**Depends on:** none (parallel with Tasks 2 and 3)
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_serial-traveler-schema.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261028153412_serial-number-timing.sql` (view rebuild); `packages/database/supabase/migrations/20261109141852_manual-inspections.sql` (composite `workCenter` FK)

🛑 Do not create the file while `crbn up` or `crbn migrate` runs. A file created during a run is recorded as applied while it is empty (`.ai/lessons.md`).

**Steps:**
1. Run `pnpm db:migrate:new serial-traveler-schema` from the repository root.
2. Write this SQL into the new file, exactly:

```sql
-- Serial traveler and line flow, slice 1 schema
-- (.ai/specs/2026-11-12-serial-traveler-line-flow.md, Data Model Changes).
-- RLS for "materialRequest" ships through the authz manifest
-- (packages/database/src/authz/manifest.ts), never as a policy statement in a migration.

SET lock_timeout = '5s';

-- 1. Company settings. Each is off by default, so no company changes.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "travelerLabels" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requireTrackedMaterialsIssued" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoPickingListOnRelease" BOOLEAN NOT NULL DEFAULT false;

-- 2. Finished-good label per item.
ALTER TABLE "itemSerialSequence"
  ADD COLUMN IF NOT EXISTS "printLabelOnCompletion" BOOLEAN NOT NULL DEFAULT false;

-- The view expanded iss.* when it was created, so it is rebuilt to carry the
-- new column (a new column inside iss.* moves the joined ones, which CREATE OR
-- REPLACE refuses).
DROP VIEW IF EXISTS "itemSerialSequences";
CREATE VIEW "itemSerialSequences" WITH(SECURITY_INVOKER=true) AS
SELECT
  iss.*,
  i."readableIdWithRevision" AS "itemReadableId",
  i."name" AS "itemName",
  i."itemTrackingType"
FROM "itemSerialSequence" iss
INNER JOIN "item" i ON i."id" = iss."itemId";

-- 3. "Need material" requests.
DO $$ BEGIN
  CREATE TYPE "materialRequestStatus" AS ENUM ('Open', 'Resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "materialRequest" (
  "id" TEXT NOT NULL DEFAULT id('mreq'),
  "companyId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "workCenterId" TEXT,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  "itemId" TEXT REFERENCES "item"("id") ON DELETE SET NULL,
  "note" TEXT,
  "status" "materialRequestStatus" NOT NULL DEFAULT 'Open',
  "resolvedBy" TEXT REFERENCES "user"("id"),
  "resolvedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "materialRequest_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "materialRequest_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "materialRequest_locationId_fkey" FOREIGN KEY ("locationId", "companyId")
    REFERENCES "location"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "materialRequest_workCenterId_fkey" FOREIGN KEY ("workCenterId", "companyId")
    REFERENCES "workCenter"("id", "companyId") ON DELETE SET NULL ("workCenterId"),
  -- A resolved request records when; an open one does not.
  CONSTRAINT "materialRequest_resolvedAt_check"
    CHECK (("status" = 'Resolved') = ("resolvedAt" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "materialRequest_companyId_idx" ON "materialRequest" ("companyId");
CREATE INDEX IF NOT EXISTS "materialRequest_locationId_idx" ON "materialRequest" ("locationId");
CREATE INDEX IF NOT EXISTS "materialRequest_workCenterId_idx" ON "materialRequest" ("workCenterId");
CREATE INDEX IF NOT EXISTS "materialRequest_jobOperationId_idx" ON "materialRequest" ("jobOperationId");
CREATE INDEX IF NOT EXISTS "materialRequest_itemId_idx" ON "materialRequest" ("itemId");
CREATE INDEX IF NOT EXISTS "materialRequest_createdBy_idx" ON "materialRequest" ("createdBy");
CREATE INDEX IF NOT EXISTS "materialRequest_updatedBy_idx" ON "materialRequest" ("updatedBy");
CREATE INDEX IF NOT EXISTS "materialRequest_resolvedBy_idx" ON "materialRequest" ("resolvedBy");
CREATE INDEX IF NOT EXISTS "materialRequest_open_idx"
  ON "materialRequest" ("companyId", "locationId") WHERE "status" = 'Open';

ALTER TABLE "public"."materialRequest" ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

RESET lock_timeout;
```

3. Do not run `pnpm db:migrate` yet. Task 5 applies all migrations after Task 4 adds the RLS rule.

If the newest migration on `main` is newer than the generated timestamp, STOP and report. Do not edit the timestamp by hand.

**Verify:**
```bash
ls packages/database/supabase/migrations/*_serial-traveler-schema.sql && grep -c "CREATE POLICY" packages/database/supabase/migrations/*_serial-traveler-schema.sql
# Expected: one file path, then 0
```

**Out of scope:** slice 2 columns (`job.releasedBy`, `job.planningActionId`, `itemPlanning`, `autoJobUserId`). Any column on `location`.

---

## Task 2: Write the `get_traveler_target` migration

**Depends on:** none (parallel with Tasks 1 and 3)
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_get-traveler-target.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260929152451_traceability-company-scope.sql` (company-scoped lineage RPC, SECURITY INVOKER)

**Steps:**
1. Run `pnpm db:migrate:new get-traveler-target` from the repository root.
2. Write this SQL into the new file, exactly:

```sql
-- The traveler scan (.ai/specs/2026-11-12-serial-traveler-line-flow.md, S3).
-- From the scanned unit, follow Consume edges (input = unit, output = parent)
-- while the unit is Consumed. At each step take the newest Consume edge for
-- which no later Unconsume gives the unit back from that parent (input =
-- parent, output = unit). Stop at a unit that is not Consumed, at a unit with
-- no such edge, or after 20 steps, and return that unit. No row when the
-- scanned unit is not in the company. SECURITY INVOKER: the caller's RLS applies.

CREATE OR REPLACE FUNCTION get_traveler_target(
  p_tracked_entity_id TEXT,
  p_company_id TEXT
)
RETURNS TABLE (
  "trackedEntityId" TEXT,
  "status" "trackedEntityStatus",
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "itemId" TEXT,
  "depth" INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_id TEXT;
  v_status "trackedEntityStatus";
  v_attributes JSONB;
  v_item_id TEXT;
  v_depth INTEGER := 0;
  v_parent_id TEXT;
  v_next_id TEXT;
  v_next_status "trackedEntityStatus";
  v_next_attributes JSONB;
  v_next_item_id TEXT;
BEGIN
  SELECT te."id", te."status", te."attributes", te."itemId"
  INTO v_id, v_status, v_attributes, v_item_id
  FROM "trackedEntity" te
  WHERE te."id" = p_tracked_entity_id
    AND te."companyId" = p_company_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  WHILE v_status = 'Consumed' AND v_depth < 20 LOOP
    SELECT tao."trackedEntityId"
    INTO v_parent_id
    FROM "trackedActivityInput" tai
    INNER JOIN "trackedActivity" ta
      ON ta."id" = tai."trackedActivityId"
      AND ta."companyId" = p_company_id
      AND ta."type" = 'Consume'
    INNER JOIN "trackedActivityOutput" tao
      ON tao."trackedActivityId" = ta."id"
      AND tao."companyId" = p_company_id
      AND tao."trackedEntityId" <> v_id
    WHERE tai."trackedEntityId" = v_id
      AND tai."companyId" = p_company_id
      AND NOT EXISTS (
        SELECT 1
        FROM "trackedActivityInput" uin
        INNER JOIN "trackedActivity" ua
          ON ua."id" = uin."trackedActivityId"
          AND ua."companyId" = p_company_id
          AND ua."type" = 'Unconsume'
          AND ua."createdAt" > ta."createdAt"
        INNER JOIN "trackedActivityOutput" uout
          ON uout."trackedActivityId" = ua."id"
          AND uout."companyId" = p_company_id
          AND uout."trackedEntityId" = v_id
        WHERE uin."trackedEntityId" = tao."trackedEntityId"
          AND uin."companyId" = p_company_id
      )
    ORDER BY ta."createdAt" DESC, ta."id" DESC
    LIMIT 1;

    -- SELECT INTO sets NULL when no edge is found.
    EXIT WHEN v_parent_id IS NULL;

    SELECT te."id", te."status", te."attributes", te."itemId"
    INTO v_next_id, v_next_status, v_next_attributes, v_next_item_id
    FROM "trackedEntity" te
    WHERE te."id" = v_parent_id
      AND te."companyId" = p_company_id;

    EXIT WHEN NOT FOUND;

    v_id := v_next_id;
    v_status := v_next_status;
    v_attributes := v_next_attributes;
    v_item_id := v_next_item_id;
    v_depth := v_depth + 1;
  END LOOP;

  RETURN QUERY
  SELECT
    v_id,
    v_status,
    v_attributes->>'Job',
    v_attributes->>'Job Make Method',
    v_item_id,
    v_depth;
END;
$$;
```

**Verify:**
```bash
grep -c "SECURITY DEFINER" packages/database/supabase/migrations/*_get-traveler-target.sql
# Expected: 0
```

**Out of scope:** the MES routes, and any change to the existing lineage RPCs.

---

## Task 3: Write the `get_line_feed_shortages` migration

**Depends on:** none (parallel with Tasks 1 and 2)
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_get-line-feed-shortages.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260923134421_stock-transfer-wizard-negative-stock.sql` (on-hand per bin as `SUM(itemLedger.quantity)`); `packages/database/supabase/migrations/20260601143527_picking-lists.sql:199-205` (station bin order)

| Rule | Choice |
|---|---|
| Station bin | Active `storageUnit` at the location with `workCenterId` set |
| Bin per station | `isWorkCenterDefault DESC, createdAt ASC`, the order of `get_or_create_work_center_lineside` |
| On hand | `SUM(itemLedger.quantity)` over all station bins of the work center, floored at 0 |
| Open work | Jobs `Ready`, `In Progress`, `Paused` at the location; operations not `Done` and not `Canceled` |
| Material with no `jobOperationId` | Counts at the first open operation (lowest `order`) of its `jobMakeMethodId` |
| Material counted | `methodType = 'Pull from Inventory'`, item not `Non-Inventory` |

Note: `jobOperationStatus` spells `'Canceled'` with one "l".

**Steps:**
1. Run `pnpm db:migrate:new get-line-feed-shortages` from the repository root.
2. Write this SQL into the new file, exactly:

```sql
-- Line feeder shortages (.ai/specs/2026-11-12-serial-traveler-line-flow.md, S10).
-- A station bin is an active storage unit at the location with workCenterId
-- set. Required: for open operations at that work center (jobs Ready, In
-- Progress or Paused at the location; operations not Done or Canceled), the
-- unissued quantity of their Pull from Inventory materials. A material with
-- no operation counts at the first open operation of its make method. On
-- hand: the item ledger sum over every station bin of the work center.
-- Returns only rows where required exceeds on hand, largest shortage first.
-- SECURITY INVOKER: the caller's RLS applies.

CREATE OR REPLACE FUNCTION get_line_feed_shortages(
  p_location_id TEXT,
  p_company_id TEXT
)
RETURNS TABLE (
  "workCenterId" TEXT,
  "storageUnitId" TEXT,
  "itemId" TEXT,
  "required" NUMERIC,
  "onHand" NUMERIC,
  "short" NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH station_bins AS (
    SELECT su."id", su."workCenterId", su."isWorkCenterDefault", su."createdAt"
    FROM "storageUnit" su
    WHERE su."companyId" = p_company_id
      AND su."locationId" = p_location_id
      AND su."workCenterId" IS NOT NULL
      AND su."active" = true
  ),
  station AS (
    SELECT DISTINCT ON (sb."workCenterId")
      sb."workCenterId" AS "stationWorkCenterId",
      sb."id" AS "stationStorageUnitId"
    FROM station_bins sb
    ORDER BY sb."workCenterId", sb."isWorkCenterDefault" DESC, sb."createdAt" ASC, sb."id"
  ),
  open_operations AS (
    SELECT jo."id", jo."jobId", jo."jobMakeMethodId", jo."workCenterId", jo."order"
    FROM "jobOperation" jo
    INNER JOIN "job" j
      ON j."id" = jo."jobId"
      AND j."companyId" = p_company_id
    WHERE jo."companyId" = p_company_id
      AND j."locationId" = p_location_id
      AND j."status" IN ('Ready', 'In Progress', 'Paused')
      AND jo."status" NOT IN ('Done', 'Canceled')
  ),
  first_open_operation AS (
    SELECT DISTINCT ON (oo."jobMakeMethodId")
      oo."jobMakeMethodId", oo."id"
    FROM open_operations oo
    WHERE oo."jobMakeMethodId" IS NOT NULL
    ORDER BY oo."jobMakeMethodId", oo."order" ASC, oo."id"
  ),
  need AS (
    SELECT
      oo."workCenterId" AS "needWorkCenterId",
      jm."itemId" AS "needItemId",
      SUM(GREATEST(COALESCE(jm."estimatedQuantity", 0) - COALESCE(jm."quantityIssued", 0), 0)) AS "needQuantity"
    FROM "jobMaterial" jm
    INNER JOIN "item" i
      ON i."id" = jm."itemId"
      AND i."companyId" = p_company_id
    LEFT JOIN first_open_operation fo
      ON jm."jobOperationId" IS NULL
      AND fo."jobMakeMethodId" = jm."jobMakeMethodId"
    INNER JOIN open_operations oo
      ON oo."id" = COALESCE(jm."jobOperationId", fo."id")
      AND oo."jobId" = jm."jobId"
    WHERE jm."companyId" = p_company_id
      AND jm."methodType" = 'Pull from Inventory'
      AND i."itemTrackingType" <> 'Non-Inventory'
      AND oo."workCenterId" IS NOT NULL
    GROUP BY oo."workCenterId", jm."itemId"
  ),
  on_hand AS (
    SELECT
      sb."workCenterId" AS "onHandWorkCenterId",
      il."itemId" AS "onHandItemId",
      SUM(il."quantity") AS "onHandQuantity"
    FROM "itemLedger" il
    INNER JOIN station_bins sb ON sb."id" = il."storageUnitId"
    WHERE il."companyId" = p_company_id
      AND il."locationId" = p_location_id
    GROUP BY sb."workCenterId", il."itemId"
  )
  SELECT
    n."needWorkCenterId",
    s."stationStorageUnitId",
    n."needItemId",
    n."needQuantity",
    GREATEST(COALESCE(oh."onHandQuantity", 0), 0),
    n."needQuantity" - GREATEST(COALESCE(oh."onHandQuantity", 0), 0)
  FROM need n
  INNER JOIN station s ON s."stationWorkCenterId" = n."needWorkCenterId"
  LEFT JOIN on_hand oh
    ON oh."onHandWorkCenterId" = n."needWorkCenterId"
    AND oh."onHandItemId" = n."needItemId"
  WHERE n."needQuantity" > GREATEST(COALESCE(oh."onHandQuantity", 0), 0)
  ORDER BY 6 DESC, 1, 3;
END;
$$;
```

**Verify:**
```bash
grep -c "SECURITY DEFINER" packages/database/supabase/migrations/*_get-line-feed-shortages.sql
# Expected: 0
```

**Out of scope:** the MES line feeder route, and new indexes (the indexes it needs already exist).

---

## Task 4: Declare the `materialRequest` RLS rule and its realtime broadcast

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — add the `materialRequest` rule.
- Modify: `packages/database/src/event-system/attachments.ts` — add `materialRequest: { statement: ["broadcast_table_changes"] }`.
- Copy from (precedent): the `note` rule in `manifest.ts` (about line 1202); an existing `broadcast_table_changes` entry in `attachments.ts`.

**Steps:**
1. In `manifest.ts`, add this entry between `materialGrade` and `materialSubstance`:

```ts
  // Any employee raises a "Need material" request. A line feeder
  // (inventory_update) or its author resolves it. USING is also the CHECK,
  // so an update never moves a row to another company.
  materialRequest: company("inventory", {
    create: "employee",
    update: or(
      inCompany("companyId", "inventory_update"),
      and(owner("createdBy"), inCompany("companyId", "employee"))
    )
  }),
```

2. In `attachments.ts`, add `materialRequest: { statement: ["broadcast_table_changes"] }`. Keep the file's sort order.
3. Do not write the generated authz migration yet. Task 5 writes it.

If `company()` refuses a predicate for `update`, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz/rules.test.ts src/authz/helpers.test.ts
# Expected: all tests pass
```

**Out of scope:** any `CREATE POLICY` in a migration. Handlers on `location`.

---

## Task 5: Apply migrations, regenerate types and ship the authz rules

**Depends on:** Tasks 1, 2, 3, 4
**Files:**
- Create (generated): `packages/database/supabase/migrations/<timestamp>_serial-traveler-authz.sql`
- Modify (generated): `packages/database/src/types.ts`

🛑 Never rebuild or reset the local database. Apply pending migrations forward only.

**Steps:**
1. Run `pnpm db:migrate`. It applies Tasks 1–3 and runs `authz sync`.
2. Run `pnpm run generate:types`.
3. Run `pnpm --filter @carbon/database authz migration serial-traveler-authz`.
4. Open the generated file. Confirm it holds the `materialRequest` policies and its realtime trigger.
5. Run `pnpm db:check:backups`.

If `db:migrate` fails with "no rule" for `materialRequest`, STOP and report.

**Verify:**
```bash
grep -c "travelerLabels\|requireTrackedMaterialsIssued\|autoPickingListOnRelease\|printLabelOnCompletion\|materialRequestStatus\|get_traveler_target\|get_line_feed_shortages" packages/database/src/types.ts
# Expected: 7 or more
pnpm --filter @carbon/database authz check
# Expected: exit code 0, no drift reported
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -c 'SELECT s.* FROM "location" l CROSS JOIN LATERAL get_line_feed_shortages(l."id", l."companyId") s LIMIT 20;'
# Expected: a table with columns workCenterId, storageUnitId, itemId, required, onHand, short; no ERROR line
```

**Out of scope:** demo rows (Task 28). Hand edits to `types.ts` or to the generated authz migration.

---

## Task 6: Prove `get_traveler_target` with a database test

**Depends on:** Task 5
**Files:**
- Create: `packages/database/supabase/tests/traveler-target.test.sql`
- Copy from (precedent): `packages/database/supabase/tests/inspection-hold.test.sql` (rolled-back fixtures, `pg_temp.expect`)

**Steps:**
1. Create the file with exactly this content:

```sql
-- get_traveler_target (spec .ai/specs/2026-11-12-serial-traveler-line-flow.md, S3).
-- Run from the repository root against a local database that has at least
-- one company with an employee user:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/traveler-target.test.sql
-- Every fixture row is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect(label text, actual text, expected text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

CREATE FUNCTION pg_temp.unit(p_company text, p_user text, p_status text, p_attributes jsonb)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_id text;
BEGIN
  INSERT INTO "trackedEntity" (
    "quantity", "status", "sourceDocument", "sourceDocumentId",
    "attributes", "companyId", "createdBy"
  ) VALUES (
    1, p_status::"trackedEntityStatus", 'Job', 'traveler-target-test',
    p_attributes, p_company, p_user
  )
  RETURNING "id" INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE FUNCTION pg_temp.edge(
  p_company text, p_user text, p_type text,
  p_input text, p_output text, p_at timestamptz
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_activity text := gen_random_uuid()::text;
BEGIN
  INSERT INTO "trackedActivity" ("id", "type", "companyId", "createdBy", "createdAt")
  VALUES (v_activity, p_type, p_company, p_user, p_at);
  INSERT INTO "trackedActivityInput" ("trackedActivityId", "trackedEntityId", "quantity", "companyId", "createdBy")
  VALUES (v_activity, p_input, 1, p_company, p_user);
  INSERT INTO "trackedActivityOutput" ("trackedActivityId", "trackedEntityId", "quantity", "companyId", "createdBy")
  VALUES (v_activity, p_output, 1, p_company, p_user);
END;
$fn$;

DO $proof$
DECLARE
  company text;
  usr text;
  a text; b text; c text;
  e text; f text; g text;
  h text; k text;
  x text; y text;
  r record;
BEGIN
  SELECT uc."companyId", uc."userId" INTO company, usr
  FROM "userToCompany" uc
  WHERE uc."role" = 'employee'
  LIMIT 1;
  IF company IS NULL THEN
    RAISE EXCEPTION 'traveler-target: no company with an employee user';
  END IF;

  -- 1. Two levels: A went into B, B went into C (in a job).
  a := pg_temp.unit(company, usr, 'Consumed', '{}');
  b := pg_temp.unit(company, usr, 'Consumed', '{}');
  c := pg_temp.unit(company, usr, 'Reserved', '{"Job": "job-1", "Job Make Method": "jmm-1"}');
  PERFORM pg_temp.edge(company, usr, 'Consume', a, b, now() - interval '2 hours');
  PERFORM pg_temp.edge(company, usr, 'Consume', b, c, now() - interval '1 hour');
  SELECT * INTO r FROM get_traveler_target(a, company);
  PERFORM pg_temp.expect('two levels: unit', r."trackedEntityId", c);
  PERFORM pg_temp.expect('two levels: depth', r."depth"::text, '2');
  PERFORM pg_temp.expect('two levels: status', r."status"::text, 'Reserved');
  PERFORM pg_temp.expect('two levels: job', r."jobId", 'job-1');
  PERFORM pg_temp.expect('two levels: make method', r."jobMakeMethodId", 'jmm-1');

  -- 2. Given back, then issued again: E into F, F gives E back, E into G.
  e := pg_temp.unit(company, usr, 'Consumed', '{}');
  f := pg_temp.unit(company, usr, 'Reserved', '{"Job": "job-2"}');
  g := pg_temp.unit(company, usr, 'Reserved', '{"Job": "job-3"}');
  PERFORM pg_temp.edge(company, usr, 'Consume', e, f, now() - interval '3 hours');
  PERFORM pg_temp.edge(company, usr, 'Unconsume', f, e, now() - interval '2 hours');
  PERFORM pg_temp.edge(company, usr, 'Consume', e, g, now() - interval '1 hour');
  SELECT * INTO r FROM get_traveler_target(e, company);
  PERFORM pg_temp.expect('re-issue: unit', r."trackedEntityId", g);
  PERFORM pg_temp.expect('re-issue: job', r."jobId", 'job-3');

  -- 3. Given back and not issued again: the walk stays on H.
  h := pg_temp.unit(company, usr, 'Consumed', '{}');
  k := pg_temp.unit(company, usr, 'Reserved', '{}');
  PERFORM pg_temp.edge(company, usr, 'Consume', h, k, now() - interval '2 hours');
  PERFORM pg_temp.edge(company, usr, 'Unconsume', k, h, now() - interval '1 hour');
  SELECT * INTO r FROM get_traveler_target(h, company);
  PERFORM pg_temp.expect('given back: unit', r."trackedEntityId", h);
  PERFORM pg_temp.expect('given back: depth', r."depth"::text, '0');

  -- 4. A unit that is not Consumed returns itself.
  SELECT * INTO r FROM get_traveler_target(c, company);
  PERFORM pg_temp.expect('not consumed: unit', r."trackedEntityId", c);
  PERFORM pg_temp.expect('not consumed: depth', r."depth"::text, '0');

  -- 5. A loop stops after 20 steps.
  x := pg_temp.unit(company, usr, 'Consumed', '{}');
  y := pg_temp.unit(company, usr, 'Consumed', '{}');
  PERFORM pg_temp.edge(company, usr, 'Consume', x, y, now() - interval '2 hours');
  PERFORM pg_temp.edge(company, usr, 'Consume', y, x, now() - interval '1 hour');
  SELECT * INTO r FROM get_traveler_target(x, company);
  PERFORM pg_temp.expect('loop: depth', r."depth"::text, '20');

  -- 6. No row for an unknown unit or another company.
  PERFORM pg_temp.expect('unknown unit',
    (SELECT count(*) FROM get_traveler_target('no-such-unit', company))::text, '0');
  PERFORM pg_temp.expect('other company',
    (SELECT count(*) FROM get_traveler_target(a, 'no-such-company'))::text, '0');

  RAISE NOTICE 'traveler-target: all checks passed';
END
$proof$;

ROLLBACK;
```

If the `trackedEntity` insert fails on a constraint or a `before` handler, STOP and report. Do not change the function to make the test pass.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/traveler-target.test.sql
# Expected: NOTICE:  traveler-target: all checks passed, then ROLLBACK
```

**Out of scope:** a database test for `get_line_feed_shortages`. The AJ-3 data proves it in Task 52.

---

# Phase B — the traveler scan

Package names: `mes` (apps/mes), `@carbon/documents`, `@carbon/react`. Each has the `test` script `vitest run`.

## Task 7: Encode the traveler link in the default label QR

**Depends on:** none
**Files:**
- Modify: `packages/documents/src/pdf/blocks/trackingLabel/vars.ts` — add the `label.travelerUrl` variable
- Modify: `packages/documents/src/template/mergeFields.ts` — add the merge field to `TRACKING_LABEL_MERGE_FIELDS`
- Modify: `packages/documents/src/template/defaults.ts` (about line 467) — change the `labelCode` value
- Modify: `packages/documents/src/zpl/ProductLabelZPL.tsx` — size the QR slot from the value length
- Modify: `packages/documents/src/zpl/productLabelZPL.test.ts` — change the assertion at about line 74, add 1 test
- Copy from (precedent): `packages/documents/src/pdf/blocks/jobTraveler/OperationsBlock.tsx` (imports `getMESUrl` from `@carbon/env`)

**Steps:**
1. In `vars.ts`, import `getMESUrl` from `@carbon/env`.
2. In `buildLabelVars`, add `"label.travelerUrl"`.
3. Set it to `` `${getMESUrl()}/x/traveler/${item.trackedEntityId}` ``. Set it to `""` when `trackedEntityId` is empty.
4. In `mergeFields.ts`, add `value("label.travelerUrl", "Traveler Link", "Label")` after `label.trackedEntityId`.
5. In `defaults.ts` `labelBlocks()`, set the `labelCode` value to `"{label.travelerUrl}"`.
6. Keep the `labelEntityId` value as `"{label.trackedEntityId}"`.
7. Keep the schema default in `schema.ts:181`, so saved and new custom blocks keep the raw ID.
8. In `ProductLabelZPL.tsx`, add the pure function `qrModuleCount(byteLength: number): number`.
9. In `qrModuleCount`, use the level-M byte capacities `[14, 26, 42, 62, 84, 106, 122, 152, 180, 213]`. Return `17 + 4 * version`.
10. Compute `qrPixelSize` from `qrModuleCount` of the interpolated QR value. Do not use the constant 29.
11. In `productLabelZPL.test.ts`, change the `^FDMA,` assertion to `toContain("/x/traveler/dtClCvNm9blDY0H3FXmDC")`.
12. Add a test: a 54-byte value gives 33 modules on `label2x1`. Compute the expected `^FO` x by hand from `getZplLabelGeometry`.

If the ZPL QR block reads its value somewhere other than line 133 (`interpolateString(block.value, vars)`), STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/documents test src/zpl/productLabelZPL.test.ts src/pdf/productLabelPDF.test.ts
# Expected: "Test Files  2 passed"
pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: "Tasks: N successful, N total", no TS errors
```

**Out of scope:** BinderyPress templates, saved `documentTemplate` rows, and the label renderer call sites. They need no change, because `buildLabelVars` reads `getMESUrl()` itself.

---

## Task 8: Add the pure traveler helpers with tests

**Depends on:** none
**Files:**
- Create: `apps/mes/app/utils/traveler.ts`
- Create: `apps/mes/app/utils/traveler.test.ts`
- Copy from (precedent): `apps/mes/app/utils/kanban.ts`, `apps/mes/app/utils/kanban.test.ts`

**Steps:**
1. Add `parseTravelerCode(input: string): string | null`.
2. Parse with `new URL`, so the origin does not matter. Match `url.pathname` against `^/x/traveler/([^/?#]+)/?$`.
3. Return the decoded id. Return null for `resolve`, for a value that is not a URL, and for any other path.
4. Add `pickTravelerOperation(args: { operations: { id: string; workCenterId: string | null; operationOrder: number }[]; workCenterId: string | null })`.
5. Make it return `{ kind: "open"; operationId } | { kind: "choose"; operationIds: string[] } | { kind: "none" }`.
6. If `workCenterId` matches 1 operation, return `open`. If it matches 2 or more, return `choose` with those operations.
7. Else take the operations with the lowest `operationOrder`. Return `open` for 1 operation and `choose` for 2 or more.
8. If `operations` is empty, return `none`.
9. Add `travelerIssueCandidates(args)`. Its inputs are `operations` (`id, jobMakeMethodId, workCenterId, operationOrder, jobDueDate`), `materials` (`jobMakeMethodId, jobOperationId, quantity, estimatedQuantity, quantityIssued`) and `workCenterId`.
10. Make it return the operation ids in order.
11. Keep a material only when `(quantityIssued ?? 0) < (estimatedQuantity ?? quantity)`.
12. Map each material to its `jobOperationId`. If that is null, map it to the open operation of its make method with the highest `operationOrder`.
13. Drop a material whose operation is not in `operations`. Remove duplicate operation ids.
14. Sort: the operator's work center first, then `jobDueDate` ascending with nulls last, then `operationOrder`.
15. Add `travelerScanAction(args: { scannedStatus; targetTrackedEntityId; targetStatus; targetJobMakeMethodId; operationJobMakeMethodId })`.
16. Make it return `{ kind: "issue" } | { kind: "open"; trackedEntityId } | { kind: "navigate" }`.
17. If `scannedStatus` is `Available`, return `issue`.
18. If the target is `Reserved` and its make method is `operationJobMakeMethodId`, return `open`.
19. Return `navigate` for every other case.
20. Write 1 `describe` per function, with ids written by hand.
21. Cover 7 cases:
    - another origin
    - a raw id
    - 2 operations at the station
    - parallel operations with equal order
    - a null `jobOperationId`
    - a fully issued material
    - a consumed unit inside this job

**Verify:**
```bash
pnpm --filter mes test app/utils/traveler.test.ts
# Expected: "Test Files  1 passed"
```

**Out of scope:** database reads. These helpers take plain data only.

---

## Task 9: Keep a scan pending while `onUnrecognized` runs

**Depends on:** none
**Files:**
- Modify: `packages/react/src/hooks/useKeyboardWedge.ts` — lines 25, 133, 224
- Modify: `packages/react/src/__tests__/useKeyboardWedgeDom.test.tsx` — add 1 test
- Copy from (precedent): the test "stays pending until the action settles…" (about line 202)

**Steps:**
1. Change the type of `onUnrecognized` to `(input: string) => unknown` in both declarations.
2. At line 224, keep the return value of `onUnrecognized`.
3. If that value is a `Promise`, do the `setPending`, timeout and settle steps that `run` does.
4. Extract a shared `track(result: unknown)` from `run`, so the code exists only once.
5. Add a test: `onUnrecognized` returns an unresolved promise. `pending` is true, a second scan is ignored, and `pending` is false after the promise resolves.

**Verify:**
```bash
pnpm --filter @carbon/react test src/__tests__/useKeyboardWedgeDom.test.tsx
# Expected: "Test Files  1 passed"
pnpm exec turbo run typecheck --filter=@carbon/react
# Expected: no TS errors
```

**Out of scope:** the burst timing and the order of handlers.

---

## Task 10: Add traveler paths and server reads

**Depends on:** Tasks 5, 8
**Files:**
- Modify: `apps/mes/app/utils/path.ts` — add 3 entries
- Create: `apps/mes/app/services/traveler.server.ts`
- Copy from (precedent): `apps/mes/app/services/printing.server.ts` (service-role type, logger)

**Steps:**
1. In `path.ts`, add `traveler: (id: string) => generatePath(`${x}/traveler/${id}`)`.
2. Add `travelerResolve: `${x}/traveler/resolve``.
3. Add `erpTraceability: (id: string) => `${getAppUrl()}${x}/traceability/graph?trackedEntityId=${id}``.
4. In `traveler.server.ts`, add `getTravelerTarget(client, args: { trackedEntityId: string; companyId: string })`.
5. Make it call `client.rpc("get_traveler_target", { p_tracked_entity_id, p_company_id })`. Return the first row or null.
6. Add `findTrackedEntityByCode(client, args: { code: string; companyId: string })`.
7. Make it return `{ kind: "found"; entity } | { kind: "notFound" } | { kind: "ambiguous" }`.
8. Read `trackedEntity` by `id` and `companyId` first.
9. If no row matches, read by `readableId` and `companyId` with `.limit(2)`.
10. If 2 rows match, return `ambiguous`. Never build a PostgREST `.or()` string from scanned text.
11. Add `resolveTravelerMaterial(client, args: { companyId; jobOperationId; trackedEntityId })`.
12. Make it return `{ materialId: string; quantity: number } | { refusal: string }`.
13. Read the unit (`id, status, quantity, itemId`) for the company. If it is missing, refuse with "This label does not belong to a unit in this company".
14. If the status is not `Available`, refuse with `This unit is ${status} and cannot be issued`.
15. Read the `jobOperation` for the company to get `jobMakeMethodId`.
16. Read the `jobMaterial` rows of that make method whose `itemId` is the unit's item.
17. Prefer the row whose `jobOperationId` is this operation. Else take a row whose `jobOperationId` is null.
18. If no row exists, read `item.readableIdWithRevision`. Refuse with `This job does not use ${readableId}`.
19. If the material has `requiresBatchTracking`, refuse with "Issue batch lots from the Issue dialog".
20. Return `{ materialId, quantity: unit.quantity }`.

If `get_traveler_target` is not in the `Functions` of `packages/database/src/types.ts`, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** the SQL function (Task 2).

---

## Task 11: Add the raw-ID resolve route and the layout wedge changes

**Depends on:** Tasks 8, 9, 10
**Files:**
- Create: `apps/mes/app/routes/x+/traveler.resolve.tsx`
- Modify: `apps/mes/app/routes/x+/_layout.tsx` (about lines 440-447) — the wedge `test` and `onUnrecognized`
- Copy from (precedent): `apps/mes/app/routes/x+/rework-targets.$operationId.tsx` (resource loader); the `completeFetcher.load` and `processedFetcherData` patterns in `JobOperation.tsx:716-745` and `IssueMaterialModal.tsx:1172-1182`

**Steps:**
1. Write the resolve loader as a GET with no default export.
2. Call `requirePermissions(request, {})` to get `companyId`.
3. Read `code` from the query and trim it. If it is empty, return `{ status: "notFound" }`.
4. Set `id = parseTravelerCode(code) ?? code`.
5. Call `findTrackedEntityByCode(getCarbonServiceRole(), { code: id, companyId })`.
6. If the result is `notFound` or `ambiguous`, return `{ status }` with that result.
7. Else call `getTravelerTarget`.
8. Return `{ status: "found", trackedEntityId, scannedStatus, scannedItemId, target }`.
9. In `_layout.tsx`, read `useLocation().pathname`.
10. Make the wedge `test` refuse a `parseTravelerCode` match when the path starts with `/x/operation/` or `/x/assembly/`.
11. Add `const resolveFetcher = useFetcher<typeof resolveLoader>()`.
12. In `onUnrecognized`: if `parseTravelerCode(input)` returns an id, return `navigate(path.to.traveler(id))`.
13. Else return `resolveFetcher.load(`${path.to.travelerResolve}?code=${encodeURIComponent(input)}`)`.
14. Add an effect that handles each new `resolveFetcher.data` value once.
15. If `status` is `found`, navigate to `path.to.traveler(trackedEntityId)`.
16. If `status` is `ambiguous`, toast "This barcode matches more than one unit".
17. Else toast "Nothing on this page uses that barcode", as the layout does today.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** scans inside text fields. The wedge keeps those in the field by design.

---

## Task 12: Add the traveler wrong-item check to `issue-tracked-entity`

**Depends on:** Task 10
**Files:**
- Modify: `apps/mes/app/services/models.ts` (about line 221) — add `travelerScan: z.boolean().optional()` to `issueTrackedEntityValidator`
- Modify: `apps/mes/app/routes/x+/issue-tracked-entity.tsx`
- Copy from (precedent): the `abilityBlockRefusal` block in the same route

**Steps:**
1. If `travelerScan` is true, require `jobOperationId`, `parentTrackedEntityId` and exactly 1 child.
2. If one is missing, return 400 with "Failed to validate payload".
3. Call `resolveTravelerMaterial(serviceRole, { companyId, jobOperationId, trackedEntityId: children[0].trackedEntityId })`.
4. If it returns `refusal`, return `data({ success: false, message: refusal }, { status: 400 })`.
5. Else replace `materialId` and `children[0].quantity` with the resolved values. Drop `itemId`.
6. Keep the ability check and the posting call as they are.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** payloads without `travelerScan`. The Issue dialog and batch mode keep today's behavior. The ERP posting.

---

## Task 13: Build the traveler route and its chooser

**Depends on:** Tasks 8, 10, 12
**Files:**
- Create: `apps/mes/app/routes/x+/traveler.$trackedEntityId.tsx`
- Modify: `apps/mes/app/components/OperationsList.tsx` — add optional `getHref`, `onSelect` and `selectedId`
- Copy from (precedent): page shell and list grid `apps/mes/app/routes/x+/recent.tsx`; cards `apps/mes/app/components/OperationsList.tsx`; station and day `apps/mes/app/routes/x+/operations.tsx:279-305`; redirect route `apps/erp/app/routes/api+/kanban.start.$id.tsx`; empty state `apps/mes/app/components/MesEmptyState.tsx`

**Steps:**
1. In `OperationsList`, add `getHref?: (op) => string`, `onSelect?: (op) => void` and `selectedId?: string`.
2. If `onSelect` is set, make `OperationCard` render a `button` in place of the `Link`. Give the selected card `ring-2 ring-primary`.
3. If `getHref` is set, use it in place of `path.to.operation(op.id)`.
4. In the loader, call `requirePermissions(request, {})`.
5. Read `locationId` and `effectiveUserId` from `context.get(userContext)`.
6. Call `getTravelerTarget`. If it returns null, return `{ kind: "notFound" }`.
7. Read the target unit (`readableId, status, itemId, attributes`) and its item (`readableIdWithRevision, name`) for the company.
8. Compute `today` from `datetime.today(await getLocationTimeZone(serviceRole, locationId, companyId))`.
9. Call `getMyPeopleAssignment`. Take `data?.[0]?.workCenterId ?? null`.
10. Call `getActiveJobOperationsByLocation(serviceRole, locationId, [])`. Map the rows with `makeDurations`.
11. If the status is `Reserved` and `jobMakeMethodId` is set, keep the rows of that make method.
12. Drop each row where `isSerialEntityIncompleteForOperation(unit, row.id)` is false.
13. Call `pickTravelerOperation` on the rows that are left.
14. If it returns `open`, throw a redirect to `${path.to.operation(id)}?trackedEntityId=${unit}`.
15. If it returns `choose`, return `{ kind: "chooseOperation", unit, operations }`.
16. If it returns `none`, return `{ kind: "info", unit }`.
17. If the status is `Available`, read the `jobMaterial` rows whose `itemId` is the unit's item and whose `jobMakeMethodId` is in the rows.
18. Call `travelerIssueCandidates`. Take the first 10 ids.
19. For each candidate, call `getTrackedEntitiesForOperation`. Use `getNextIncompleteSerialEntity` to get `parentTrackedEntityId`.
20. Drop a candidate that has no parent unit.
21. If no candidate is left, read the bin through `resolveTrackedEntityBins` from `@carbon/utils`. Return `{ kind: "info", unit, storageUnitName }`.
22. Else return `{ kind: "chooseIssue", unit, candidates }`.
23. If the status is any other value, return `{ kind: "status", unit }`.
24. In the component, show "This label does not belong to a unit in this company" for `notFound`.
25. For `status`, show the status in `MesEmptyState`.
26. For `info`, show the readable ID, the item, the bin and a link to `path.to.erpTraceability(id)`.
27. For `chooseOperation`, render `OperationsList` with `getHref` set to the `?trackedEntityId` link.
28. For `chooseIssue`, preselect the first candidate. Render one primary button, "Issue to {jobReadableId}".
29. On press, `fetcher.submit` the JSON `{ travelerScan: true, jobOperationId, parentTrackedEntityId, children: [{ trackedEntityId, quantity: 1 }] }` to `path.to.issueTrackedEntity`.
30. If the response has `success`, navigate to `${path.to.operation(id)}?trackedEntityId=${parent}`.
31. Else toast `message`.
32. Use the Lingui `t` or `Trans` macro for every new string.

If the `get_active_job_operations_by_location` rows are not assignable to `Operation` after `makeDurations`, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** units at another location (they show `info`), batch lots (Task 12 refuses them), and a device-station concept.

---

## Task 14: Issue a traveler scan on the operation screens

**Depends on:** Tasks 8, 11, 12
**Files:**
- Create: `apps/mes/app/components/JobOperation/hooks/useTravelerScan.ts`
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` — add the hook after the kanban wedge (about line 748)
- Modify: `apps/mes/app/components/AssemblyView.tsx` — add the hook after `abilityBlocked` (about line 1930)
- Copy from (precedent): the kanban wedge in `JobOperation.tsx:716-748` and `AssemblyView.tsx:617-645`

**Steps:**
1. Write `useTravelerScan(args: { operationId; jobMakeMethodId; parentTrackedEntityId: string | undefined; jobOperationStepId?; unitNumber?; active: boolean })`.
2. In the hook, call `useKeyboardWedge` with `test: (input) => !!parseTravelerCode(input)`, `inTextFields: true` and `active`.
3. Make the callback return `lookupFetcher.load(`${path.to.travelerResolve}?code=${encodeURIComponent(input)}`)`.
4. Add an effect that handles each new `lookupFetcher.data` value once.
5. If the status is not `found`, toast "This label does not belong to a unit in this company".
6. Else call `travelerScanAction` with `operationJobMakeMethodId: jobMakeMethodId`.
7. For `issue`, call `issueFetcher.submit` with the JSON `{ travelerScan: true, jobOperationId, parentTrackedEntityId, children: [{ trackedEntityId, quantity: 1 }], jobOperationStepId, unitNumber }`.
8. If the issue response has `success`, toast "Issued". Else toast `message`.
9. For `open`, call `navigate(`${path.to.operation(operationId)}?trackedEntityId=${id}`)`.
10. For `navigate`, call `navigate(path.to.traveler(scannedId))`.
11. In `JobOperation.tsx`, pass `parentTrackedEntityId: trackedEntityId` (line 283) and `jobMakeMethodId: operation.jobMakeMethodId`.
12. Pass `active: !issueModal.isOpen && !isBatched && !abilityBlocked`.
13. In `AssemblyView.tsx`, pass `parentTrackedEntityId: currentEntity?.id ?? trackedEntities[0]?.id` and `unitNumber: activeIndex + 1`.
14. Pass `jobOperationStepId: step?.id` and `active: !issueModal.isOpen && !abilityBlocked`.

If the layout wedge from Task 11 still takes the scan on `/x/operation/…`, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** raw-ID scans on the operation screen (the layout sends them to the traveler route), and the kanban wedge.

---

## Task 15: Read traveler links in the Issue dialog Scan tab

**Depends on:** Task 8
**Files:**
- Modify: `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx` — the serial input `onChange` (about line 1521) and the batch input `onChange` (about line 1788)
- Copy from (precedent): `resolveScannedBatchId` in the same file (about line 508)

**Steps:**
1. In the serial `onChange`, set `newValue = parseTravelerCode(e.target.value) ?? e.target.value`.
2. In the batch `onChange`, call `resolveScannedBatchId(parseTravelerCode(e.target.value) ?? e.target.value)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** the Select tab and the Scrap tab.

---

# Phase C — test data (`motor-line`)

`motor` is a live onboarding template (`industryId: "automotive_precision"`). The AJ-3 line goes in a new dev-only dataset `motor-line` = `motor` + AJ-3. Every tier change below runs only when its new optional field is set, so the other datasets load unchanged.

## Task 16: Add the optional dataset fields to `types.ts`

**Depends on:** none
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — add 6 optional fields and 1 new type

**Steps:**
1. In `BomLineSpec`, add `operation?: number`. Doc comment: "The `order` of a bop operation in the same method; written as `methodOperationId`."
2. In `KanbanItemSpec`, add `replenishmentLevel?: number`. Doc comment: "Transfer kanbans only."
3. In `TrackedStockSpec`, add `shelf?: string`. Doc comment: "When set, tier 03 writes the opening ledger of this item at this shelf per lot."
4. In `JobSpec`, add `serials?: string[]`. Doc comment: "Serial items only: one readableId per unit, as `assignSerialNumbers` numbers them."
5. In `SerialSequenceSpec`, add `serialNumberTiming?: "jobCreation" | "jobRelease" | "production"`.
6. In `SerialSequenceSpec`, add `printLabelOnCompletion?: boolean`.
7. Add `export type LineFlowSpec = { travelerLabels: boolean; requireTrackedMaterialsIssued: boolean; autoPickingListOnRelease: boolean }`.
8. In `FoundationData`, add `lineFlow?: LineFlowSpec`. Doc comment: "Line-flow company settings."

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 failed
```

**Out of scope:** `ShelfSpec.workCenter`. Tier 01 already makes one station bin per work center. Do not make any field required.

---

## Task 17: Validate the new fields, with a unit test

**Depends on:** Task 16
**Files:**
- Modify: `packages/database/src/datasets/validate.ts`
- Create: `packages/database/src/datasets/validate-line-flow.test.ts`
- Copy from (precedent): `packages/database/src/datasets/validate-seed-extensions.test.ts`

**Steps:**
1. In the `refs` object (`validate.ts:1168`), add `wc:${w.name}` for each `f.workCenters` entry to the `shelf` set.
2. In the `items` rule (`validate.ts:1660`), fail for a BOM line whose `operation` matches no `op.order` in the same method's `bop`.
3. Use the message `items.methods "<id>" bom "<component>": operation <n> is not a bop order`.
4. In the kanban loop (`validate.ts:2309`), fail when `replenishmentLevel` is set on a kanban that is not Transfer.
5. Fail when `replenishmentLevel` is not an integer of 0 or more.
6. In the `onHandTracked` loop (`validate.ts:2254`), if `tracked.shelf` is set, call `need("shelf", where, tracked.shelf)`.
7. If `tracked.shelf` is set, fail when an entity is `Scrapped`.
8. If `tracked.shelf` is set, fail when the entity quantities do not sum to the `openingStock` quantity at (item, shelf).
9. In the `jobs` rule, if `job.serials` is set, fail when the item is not Serial-tracked.
10. Fail when `serials.length` does not equal `job.quantity`.
11. Fail when a serial repeats across jobs or equals an `onHandTracked` readableId.
12. Write the test with a `withLineFlow(patch)` helper over a shallow copy of `motor`, as `withExtensions` does.
13. Add one test per rule above. Each test asserts one violation that contains the field name.
14. Add one test that asserts `validateDataset(motor)` returns `[]`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/datasets/validate-line-flow.test.ts src/datasets/validate-seed-extensions.test.ts
# Expected: all tests pass, 0 failed
```

**Out of scope:** existing rule messages and `coverage.ts`.

---

## Task 18: Write the line-flow settings in tier 01

**Depends on:** Tasks 5, 16
**Files:**
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` — after the inspection/rejected `UPDATE "location"` (about line 238)

**Steps:**
1. 🛑 If the 3 columns are missing from `companySettings` in `packages/database/src/types.ts`, STOP and report.
2. Read `const flow = data.lineFlow`.
3. Add `ctx.log("line flow settings")`.
4. Run `UPDATE "companySettings" SET` the 3 columns `WHERE id = $4`. Use `flow?.<column> ?? false` for each column.
5. Write the 3 values on every apply, so applying another dataset turns them off again.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm db:check:datasets
# Expected: typecheck successful; every dataset "✓"
```

**Out of scope:** the cutover upsert at the top of tier 01.

---

## Task 19: Link BOM lines to their operation in tier 02

**Depends on:** Task 16
**Files:**
- Modify: `packages/database/src/datasets/helpers/items.ts` — `addBomLine` opts take `methodOperationId?: string`
- Modify: `packages/database/src/datasets/tiers/02-items.ts` — the `for (const method of data.methods)` loop (about lines 258-313)

**Steps:**
1. In `addBomLine`, add `methodOperationId?: string` to `opts`.
2. Pass `methodOperationId: opts.methodOperationId ?? null` to the `methodMaterial` insert.
3. In tier 02, move the `method.bop` loop above the `method.bom` loop.
4. In the bop loop, store each `operationId` in `const opIdByOrder: Record<string, string>` under `String(op.order)`.
5. In the bom loop, pass `methodOperationId: line.operation === undefined ? undefined : need(opIdByOrder, String(line.operation), "bop order")`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm db:check:datasets
# Expected: typecheck successful; every dataset "✓"
```

**Out of scope:** `helpers/method-copy.ts`. It already maps `methodOperationId` to `jobMaterial.jobOperationId`.

---

## Task 20: Write per-lot opening ledger rows and kanban levels in tier 03

**Depends on:** Task 16
**Files:**
- Modify: `packages/database/src/datasets/tiers/03-inventory.ts`

Today tier 03 writes the opening `itemLedger` rows with no `trackedEntityId`, so seeded lots are invisible to the pick and issue screens.

**Steps:**
1. Before the opening loop, build `lotted = new Set(onHandTracked.filter(s => s.shelf).map(s => `${s.item}@${s.shelf}`))`.
2. In the opening loop, skip the ledger insert for an entry whose `${entry.item}@${entry.shelf}` is in `lotted`.
3. Keep the `pickMethod` loop unchanged. It still reads every `openingStock` row.
4. In the lots loop, check `stock.shelf` after each `trackedEntity` insert.
5. If `stock.shelf` is set, insert an `itemLedger` row: `Positive Adjmt.`, `Inventory Receipt`, comment "Opening balance".
6. Set its `storageUnitId` to `need(ctx.refs.shelves, stock.shelf)` and its `trackedEntityId` to the new entity id.
7. Set its `quantity` to `entity.quantity` and its `locationId` to `plantId`.
8. In the kanban insert, add `replenishmentLevel: system === "Transfer" ? kb.replenishmentLevel : undefined`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm db:check:datasets
# Expected: typecheck successful; every dataset "✓"
```

**Out of scope:** the existing motor magnet and copper lots. `scrapLot`.

---

## Task 21: Split serial job units in tier 06

**Depends on:** Task 16
**Files:**
- Modify: `packages/database/src/datasets/tiers/06-production.ts` — new `splitSerialUnits(ctx, jobId, serials)`, called before the `UPDATE "trackedEntity"` rename (about line 139)
- Copy from (precedent): `assignSerialNumbers` step 8 in `apps/erp/app/modules/production/production.service.ts:14438-14476`

Today the seed keeps 1 Reserved entity with quantity = job quantity, so a 2-unit job would print 1 traveler.

**Steps:**
1. If `spec.serials` is set, call `splitSerialUnits(ctx, id, spec.serials)` before the rename query.
2. Select the root entity with the same join as the rename query (`jmm."parentMaterialId" IS NULL`).
3. If the select returns 0 rows or 2 or more, throw `Seed: job "<key>" has <n> root tracked entities, expected 1`.
4. Run `UPDATE "trackedEntity" SET "readableId" = serials[0], quantity = 1 WHERE id = $seed AND "companyId" = $c`.
5. For each later serial at index n, insert a copy with `INSERT INTO "trackedEntity" (...) SELECT ... FROM "trackedEntity" WHERE id = $seed AND "companyId" = $c`.
6. Copy these columns: `sourceDocument`, `sourceDocumentId`, `sourceDocumentReadableId`, `status`, `attributes`, `itemId`, `companyId`, `createdBy`.
7. Set `quantity = 1`, `readableId = serials[n]` and `"createdAt" = "createdAt" + n * interval '1 millisecond'`.
8. Keep the rename query. Its `readableId IS NULL` guard skips split jobs.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm db:check:datasets
# Expected: typecheck successful; every dataset "✓"
```

**Out of scope:** the existing serial jobs of other datasets. The split runs only when `serials` is set.

---

## Task 22: Write timing and print-on-completion on serial sequences in tier 10

**Depends on:** Tasks 5, 16
**Files:**
- Modify: `packages/database/src/datasets/tiers/10-ops.ts` — the `itemSerialSequence` insert (about lines 143-151)

**Steps:**
1. 🛑 If `printLabelOnCompletion` is missing from `itemSerialSequence` in `packages/database/src/types.ts`, STOP and report.
2. Add `serialNumberTiming: spec.serialNumberTiming` to the insert values.
3. Add `printLabelOnCompletion: spec.printLabelOnCompletion` to the insert values.
4. Leave both `undefined` when the spec omits them, so `insertRow` drops them.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm db:check:datasets
# Expected: typecheck successful; every dataset "✓"
```

**Out of scope:** the company `serialNumberTiming` (its default is `jobCreation`).

---

## Task 23: Register the dev-only dataset `motor-line`

**Depends on:** Task 16
**Files:**
- Create: `packages/database/src/datasets/data/motor-line/index.ts`
- Create: `packages/database/src/datasets/data/motor-line/aj3.ts` — empty arrays at first; Tasks 24–27 fill them
- Modify: `packages/database/src/datasets/types.ts` — add `"motor-line"` to `DatasetKey` (about line 2728)
- Modify: `packages/database/src/datasets/index.ts` — add `motorLine` to `DATASETS` (about line 36)
- Modify: `packages/database/src/datasets/tiers/workflow-definitions.ts` — map `"motor-line"` to the `motor` builder in `SEED_WORKFLOW_BUILDERS`
- Copy from (precedent): `packages/database/src/datasets/data/motor/index.ts`

**Steps:**
1. In `aj3.ts`, export the 15 arrays below. Tasks 24–27 fill them: `AJ3_PROCESSES`, `AJ3_WORK_CENTERS`, `AJ3_WORK_CENTER_PROCESS_LINKS`, `AJ3_WORK_CENTER_SHIFTS`, `AJ3_WAREHOUSES`, `AJ3_SHELVES`, `AJ3_MAKE_PARTS`, `AJ3_BUY_PARTS`, `AJ3_METHODS`, `AJ3_SUPPLIER_PARTS`, `AJ3_OPENING_STOCK`, `AJ3_ON_HAND_TRACKED`, `AJ3_KANBAN_ITEMS`, `AJ3_JOBS`, `AJ3_SERIAL_SEQUENCES`.
2. Type each array with the matching spec type from `types.ts`.
3. In `index.ts`, export `motorLine: Dataset` built from `motor`.
4. Set `key: "motor-line"`, `label: "Motor line (dev)"` and `industryId: null`.
5. Concatenate each AJ-3 array after the matching `motor` array, field by field.
6. Set `foundation.lineFlow` to `{ travelerLabels: true, requireTrackedMaterialsIssued: true, autoPickingListOnRelease: true }`.
7. Register the key and the dataset in the 3 files above.

If the `Dataset` shape does not allow a field-by-field concat (for example, a field is a function), STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 failed
pnpm db:check:datasets -- --dataset motor-line
# Expected: "✓ motor-line"
```

**Out of scope:** any change to `data/motor/`. Onboarding (`datasetForIndustry` never picks a dataset with `industryId: null`).

---

## Task 23a: Let a dev-only dataset borrow an industry's bundled assets

Added during execution (2026-11-12). With `industryId: null`, tier 02 skips the motor CAD assembly, so 6 coverage floors fail for `motor-line` (`assemblyComponentMapping`, `assemblyInstruction`, `assemblyInstructionStep`, `assemblyInstructionStepMaterial`, `assemblyInstructionStepTool`, `modelUpload`).

**Depends on:** Task 23
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — add `assetIndustryId?: string` to `Dataset`
- Modify: `packages/database/src/datasets/tiers/02-items.ts` (`seedAssembly`, about line 55)
- Modify: `packages/database/src/datasets/helpers/items.ts` (`thumbnailPath`, about line 65)
- Modify: `packages/database/src/datasets/validate.ts` (the assembly graph check, about line 4905)
- Modify: `packages/database/src/datasets/data/motor-line/index.ts` — set `assetIndustryId: "automotive_precision"`

**Steps:**
1. Add `assetIndustryId?: string` to `Dataset`. Doc comment: "Industry folder for bundled assets (CAD model, thumbnails); defaults to `industryId`. Lets a dev-only dataset reuse an industry's assets."
2. In each of the 3 code sites, read the folder as `dataset.assetIndustryId ?? dataset.industryId`.
3. In `motor-line`, set `assetIndustryId` to the `industryId` of `motor`, and keep `industryId: null`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 failed
pnpm db:check:datasets
# Expected: ✓ for every dataset, motor-line included
```

**Out of scope:** `datasetForIndustry` (it still never picks a dataset with `industryId: null`) and `coverage.ts`.

---

## Task 24: Add the AJ-3 work centers, processes, bins and settings

**Depends on:** Tasks 17, 18, 23
**Files:**
- Modify: `packages/database/src/datasets/data/motor-line/aj3.ts`

**Steps:**
1. Fill `AJ3_PROCESSES`:

| name | factor | type |
|---|---|---|
| AJ Machining | Minutes/Piece | Process |
| AJ Welding | Minutes/Piece | Process |
| AJ Assembly | Minutes/Piece | Assembly |
| AJ Balancing | Minutes/Piece | Process |
| AJ Test | Minutes/Piece | Process |
| AJ Inspection | Minutes/Piece | Inspection |

2. Fill `AJ3_WORK_CENTERS` with 15 work centers: A1, A2, A3, A4, B1, B2, B3, B4, M, F1, F2, F3, F4, F5, F6.
3. Give each work center `dept: "Assembly"`, `ability: "Precision Assembly"`, `laborRate: 60`, `machineRate: 0`.
4. Fill `AJ3_WORK_CENTER_PROCESS_LINKS`:

| Work center | Processes |
|---|---|
| A1 | AJ Machining, AJ Welding |
| A2 | AJ Assembly, AJ Machining |
| A3 | AJ Test, AJ Assembly |
| A4 | AJ Test, AJ Inspection |
| B1, B2, B3, M, F1, F2, F3, F4, F5 | AJ Assembly |
| B4 | AJ Balancing |
| F6 | AJ Test, AJ Inspection |

5. Fill `AJ3_WORK_CENTER_SHIFTS` with `[<wc>, "A Shift"]` for all 15 work centers.
6. Fill `AJ3_WAREHOUSES` with `{ key: "WH1", name: "Warehouse 1", requiresBin: true }`.
7. Fill `AJ3_SHELVES`, in this order:

| name | warehouse | storageType | parent |
|---|---|---|---|
| WH1-Rack-A | WH1 | Rack | |
| WH1-A1 | WH1 | Bin | WH1-Rack-A |
| WH1-A2 | WH1 | Bin | WH1-Rack-A |
| WH1-A3 | WH1 | Bin | WH1-Rack-A |
| WH1-Rack-B | WH1 | Rack | |
| WH1-B1 | WH1 | Bin | WH1-Rack-B |
| WH1-B2 | WH1 | Bin | WH1-Rack-B |

8. Do not author station bins. Tier 01 makes "A1 Floor" through "F6 Floor" (refs `wc:A1` through `wc:F6`).

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/datasets/validate-line-flow.test.ts
# Expected: the motor tests pass. motor-line shows only floor violations, for example 'work center "A1" has 0 open operations, need ≥ 2'. Tasks 25–27 clear them.
```

**Out of scope:** the existing motor work centers, warehouses and shelves.

---

## Task 25: Add the AJ-3 items, methods and supplier links

**Depends on:** Tasks 19, 24
**Files:**
- Modify: `packages/database/src/datasets/data/motor-line/aj3.ts`

**Steps:**
1. Fill `AJ3_MAKE_PARTS` with `type: "Part"`, `replenishment: "Make"`, `trackingType: "Serial"`:

| readableId | name | standardCost | unitSalePrice | thumbnail |
|---|---|---|---|---|
| AJ3-ENG | AJ-3 Turbojet Engine | 18500 | 32000 | MTR-9000 |
| AJ3-CC | AJ-3 Combustion Chamber | 2400 | 4200 | STA-9000 |
| AJ3-FIA | AJ-3 Fuel Injector Assembly | 640 | 1100 | (omit) |

2. Fill `AJ3_BUY_PARTS` with `type: "Part"`, `replenishment: "Buy"`, `leadTime: 30`:

| readableId | name | trackingType | standardCost | thumbnail |
|---|---|---|---|---|
| AJ3-BRG-F | AJ-3 Front Shaft Bearing | Batch | 85 | BRG-6206-C3 |
| AJ3-BRG-R | AJ-3 Rear Shaft Bearing | Batch | 95 | BRG-6308-C3 |
| AJ3-HSG-F | AJ-3 Front Housing | Inventory | 1250 | HSG-9000 |
| AJ3-SHF | AJ-3 Main Shaft | Inventory | 420 | SHF-9000 |
| AJ3-CMP-W | AJ-3 Compressor Wheel | Inventory | 1800 | (omit) |
| AJ3-DIF | AJ-3 Diffuser | Inventory | 650 | (omit) |
| AJ3-NGV | AJ-3 Nozzle Guide Vane Ring | Inventory | 2100 | (omit) |
| AJ3-TRB-W | AJ-3 Turbine Wheel | Inventory | 3200 | (omit) |
| AJ3-EXH | AJ-3 Exhaust Cone | Inventory | 380 | (omit) |
| AJ3-FLN | AJ-3 Fuel Line Kit | Inventory | 140 | (omit) |
| AJ3-LNR | AJ-3 Combustion Liner Blank | Inventory | 520 | (omit) |
| AJ3-IGN | AJ-3 Igniter Plug | Inventory | 75 | (omit) |
| AJ3-INJ-BDY | AJ-3 Injector Body Blank | Inventory | 110 | (omit) |
| AJ3-NOZ | AJ-3 Injector Nozzle Tip | Inventory | 60 | (omit) |

3. Fill `AJ3_METHODS` with method `AJ3-FIA`. Every BOM line has quantity 1. `laborTime` is in hours.

| order | process | workCenter | description | laborTime | BOM (operation = this order) |
|---|---|---|---|---|---|
| 1 | AJ Machining | A1 | Machine injector body | 0.5 | AJ3-INJ-BDY |
| 2 | AJ Assembly | A2 | Fit nozzle tip | 0.5 | AJ3-NOZ |
| 3 | AJ Test | A3 | Flow test injector | 0.5 | |
| 4 | AJ Inspection | A4 | Inspect injector | 0.25 | |

4. Add method `AJ3-CC`:

| order | process | workCenter | description | laborTime | BOM |
|---|---|---|---|---|---|
| 1 | AJ Welding | A1 | Weld combustion liner | 0.75 | AJ3-LNR |
| 2 | AJ Machining | A2 | Drill liner cooling holes | 0.5 | |
| 3 | AJ Assembly | A3 | Install fuel injector and igniter | 0.5 | AJ3-FIA (`methodType: "Pull from Inventory"`), AJ3-IGN |
| 4 | AJ Test | A4 | Pressure test chamber | 0.5 | |
| 5 | AJ Inspection | A4 | Inspect chamber | 0.25 | |

5. Add method `AJ3-ENG`:

| order | process | workCenter | description | laborTime | BOM |
|---|---|---|---|---|---|
| 1 | AJ Assembly | B1 | Prepare front housing | 0.5 | AJ3-HSG-F |
| 2 | AJ Assembly | B2 | Press bearings onto main shaft | 0.5 | AJ3-SHF, AJ3-BRG-F, AJ3-BRG-R |
| 3 | AJ Assembly | B3 | Fit compressor wheel and diffuser | 0.5 | AJ3-CMP-W, AJ3-DIF |
| 4 | AJ Balancing | B4 | Balance rotor group | 0.75 (`machineTime: 0.5`) | |
| 5 | AJ Assembly | M | Merge: install combustion chamber | 0.75 | AJ3-CC (`methodType: "Pull from Inventory"`) |
| 6 | AJ Assembly | F1 | Fit nozzle guide vane ring | 0.5 | AJ3-NGV |
| 7 | AJ Assembly | F2 | Fit turbine wheel | 0.5 | AJ3-TRB-W |
| 8 | AJ Assembly | F3 | Fit exhaust cone | 0.5 | AJ3-EXH |
| 9 | AJ Assembly | F4 | Route fuel lines | 0.5 | AJ3-FLN |
| 10 | AJ Assembly | F5 | Connect igniter and sensor harness | 0.5 | |
| 11 | AJ Test | F6 | Engine run test | 1.5 | |
| 12 | AJ Inspection | F6 | Final inspection | 0.5 | |

6. Number each method's BOM `order` from 1, in table order.
7. Set each BOM line's `operation` to its row's operation `order`.
8. 🛑 Set `methodType: "Pull from Inventory"` on the AJ3-FIA and AJ3-CC lines. The "Make to Order" default would nest the sub-job.
9. Fill `AJ3_SUPPLIER_PARTS`: AJ3-BRG-F and AJ3-BRG-R to "Summit Bearing Supply", `leadTime: 21`.
10. Add the other 12 buy parts to "Maumee Contract Machining", `leadTime: 30`.
11. Set each supplier link's `price` to the item's `standardCost`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 failed
```

12. Added during execution: export `AJ3_BATCH_PROPERTIES` with a "Heat lot" text property for AJ3-BRG-F and AJ3-BRG-R, and concat it into `items.batchProperties` in `motor-line/index.ts`. The validator requires a batch property on every Batch-tracked item.

**Out of scope:** new SVG art (items with "(omit)" fall back to the type icon), `operationType: "Inspection"` (it needs an `inspectionPlan`), and the motor methods.

---

## Task 26: Add the AJ-3 opening stock, bearing lots and Transfer kanbans

**Depends on:** Tasks 20, 25
**Files:**
- Modify: `packages/database/src/datasets/data/motor-line/aj3.ts`

**Steps:**
1. Fill `AJ3_OPENING_STOCK`:

| shelf | items (quantity each) |
|---|---|
| WH1-A1 | AJ3-BRG-F 20, AJ3-BRG-R 20 |
| WH1-A2 | AJ3-HSG-F 20, AJ3-SHF 20, AJ3-CMP-W 20, AJ3-DIF 20 |
| WH1-A3 | AJ3-NGV 20, AJ3-TRB-W 20, AJ3-EXH 20 |
| WH1-B1 | AJ3-FLN 20, AJ3-IGN 20, AJ3-LNR 20 |
| WH1-B2 | AJ3-INJ-BDY 20, AJ3-NOZ 20 |

2. Fill `AJ3_ON_HAND_TRACKED` with `{ item: "AJ3-BRG-F", shelf: "WH1-A1", entities: [LOT-AJ3BF-01 quantity 12, LOT-AJ3BF-02 quantity 8] }`.
3. Add `{ item: "AJ3-BRG-R", shelf: "WH1-A1", entities: [LOT-AJ3BR-01 quantity 12, LOT-AJ3BR-02 quantity 8] }`.
4. Fill `AJ3_KANBAN_ITEMS` with these Transfer kanbans, each with `qty: 4` and `replenishmentLevel: 2`:

| item | fromShelf | toShelf |
|---|---|---|
| AJ3-IGN | WH1-B1 | wc:A3 |
| AJ3-NOZ | WH1-B2 | wc:A2 |
| AJ3-FLN | WH1-B1 | wc:F4 |

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 failed
```

**Out of scope:** stock in the station bins. Empty station bins give the line feeder screen its shortages.

---

## Task 27: Add the AJ-3 jobs and serial sequences

**Depends on:** Tasks 21, 22, 25
**Files:**
- Modify: `packages/database/src/datasets/data/motor-line/aj3.ts`

**Steps:**
1. Fill `AJ3_JOBS` with these make-to-stock jobs. Set no `salesOrder`, `salesOrderLine` or `customer`:

| key | item | status | quantity | serials | dueDateOffset | releasedDateOffset | priority |
|---|---|---|---|---|---|---|---|
| aj3-fia-1 | AJ3-FIA | Ready | 2 | AJ3I-0001, AJ3I-0002 | 3 | -1 | 16 |
| aj3-fia-2 | AJ3-FIA | Ready | 1 | AJ3I-0003 | 5 | -1 | 17 |
| aj3-cc-1 | AJ3-CC | Ready | 2 | AJ3C-0001, AJ3C-0002 | 7 | -1 | 18 |
| aj3-cc-2 | AJ3-CC | Ready | 1 | AJ3C-0003 | 9 | -1 | 19 |
| aj3-eng-1 | AJ3-ENG | Ready | 2 | AJ3E-0001, AJ3E-0002 | 12 | -1 | 20 |
| aj3-eng-2 | AJ3-ENG | Ready | 1 | AJ3E-0003 | 14 | -1 | 21 |
| aj3-eng-planned | AJ3-ENG | Planned | 1 | AJ3E-0004 | 18 | (omit) | 22 |

2. Leave out `operationOverrides`, so every operation of a Ready job is Ready.
3. Fill `AJ3_SERIAL_SEQUENCES` with `{ item: "AJ3-ENG", prefix: "AJ3E-", size: 4, next: 5, serialNumberTiming: "jobCreation", printLabelOnCompletion: true }`.
4. Add `{ item: "AJ3-CC", prefix: "AJ3C-", size: 4, next: 4, serialNumberTiming: "jobCreation" }`.
5. Add `{ item: "AJ3-FIA", prefix: "AJ3I-", size: 4, next: 4, serialNumberTiming: "jobCreation" }`.

If the validator reports that `next` must be a different value, use the value it names and report it.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/datasets/validate-line-flow.test.ts
# Expected: all pass
```

**Out of scope:** picking lists, production events and genealogy for AJ-3 jobs. The tester makes them in the flow.

---

## Task 28: Add `materialRequest` demo rows and a coverage floor

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — add `MaterialRequestSpec`
- Modify: the tier that writes production data after jobs (`packages/database/src/datasets/tiers/06-production.ts`) — insert the rows
- Modify: each dataset in `DATASETS` — add 2 rows
- Modify: `packages/database/src/datasets/coverage.ts` — add a floor for `materialRequest`
- Copy from (precedent): the newest table added under `.claude/rules/workflow-database-migration.md` step 6

**Steps:**
1. Read `.claude/rules/workflow-database-migration.md` step 6. Follow it for `materialRequest`.
2. Add `MaterialRequestSpec = { job: string; operationOrder: number; item?: string; note?: string; status: "Open" | "Resolved" }`.
3. Insert each row with the job operation's work center and location. For `Resolved`, set `resolvedBy` and `resolvedAt`.
4. Give each dataset 1 `Open` and 1 `Resolved` row, on an open job.
5. Add the `materialRequest` floor in `coverage.ts` with value 2.

If step 6 of the rule asks for something this task does not list, do what the rule says and report it.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: every dataset "✓"
```

**Out of scope:** the MES screens.

---

## Task 29: Run the dataset checks and the scoped typecheck

**Depends on:** Tasks 16–28
**Files:** none

**Steps:**
1. Run the drift check for `motor-line`.
2. Run the drift check for all datasets.
3. Run the scoped typecheck.
4. Run the dataset unit tests.

**Verify:**
```bash
pnpm db:check:datasets -- --dataset motor-line
# Expected: "✓ motor-line"
pnpm db:check:datasets
# Expected: ✓ for every dataset
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 failed
pnpm --filter @carbon/database exec vitest run src/datasets
# Expected: all tests pass
```

**Out of scope:** lowering any `COVERAGE_FLOORS` value.

---

## Task 30: Seed `motor-line` and check the AJ-3 rows

**Depends on:** Task 29
**Files:** none

🛑 Ask the user before you run the seed. It wipes and rewrites the business data of the dev company.

**Steps:**
1. Run `pnpm db:seed:dev -- --email <dev email> --dataset motor-line`. Use the user's `DEV_BYPASS_EMAIL`.
2. Copy the "Company ID" that the seed prints into `<c>` below.
3. Run each query with `pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -c "<sql>"` from the repository root.

**Verify:**
```bash
pnpm db:seed:dev -- --email <dev email> --dataset motor-line
# Expected: "Dev environment seeded successfully!"
```

| Query (`<c>` = company id) | Expected |
|---|---|
| `SELECT "travelerLabels","requireTrackedMaterialsIssued","autoPickingListOnRelease" FROM "companySettings" WHERE id='<c>'` | `t \| t \| t` |
| `SELECT "readableId", quantity FROM "trackedEntity" WHERE "companyId"='<c>' AND "readableId" ~ '^AJ3[CEI]-' ORDER BY 1` | 10 rows: AJ3C-0001–0003, AJ3E-0001–0004, AJ3I-0001–0003; each quantity 1 |
| `SELECT i."readableId", jo.description FROM "jobMaterial" jm JOIN item i ON i.id=jm."itemId" JOIN "jobOperation" jo ON jo.id=jm."jobOperationId" WHERE jm."companyId"='<c>' AND i."readableId" IN ('AJ3-BRG-F','AJ3-BRG-R','AJ3-CC')` | 9 rows; bearings at "Press bearings onto main shaft", AJ3-CC at "Merge: install combustion chamber" |
| `SELECT "readableId","storageUnitName","availableQuantity" FROM get_available_tracked_entities((SELECT id FROM item WHERE "readableId"='AJ3-BRG-F' AND "companyId"='<c>'),'<c>',(SELECT "locationId" FROM job WHERE "companyId"='<c>' LIMIT 1))` | LOT-AJ3BF-01 / WH1-A1 / 12 and LOT-AJ3BF-02 / WH1-A1 / 8 |
| `SELECT i."readableId", f.name, t.name, k."replenishmentLevel" FROM kanban k JOIN item i ON i.id=k."itemId" JOIN "storageUnit" f ON f.id=k."fromStorageUnitId" JOIN "storageUnit" t ON t.id=k."storageUnitId" WHERE k."companyId"='<c>' AND k."replenishmentSystem"='Transfer' AND i."readableId" LIKE 'AJ3%'` | 3 rows: WH1-B1 → A3 Floor, WH1-B2 → A2 Floor, WH1-B1 → F4 Floor; level 2 |
| `SELECT iss."printLabelOnCompletion", iss."serialNumberTiming" FROM "itemSerialSequence" iss JOIN item i ON i.id=iss."itemId" WHERE i."readableId"='AJ3-ENG' AND iss."companyId"='<c>'` | `t \| jobCreation` |

**Out of scope:** the browser flow. Task 52 owns it.

---

# Phase D — required scans

## Task 31: Add the pure required-scan helper with tests

**Depends on:** none
**Files:**
- Create: `apps/mes/app/utils/trackedMaterials.ts`
- Create: `apps/mes/app/utils/trackedMaterials.test.ts`
- Copy from (precedent): `apps/mes/app/utils/kanban.test.ts`

**Steps:**
1. Add `unissuedTrackedMaterials<T extends RequiredScanMaterial>(args: { materials: T[]; operationId: string; jobMakeMethodId: string; isLastOperation: boolean; unitsAfterCompletion: number }): T[]`.
2. Define `RequiredScanMaterial` as `{ id; jobMakeMethodId; jobOperationId; requiresSerialTracking; requiresBatchTracking; quantity; quantityIssued }`. Make each field nullable, as in `jobMaterialWithMakeMethodId`.
3. Keep only serial or batch materials with `jobMakeMethodId === args.jobMakeMethodId`.
4. Keep a material when `jobOperationId === operationId`, or when it is null and `isLastOperation` is true.
5. Return the materials where `(quantityIssued ?? 0) < (quantity ?? 0) * unitsAfterCompletion`.
6. Add `requiredScanMessage(rows: { itemReadableId: string; issued: number; required: number }[]): string | null`.
7. Make it return `"Scan in these parts first: A (0 of 1), B (1 of 2)"`, or null for no rows.
8. Write tests for 5 cases:
    - the last operation with a null `jobOperationId`
    - an operation that is not last
    - a row of another make method
    - a fully issued row
    - 2 units

**Verify:**
```bash
pnpm --filter mes test app/utils/trackedMaterials.test.ts
# Expected: "Test Files  1 passed"
```

**Out of scope:** reading settings and server calls.

---

## Task 32: Add the required-scan server building block

**Depends on:** Tasks 5, 31
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts` — add 2 functions next to `isFirstOperationOfMakeMethod` (about line 322)
- Copy from (precedent): `isFirstOperationOfMakeMethod` (about lines 322-337); `getTrackedInputs` (about line 2423)

**Steps:**
1. Add `isLastOperationOfMakeMethod(client, operationId: string, jobMakeMethodId: string): Promise<boolean>`.
2. Make it select `operation:jobOperation!jobOperationDependency_operationId_fk!inner(jobMakeMethodId)` from `jobOperationDependency`.
3. Filter with `.eq("dependsOnId", operationId)` and `.eq("operation.jobMakeMethodId", jobMakeMethodId)`, then `.limit(1).maybeSingle()`.
4. Return `!error && !data`. An error reads as "not last", so the check fails closed.
5. Add `getRequiredScanShortfall(client, args: { companyId; jobOperationId; trackedEntityId?: string; parentIsSerial: boolean; quantity: number })`.
6. Make it return `Promise<{ message: string | null; error: unknown | null }>`.
7. Read `companySettings.requireTrackedMaterialsIssued`. If it is false, return `{ message: null, error: null }`.
8. Read the `jobOperation` (`jobMakeMethodId, quantityComplete`) for the company.
9. In parallel, read the serial and batch `jobMaterial` rows of the make method, and call `isLastOperationOfMakeMethod`.
10. If `parentIsSerial` and `trackedEntityId` is set, also call `getTrackedInputs`.
11. If `parentIsSerial`, set each material's `quantityIssued` to the sum of inputs whose `activityAttributes["Job Material"]` is the material id. Set `unitsAfterCompletion` to 1.
12. Else set `unitsAfterCompletion` to `quantityComplete + quantity`.
13. Call `unissuedTrackedMaterials`. Read the item readable IDs for the rows that are left.
14. Return `requiredScanMessage(rows)`.
15. If a read fails while the setting is on, return the message "Could not check the scanned parts".

If `requireTrackedMaterialsIssued` is not on the `companySettings` Row type, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** the finish label (Task 41 reuses `isLastOperationOfMakeMethod`).

---

## Task 33: Refuse completion on the server in the 3 routes

**Depends on:** Task 32
**Files:**
- Modify: `apps/mes/app/routes/x+/complete.tsx` — after the production-event check (about line 117)
- Modify: `apps/mes/app/routes/x+/end.$operationId.tsx` — inside `if (quantityToComplete > 0)`
- Modify: `apps/mes/app/routes/x+/finish.tsx` — after the ability refusal
- Copy from (precedent): the `checkStrictBackflush` refusal in `complete.tsx` (about lines 292-308); the `abilityRefusal` redirect in `end.$operationId.tsx` (about lines 85-95)

**Steps:**
1. In `complete.tsx`, call `getRequiredScanShortfall(serviceRole, { companyId, jobOperationId, trackedEntityId, parentIsSerial: trackingType === "Serial", quantity })`.
2. If `message` is set, return `data({}, await flash(request, { ...error(null, message), flash: "error" }))`.
3. In `end.$operationId.tsx`, call the check after the `trackedEntityId` resolution (about line 228) for tracked parents.
4. For untracked parents, call it before `checkStrictBackflush` (about line 390), with `quantity: quantityToComplete`.
5. If `message` is set, redirect to `${path.to.operation(operationId)}?trackedEntityId=${trackedEntityId}` with the flash error. Leave out the query when there is no unit.
6. In `finish.tsx`, call the check with `parentIsSerial: false` and `quantity: 0`.
7. If `message` is set, return the flash error, as the ability refusal does.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** `batch.$batchId.complete.tsx` and the inspection routes.

---

## Task 34: Block the Complete button in `QuantityModal`

**Depends on:** Tasks 31, 32
**Files:**
- Modify: `apps/mes/app/routes/x+/operation.$operationId.tsx` — add `isLastOperationOfMakeMethod` to the `Promise.all` wave (about line 244); return `isLastOperation` and `requireTrackedMaterialsIssued`
- Modify: `apps/mes/app/routes/x+/assembly.$operationId.tsx` — the same change in its wave (about line 126)
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` and `apps/mes/app/components/AssemblyView.tsx` — pass both to `QuantityModal`
- Modify: `apps/mes/app/components/JobOperation/components/QuantityModal.tsx` (about lines 165-171, 233-261, 386-392)
- Copy from (precedent): `autoSelectMaterialWithoutPickingList` (loader about line 370 → `JobOperation` prop about line 210); the Alert block in `QuantityModal.tsx:233-261`

**Steps:**
1. In each loader, read `companySettings.data?.requireTrackedMaterialsIssued ?? false`.
2. Add the optional props `requireTrackedMaterialsIssued` and `isLastOperation` to `QuantityModal`.
3. Compute `missing = unissuedTrackedMaterials({ materials, operationId: operation.id, jobMakeMethodId: operation.jobMakeMethodId, isLastOperation: requireTrackedMaterialsIssued && isLastOperation, unitsAfterCompletion: totalPartsAfterCompletion })`.
4. If the setting is on and `type` is `complete`, show a destructive Alert titled "Scan in these parts first".
5. In that Alert, list `itemReadableId` with issued and required for each row. Show no checkbox.
6. In that case, disable the submit button while `missing.length > 0`.
7. If the setting is off, keep today's Alert, checkbox and button rule.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** `InspectionView` and the `finish` type UI.

---

# Phase E — labels and picking

Package names: `erp`, `mes`, `@carbon/jobs`, `@carbon/printing`, `@carbon/database`.

## Task 35: Add the traveler print helpers to `@carbon/database`

**Depends on:** Task 5
**Files:**
- Create: `packages/database/src/travelers.ts`
- Create: `packages/database/src/travelers.test.ts`
- Modify: `packages/database/package.json` — add `"./travelers": "./src/travelers.ts"` to `exports`
- Copy from (precedent): `packages/database/src/stock-transfer.ts` (a pure helper and a query, exported from one subpath)

**Steps:**
1. Export `shouldPrintTravelers(previous: string | null | undefined, next: string | null | undefined): boolean`.
2. Return true only when `previous === "Draft"` and `next === "In Progress"`.
3. Export `OperationLabelInput = { isFirstOperation: boolean; isLastOperation: boolean; isTopLevelMakeMethod: boolean; travelerLabels: boolean; printLabelOnCompletion: boolean }`.
4. Export `shouldPrintOperationLabel(input: OperationLabelInput): boolean`.
5. Return true when `isLastOperation && isTopLevelMakeMethod && printLabelOnCompletion`.
6. Else return true when `isFirstOperation && !travelerLabels`. Else return false.
7. Export `getPickingListTravelerEntities(client: SupabaseClient<Database>, args: { pickingListId: string; companyId: string })`.
8. Read `pickingList` `id, pickingListId` by `id` and `companyId` with `.maybeSingle()`. If no row, return `{ data: null, readableId: null, error }`.
9. Read `pickingListLine.jobId` for the list and company. Make the job ids unique.
10. Read `jobMakeMethod.id` with `.in("jobId", jobIds)`, `.is("parentMaterialId", null)` and `.eq("companyId", companyId)`.
11. Read `trackedEntity` `*` with `.in("attributes->>Job Make Method", makeMethodIds)` and `.eq("companyId", companyId)`.
12. Add `.not("status", "in", "(Consumed,Rejected,Scrapped)")`.
13. Order by `createdAt`, then `readableId`, then `id`, all ascending, as `getTrackedEntitiesByMakeMethodId` does.
14. Return `{ data: trackedEntities, readableId: pickingList.pickingListId, error: null }`.
15. Test `shouldPrintTravelers` with 4 cases: Draft→In Progress (true), Completed→In Progress (false), Partial→In Progress (false), Draft→Cancelled (false).
16. Test `shouldPrintOperationLabel` with 5 cases:
    - first operation, `travelerLabels` off: true
    - first operation, `travelerLabels` on: false
    - last top-level operation with the flag: true
    - last sub-assembly operation with the flag: false
    - a single-operation routing with both on: true

If `.in("attributes->>Job Make Method", …)` fails on PostgREST, STOP and report. Do not change it to a loop of reads.

**Verify:**
```bash
pnpm --filter @carbon/database test -- travelers
# Expected: 9 tests pass, 0 fail
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: no errors
```

**Out of scope:** the print-job task, the registry and app files.

---

## Task 36: Add the `PickingList` print source

The user approved this new print source with this plan (`packages/printing/AGENTS.md` lists it under Ask First).

**Depends on:** Task 35
**Files:**
- Modify: `packages/printing/src/registry.ts` — add `"PickingList"` to the `productLabel` `sourceDocuments`
- Modify: `packages/printing/src/assignments.ts` — add `PickingList: "inventory"` to `sourceDocumentContexts`
- Modify: `packages/jobs/src/inngest/functions/tasks/print-job/resolvers.ts` — add `case "PickingList"` to `queryTrackedEntities`
- Copy from (precedent): the `case "StockTransfer"` branch of `queryTrackedEntities`

**Steps:**
1. Add `"PickingList"` after `"StockTransfer"` in the `productLabel` entry.
2. Add `PickingList: "inventory"` to `sourceDocumentContexts`.
3. In `queryTrackedEntities`, add `case "PickingList":`.
4. In that case, call `getPickingListTravelerEntities(client, { pickingListId: sourceDocumentId, companyId })` from `@carbon/database/travelers`.
5. Return `{ trackedEntities: result.data, readableId: result.readableId }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/printing --filter=@carbon/jobs
# Expected: both packages succeed
```

**Out of scope:** `renderers.tsx` (the productLabel renderer already prints tracked entities).

---

## Task 37: Print travelers when the ERP starts a picking list

**Depends on:** Tasks 5, 36
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` (`autoPrint`, about line 8269) — widen its types
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` (`setPickingListStatus`, about line 3864)
- Copy from (precedent): the `service.autoPrint` call in `postReceipt` (context `receiving`)

**Steps:**
1. Widen the `autoPrint` `sourceDocument` type to `"Receipt" | "Shipment" | "Kanban" | "PickingList"`.
2. Widen its `context` type to `"receiving" | "shipping" | "kanban" | "inventory"`.
3. In `setPickingListStatus`, change the current-row select from `"status"` to `"status, locationId"`.
4. After the update succeeds, compute `start = shouldPrintTravelers(current.data.status, finalStatus)`.
5. If `start` is false, return as before.
6. Read `getCompanySettings(ctx.asSystem.supabase, companyId)`. If `travelerLabels` is not true, skip the print.
7. Call `await service.autoPrint(ctx, { sourceDocument: "PickingList", sourceDocumentId: pickingListId, locationId: current.data.locationId, context: "inventory" })`.
8. Keep the call after the status write, so a print failure never blocks the status change.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors (main agent only)
```

**Out of scope:** the picking-list UI and `finishPickingList`.

---

## Task 38: Print travelers when the MES starts a picking list

**Depends on:** Tasks 5, 36
**Files:**
- Modify: `apps/mes/app/services/printing.server.ts` — add `autoPrintPickingListTravelers`
- Modify: `apps/mes/app/routes/x+/picking.$pickingListId.status.tsx`
- Copy from (precedent): `autoPrintFirstOperationLabel` in the same file (its try/catch, `getCachedPrinterConfig`, `trigger`)

**Steps:**
1. Export `autoPrintPickingListTravelers({ serviceRole, pickingListId, locationId, companyId, userId }): Promise<void>`.
2. Wrap the whole body in try/catch. In the catch, call `log.error("Traveler print failed", { companyId, pickingListId, error })`.
3. Read `companySettings.travelerLabels` with `.eq("id", companyId)`. If it is not true, return.
4. Call `getCachedPrinterConfig(serviceRole, companyId, locationId, "inventory")`.
5. If `config?.autoPrint ?? true`, call `trigger("print-job", { sourceDocument: "PickingList", sourceDocumentId: pickingListId, companyId, userId, locationId })`.
6. In the status route, change the select from `"status"` to `"status, locationId"`.
7. After a successful `updatePickingListStatus` that is not Completed, check `shouldPrintTravelers(current.data.status, status)`.
8. If it is true, `await autoPrintPickingListTravelers(...)` with `effectiveUserId`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no errors
```

**Out of scope:** the Completed and Partial branch of the route.

---

## Task 39: Print travelers when a first pick starts a Draft list

The trigger `update_picking_list_status` (newest body in `20260728120100_incomplete-picking-list-policy.sql`) moves a Draft list to In Progress on its first pick. The status routes do not see that move.

**Depends on:** Tasks 37, 38
**Files:**
- Modify: `apps/mes/app/routes/x+/picking.$pickingListId.line.quantity.tsx`
- Modify: `apps/mes/app/routes/x+/picking.$pickingListId.tracked.$lineId.tsx`
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` (`pickPickingListLineChecked` about line 4041, `pickPickingListLineEntity` about line 4082)

**Steps:**
1. In each MES route, read `pickingList` `id, status, locationId` with the service role before the pick.
2. After a successful pick, re-read `status` only when the first status was `Draft`.
3. If `shouldPrintTravelers(before, after)` is true, call `autoPrintPickingListTravelers`.
4. In each ERP operation, do steps 1–3 with `ctx.asSystem.supabase`.
5. In the ERP operations, call `service.autoPrint(...)` after the `travelerLabels` check from Task 37.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no errors
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors (main agent only)
```

**Out of scope:** the trigger SQL.

---

## Task 40: Add "Print travelers" to the MES picking list

**Depends on:** Task 36
**Files:**
- Create: `apps/mes/app/routes/file+/picking-list+/$id.travelers[.]pdf.tsx`
- Create: `apps/mes/app/routes/file+/picking-list+/$id.travelers[.]zpl.tsx`
- Modify: `apps/mes/app/utils/path.ts` — add `path.to.file.pickingListTravelersPdf` and `pickingListTravelersZpl`
- Modify: `apps/mes/app/routes/x+/picking.$pickingListId.tsx` (`PickingListControls`, about line 300)
- Copy from (precedent): `apps/mes/app/routes/file+/operation+/$id.labels[.]pdf.tsx` and `$id.labels[.]zpl.tsx`; the `PrintButton` in `JobOperation.tsx` (about line 2216); the `operationLabelsPdf` / `operationLabelsZpl` path builders

**Steps:**
1. Copy the operation label routes. Replace `getTrackedEntitiesByOperationId` with `getPickingListTravelerEntities(client, { pickingListId: id, companyId })`.
2. Drop the `trackedEntityId` query filter from the copies.
3. Add the 2 path builders, copied from `operationLabelsPdf` / `operationLabelsZpl` without `trackedEntityId`.
4. Pass `locationId` from `pickingList.locationId` into `PickingListControls`.
5. In `PickingListControls`, render `PrintButton` before the `isPickingListLocked` early return.
6. Set `sourceDocument="PickingList"`, `sourceDocumentId={pickingListId}`, `context="inventory"`, `locationId` and `size`.
7. Set `label={<Trans>Print travelers</Trans>}` and `fileRoutes={{ pdf: path.to.file.pickingListTravelersPdf, zpl: path.to.file.pickingListTravelersZpl }}`.
8. Hide the button only when `status === "Cancelled"`.
9. Run `pnpm lingui:extract`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no errors
```

**Out of scope:** an ERP picking-list print button.

---

## Task 41: Print the finished-good label at the last operation

**Depends on:** Tasks 32, 35
**Files:**
- Modify: `apps/mes/app/services/printing.server.ts` — rename `autoPrintFirstOperationLabel` to `autoPrintOperationLabel`
- Modify the call sites: `apps/mes/app/routes/x+/complete.tsx` (lines 165, 243), `apps/mes/app/routes/x+/end.$operationId.tsx` (lines 271, 378), `apps/mes/app/services/quality.server.ts` (lines 552, 607)

**Steps:**
1. Rename the print function. Keep its arguments.
2. In parallel, read the entity, `isFirstOperationOfMakeMethod`, `isLastOperationOfMakeMethod` (Task 32), the `jobMakeMethod` `parentMaterialId, itemId`, and `companySettings.travelerLabels`.
3. Read `itemSerialSequence.printLabelOnCompletion` with `.eq("itemId", itemId)`, `.eq("companyId", companyId)` and `.maybeSingle()`.
4. Call `shouldPrintOperationLabel({ isFirstOperation, isLastOperation, isTopLevelMakeMethod: parentMaterialId === null, travelerLabels, printLabelOnCompletion: !!row?.printLabelOnCompletion })`.
5. If it returns false, return.
6. Else keep the existing location, `getCachedPrinterConfig` and `trigger("print-job", { sourceDocument: "Job", ... })` steps.
7. Rewrite the TSDoc so it names both print points and the `travelerLabels` switch.
8. Rename the import and the call at the 6 call sites. Change no argument.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no errors
grep -rn "autoPrintFirstOperationLabel" apps/mes/app
# Expected: no output
```

**Out of scope:** `finish.tsx` (it completes no unit) and `batch.$batchId.complete.tsx` (it prints no label today).

---

## Task 42: Create a picking list for each released job

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/production/production.utils.ts` — add `appendNoteParagraph`
- Create or modify: `apps/erp/app/modules/production/production.utils.test.ts`
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — export `NO_MATERIALS_TO_PICK`
- Modify: `apps/erp/app/modules/production/production.service.ts` — add `createReleasePickingList`
- Modify: `apps/erp/app/modules/production/production.server.ts` (`releaseCheckedJobs`, line 278)
- Copy from (precedent): `kanbanReplenishmentNote` (`packages/database/src/stock-transfer.ts:112`) for the Tiptap shape

**Steps:**
1. In `inventory.service.ts`, export `const NO_MATERIALS_TO_PICK = "No materials require picking for the selected operations"`.
2. Use the constant in the empty-list return of `generatePickingList` (about line 6688).
3. Add `appendNoteParagraph(notes: Json | null, text: string): Json`.
4. Return a `doc` that holds the old `content` plus one `paragraph` with `text`. If `notes` is null or not a `doc`, return a new `doc`.
5. Test it with 3 cases: null notes, a doc with 1 paragraph, and a value that is not a doc.
6. Add `createReleasePickingList(client, args: { jobId: string; companyId: string; userId: string }): Promise<{ created: boolean; error: string | null }>`.
7. Read `companySettings.autoPickingListOnRelease`. If it is not true, return `{ created: false, error: null }`.
8. Read `job.locationId`.
9. Look for an open picking list of the job: a `pickingListLine` with `jobId` whose `pickingList.status` is `Draft` or `In Progress`. If one exists, return `{ created: false, error: null }`.
10. Read the job's `jobOperation.id` values whose status is not `Done` and not `Canceled`.
11. Call `inventoryPostings.generatePickingList(client, { jobOperationIds, locationId, companyId, createdBy: userId })`.
12. If the error equals `NO_MATERIALS_TO_PICK`, return `{ created: false, error: null }`.
13. On any other error, return `{ created: false, error: getErrorMessage(error, "unknown error") }`.
14. In `releaseCheckedJobs`, after the `assignJobSerialNumbersAtRelease` block, call `service.createReleasePickingList(ctx.asSystem.supabase, { jobId: id, companyId, userId })`.
15. If it returns an error, call `logger.error("Picking list at release failed", { companyId, jobId: id, error })`.
16. Then read `job.notes` and write `appendNoteParagraph(notes, `Carbon released the job but could not create its picking list: ${error}`)`.
17. Push `{ jobId: id, message: "The job is released, but its picking list could not be created" }` to `warnings`.
18. Never return `report(...)` on this failure. The release stays.

If the import from `inventory.service.ts` makes a cycle that fails at runtime, STOP and report. `production.service.ts` already imports it as `inventoryPostings` (line 214).

**Verify:**
```bash
pnpm --filter erp test -- production.utils release-jobs
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors (main agent only)
```

**Out of scope:** calling the `generatePickingList` operation from `production.server.ts` (circular import). The picking destination: it stays the work center lineside storage unit.

---

## Task 43: Show unassigned picking lists to water spiders in the MES

**Depends on:** none
**Files:**
- Modify: `apps/mes/app/services/picking.service.ts` (`getAssignedPickingLists`, line 11)
- Modify: `apps/mes/app/routes/x+/picking._index.tsx`

**Steps:**
1. Add a `locationId: string | undefined` parameter to `getAssignedPickingLists`.
2. Run 2 reads: the user's lists (today's query), and lists with `.is("assignee", null)`, `.eq("locationId", locationId)` and the same status filter.
3. Skip the second read when `locationId` is undefined.
4. Merge the results by `id`. Sort by `dueDate` ascending with nulls last, then `pickingListId`.
5. In the loader, pass `context.get(userContext)?.locationId`.
6. Change the empty-state title to `<Trans>No picking lists</Trans>`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no errors
```

**Out of scope:** assigning a list from the MES.

---

# Phase F — "Need material" and the line feeder screen

## Task 44: Add the shared `materialRequest` building blocks

The MES reaches the ERP only through postings, so the building blocks live in `@carbon/database`.

**Depends on:** Task 5
**Files:**
- Create: `packages/database/src/material-request.ts`
- Modify: `packages/database/package.json` — export `"./material-request"`
- Modify: `apps/mes/app/services/models.ts` — add `materialRequestValidator`
- Copy from (precedent): `getNonNettableTrackedEntityIds` (`@carbon/database`) for a package-level read; `qualityIssueValidator` (`models.ts:406`) for the validator

**Steps:**
1. Export `createMaterialRequest(client, args: { companyId: string; userId: string; jobOperationId: string; itemId?: string | null; note?: string | null; fallbackLocationId?: string | null })`.
2. Read `jobOperation` `id, workCenterId, workCenter(locationId)` by `id` and `companyId`. If no row, return `{ data: null, error: "Operation not found" }`.
3. If `itemId` is set, read `item.id` with the company. If no row, return `{ data: null, error: "Item not found" }`.
4. Set `locationId` to `workCenter.locationId ?? fallbackLocationId`. If it is still null, return `{ data: null, error: "No location" }`.
5. Insert `{ companyId, locationId, workCenterId, jobOperationId, itemId, note, createdBy: userId }`. Then `.select("id").single()`.
6. Export `resolveMaterialRequest(client, args: { id: string; companyId: string; userId: string })`.
7. Update `status: "Resolved"`, `resolvedBy`, `resolvedAt: datetime.timestamp()`, `updatedBy` and `updatedAt`.
8. Filter on `id`, `companyId` and `status = "Open"`. Wrap the call in `requireAffected`, so an RLS refusal reads as an error.
9. Add `materialRequestValidator = z.object({ jobOperationId: z.string().min(1), itemId: zfd.text(z.string().optional()), note: zfd.text(z.string().optional()) })`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=mes
# Expected: both succeed
```

**Out of scope:** the RLS policies (Task 4).

---

## Task 45: Add the ERP operations `createMaterialRequest` and `resolveMaterialRequest`

**Depends on:** Task 44
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts`
- Copy from (precedent): `setPickingListStatus` for the shape; `refuseKeyWithout` (`shared.service.ts:1520`) as `projects.server.ts:4384` uses it

**Steps:**
1. Add `createMaterialRequest` with TSDoc and `@mcp`. Use `permission: {}` and input `{ jobOperationId, itemId?, note? }`.
2. In `run`, first return `refuseKeyWithout(ctx, { create: "inventory" })` if it refuses.
3. Call the building block with `ctx.asCaller.supabase`, `ctx.company.id` and `ctx.auditUserId`.
4. Map an error to `ctx.error("rule", message)`.
5. Add `resolveMaterialRequest` with TSDoc and `@mcp`. Use `permission: {}` and input `{ materialRequestId }`.
6. In `run`, return `refuseKeyWithout(ctx, { update: "inventory" })` if it refuses.
7. Call the building block with `ctx.asCaller.supabase`.
8. Map "no row" to `ctx.error("forbidden", "Only the requester or an inventory editor can resolve this request")`.
9. Run `pnpm check:manifest`, because 2 new `@mcp` operations change the digest (main agent only).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors (main agent only)
pnpm check:manifest
# Expected: passes after `tool-manifest.digest.json` is updated
```

**Out of scope:** ERP UI for material requests.

---

## Task 46: Add the MES "Need material" modal

**Depends on:** Task 44
**Files:**
- Create: `apps/mes/app/routes/x+/material-request.new.tsx`
- Create: `apps/mes/app/components/JobOperation/components/NeedMaterialModal.tsx`
- Modify: `apps/mes/app/utils/path.ts` — add `materialRequestNew: `${x}/material-request/new``
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` (actions sheet about line 2994; modal mount about line 3158)
- Modify: `apps/mes/app/components/AssemblyView.tsx` (`ActionSheetButton` about line 2938; `qualityModal` about line 570)
- Copy from (precedent): `apps/mes/app/routes/x+/quality-issue.new.tsx` and `apps/mes/app/components/JobOperation/components/QualityIssueModal.tsx`

**Steps:**
1. Copy the route. Call `requirePermissions(request, {})` and keep its `client`.
2. Validate with `validator(materialRequestValidator).validate(formData)`.
3. Call `createMaterialRequest(client, { companyId, userId, jobOperationId, itemId, note, fallbackLocationId: context.get(userContext)?.locationId })`.
4. On error, log it and throw the `requestReferrer` redirect with a flash, as the precedent does.
5. On success, return `success("Material requested")`.
6. Copy `QualityIssueModal` to `NeedMaterialModal`, with props `{ operationId, materials: { itemId: string; label: string }[], isOpen, onClose }`.
7. Render in this order: `Hidden jobOperationId`, an optional `Select name="itemId" label={t`Part`}`, an optional `TextArea name="note" label={t`Note`}`.
8. Set the title to `<Trans>Need material</Trans>` and the success toast to `t`Material requested``.
9. In `JobOperation`, add `needMaterialModal = useDisclosure()`.
10. Add a sheet button with `LuPackageSearch` and the label "Need material" after the Quality Issue button.
11. Build `materials` from the resolved `materials` promise: `itemId` and `itemReadableId`.
12. Mount the modal inside `<Suspense><Await resolve={materials}>`.
13. In `AssemblyView`, add the same `ActionSheetButton` and modal. Use `allMaterials`.
14. Run `pnpm lingui:extract`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no errors
```

**Out of scope:** notifications to line feeders.

---

## Task 47: Add the pure line-feed row builder

**Depends on:** Task 5
**Files:**
- Create: `apps/mes/app/services/line-feed.ts`
- Create: `apps/mes/app/services/line-feed.test.ts`
- Copy from (precedent): `apps/mes/app/services/allocation.stripes.test.ts`

**Steps:**
1. Export `LineFeedRow = { kind: "request" | "shortage" | "transfer"; key: string; workCenterId: string | null; storageUnitId: string | null; itemId: string | null; quantity: number | null; createdAt: string | null; materialRequestId?: string; stockTransferId?: string; note?: string | null }`.
2. Export `buildLineFeedRows({ requests, shortages, transfers }): LineFeedRow[]`.
3. Put the requests first, oldest `createdAt` first.
4. Put the shortages second, by `short` descending. Set `quantity` from `short` and `createdAt` to null.
5. Put the transfer lines last, oldest first. Set `quantity` from `outstandingQuantity`.
6. Test with 1 row of each kind given in reverse order. Expect request, shortage, transfer.
7. Test that 2 requests sort oldest first and 2 shortages sort largest first.

**Verify:**
```bash
pnpm --filter mes test -- line-feed
# Expected: tests pass
```

**Out of scope:** data reads.

---

## Task 48: Add the MES line feeder screen

**Depends on:** Tasks 44, 47
**Files:**
- Create: `apps/mes/app/routes/x+/line-feed.tsx`
- Create: `apps/mes/app/routes/x+/line-feed.$materialRequestId.resolve.tsx`
- Modify: `apps/mes/app/services/inventory.service.ts` — add `getLineFeed`
- Modify: `apps/mes/app/utils/path.ts` — add `lineFeed`, `lineFeedResolve(id)` and `erpStockTransfer(id) => `${ERP_URL}/x/stock-transfer/${id}`` (copy `erpInspection`)
- Modify: `apps/mes/app/components/AppSidebar.tsx` (`QUEUES` line 371, `useQueueTitles`)
- Modify: `apps/mes/app/shortcuts.ts` — add `lineFeed: "alt+0"` to `MES_NAV_SHORTCUTS`
- Copy from (precedent): `apps/mes/app/routes/x+/picking._index.tsx` (card grid, `MesAppBar`, `MesQueueHeader`, `MesEmptyState`); the action in `picking.$pickingListId.line.quantity.tsx`

**Steps:**
1. Write `getLineFeed(client, { companyId: string; locationId: string })`. Run 3 reads in parallel.
2. Read 1: `materialRequest` with `*, item(readableIdWithRevision), workCenter(name), jobOperation(job(jobId))`, `status = "Open"`, the location and the company.
3. Read 2: `client.rpc("get_line_feed_shortages", { p_location_id, p_company_id })`.
4. Read 3: `stockTransferLine` with `id, itemId, outstandingQuantity, createdAt, stockTransfer!inner(id, stockTransferId, status, locationId)`.
5. In read 3, also select `toStorageUnit:storageUnit!stockTransferLine_toStorageUnitId_fkey!inner(name, workCenterId)`.
6. Filter read 3 on the company, `stockTransfer.locationId`, `stockTransfer.status in ("Released","In Progress")`, `outstandingQuantity > 0` and `not toStorageUnit.workCenterId is null`.
7. Read the shortage storage-unit names with one `.in("id", ids)` query.
8. Return `buildLineFeedRows(...)` and the name maps.
9. In the loader, call `requirePermissions(request, { view: "inventory" })`. Read `locationId` from `userContext`.
10. Set `handle.realtime` to `["materialRequest", "stockTransfer", "stockTransferLine", "jobOperation", "itemLedger"]`.
11. Render one card per row with 4 fields:
    - station: the work center name
    - part: the `useItems` readable id
    - quantity
    - age: `DateTime` relative, or "—" for a shortage
12. Give a request card a `Resolve` button. It posts to `path.to.lineFeedResolve(id)` with `useFetcher`.
13. Make a transfer card a link to `path.to.erpStockTransfer(stockTransferId)` with `target="_blank"`.
14. Write the resolve action. Call `assertIsPost`, then `requirePermissions(request, {})` with the user `client`.
15. Call `resolveMaterialRequest`. Return `{ success: false, message }` on error.
16. Add `{ key: "lineFeed", icon: LuTruck, to: path.to.lineFeed }` to `QUEUES` and the title "Line feed".
17. Run `pnpm lingui:extract`.

If `alt+0` is already bound in the MES, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no errors
```

**Out of scope:** an MES stock transfer screen. `MesTabBar` `TAB_KEYS`.

---

# Phase G — settings screens, docs and verification

## Task 49: Add the "Line Flow" toggles to Settings → Production

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — `updateProductionSettings` input and TSDoc
- Modify: `apps/erp/app/routes/x+/settings+/production.tsx` — form union, toasts, handlers, new card
- Copy from (precedent): the "Shop Floor" card in `apps/erp/app/routes/x+/settings+/production.tsx` (lines 338–417) and its `settingsToggle` entries (lines 99–105)

**Steps:**
1. In the `updateProductionSettings` input, add `travelerLabels`, `requireTrackedMaterialsIssued` and `autoPickingListOnRelease`, each `z.boolean().optional()`.
2. Extend its `@remarks` with this text: "whether travelers print at the pick, whether an operation needs its tracked parts issued before completion, and whether releasing a job creates its picking list."
3. In `productionSettingsForm`, add `settingsToggle("travelerLabelsToggle", "travelerLabels")`.
4. Add `settingsToggle("requireTrackedMaterialsIssuedToggle", "requireTrackedMaterialsIssued")`.
5. Add `settingsToggle("autoPickingListOnReleaseToggle", "autoPickingListOnRelease")`.
6. In `productionSettingsMessage`, add one branch per field, with the toast text in the table below.
7. Add 3 `useCallback` handlers, copied from `handleAutoSelectMaterialToggle`, each with its own intent.
8. Read each value from `companySettings` with `?? false`.
9. After the "Shop Floor" card, add a "Line Flow" card that copies the "Shop Floor" structure.
10. Set the card description to "Control how parts and labels move from the pick to the finished unit."
11. Add the 3 rows in table order, with a `<Separator />` between rows.

| Field | Title on / off | Description on / off | `aria-label` | Toast on / off |
|---|---|---|---|---|
| `autoPickingListOnRelease` | "Releasing a job creates its picking list" / "Picking lists are created by hand" | "Each released job gets one picking list. Its parts go to the lineside storage unit of each work center that uses them." / "Turn on to create one picking list for each job when it is released." | "Create picking lists on release" | "Picking lists on release enabled" / "Picking lists on release disabled" |
| `travelerLabels` | "Travelers print at the pick" / "Labels print at the first operation" | "Starting a picking list prints one traveler per unit. The first operation prints no label." / "Completing a job's first operation prints its unit labels." | "Print travelers at the pick" | "Traveler labels enabled" / "Traveler labels disabled" |
| `requireTrackedMaterialsIssued` | "Tracked parts must be scanned in" / "Tracked parts are not required" | "An operation cannot complete until every serial and batch part on it is issued." / "Operators see a warning about unissued serial and batch parts and can still complete." | "Require tracked parts before completion" | "Required tracked parts enabled" / "Required tracked parts disabled" |

If `companySettings` in the loader data lacks the 3 fields after Task 5, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors (main agent only)
```

**Out of scope:** the behavior behind each setting. Settings → Items.

---

## Task 50: Add "Print label on completion" to the serial number form

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `itemSerialSequenceValidator`
- Modify: `apps/erp/app/modules/settings/ui/SerialNumbers/ItemSerialSequenceForm.tsx` — the switch
- Modify: `apps/erp/app/routes/x+/settings+/serial-numbers.$id.tsx` and `serial-numbers.new.tsx` — initial value
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — `createItemSerialSequence` and `updateItemSerialSequence` inputs
- Modify: `apps/erp/app/modules/settings/AGENTS.md` — the `itemSerialSequence` row
- Copy from (precedent): the `serialNumberTiming` field in `ItemSerialSequenceForm.tsx`; `<Boolean name="active" … bordered />` in `apps/erp/app/modules/accounting/ui/Dimensions/DimensionForm.tsx:135`

**Steps:**
1. In `itemSerialSequenceValidator`, add `printLabelOnCompletion: zfd.checkbox()`.
2. In the form, import `Boolean` from `~/components/Form`.
3. After the Timing `Select`, add `<Boolean name="printLabelOnCompletion" bordered />`.
4. Set its `label` to t`Print label on completion` and its `description` to t`Print this item's serial label when its job's last operation completes.`
5. In `serial-numbers.$id.tsx`, add `printLabelOnCompletion: itemSerialSequence.printLabelOnCompletion ?? false` to the initial values.
6. In `serial-numbers.new.tsx`, add `printLabelOnCompletion: false`.
7. In both service function inputs, add `printLabelOnCompletion: z.boolean().optional()`, described as "Print the serial label when the job's last operation completes."
8. In the settings `AGENTS.md`, add one sentence about `printLabelOnCompletion` to the `itemSerialSequence` row.

If `getItemSerialSequence` (the `itemSerialSequences` view) lacks the new column after Task 5, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors (main agent only)
```

**Out of scope:** the MES print (Task 41). The serial numbers list columns.

---

## Task 51: Bring the rules and AGENTS.md files up to date

**Depends on:** Phases B–F
**Files:**
- Modify: `.claude/rules/printing-system.md` — the `PickingList` source, the `inventory` context, `autoPrintOperationLabel` and the last-operation rule
- Modify: `packages/printing/AGENTS.md` — add `kanban` and `inventory` to the context list
- Modify: `.claude/rules/traceability-model.md` — `get_traveler_target`
- Modify: `.claude/rules/mes-job-operation-ui.md` — the traveler scan, the wedge path exclusion, the required-scan setting
- Modify: `apps/erp/app/modules/inventory/AGENTS.md` — `createMaterialRequest` / `resolveMaterialRequest`, the traveler print in `setPickingListStatus`
- Modify: `apps/erp/app/modules/production/AGENTS.md` — the picking-list step in `releaseCheckedJobs` under "Every path to Ready"

**Steps:**
1. Write each change in the present tense, and name the function.
2. Do the STE-80 review pass on each edited Markdown file.

**Verify:**
```bash
grep -rn "autoPrintFirstOperationLabel" .claude apps packages
# Expected: no output
```

**Out of scope:** `docs/content` product pages.

---

## Task 52: Verify slice 1 in the browser

**Depends on:** every task above, and the seeded `motor-line` data (Task 30)
**Files:** none (playbooks in `.ai/playbooks/`)

Read `.ai/lessons.md` → "Browser-testing MES flows that write data" first: check the database after every action.

**Steps:**
1. Run `/test` against every slice 1 acceptance criterion in the spec.
2. Simulate a scan with an agent-browser keystroke burst at scanner speed (under 50 ms per key) and Enter.
3. Check the 3 settings screens: each toggle keeps its state after a reload, and the serial sequence keeps "Print label on completion".
4. Screenshot each new or changed screen at 1440 px beside its precedent. Answer the screenshot-check questions.
5. Save the playbook in `.ai/playbooks/`.

**Verify:**
```bash
# /test reports each acceptance criterion pass or fail
# Expected: every slice 1 criterion passes; the playbook is saved under .ai/playbooks/
```

**Out of scope:** slices 2 and 3.

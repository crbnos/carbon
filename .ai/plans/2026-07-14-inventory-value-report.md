# Inventory Valuation Report — implementation plan

**Spec:** .ai/specs/2026-07-14-inventory-value-report.md
**Research:** .ai/research/inventory-value-report.md
**Run record:** .ai/runs/2026-07-14-inventory-value-report.md
**Branch:** feat/inventory-report

> Browser verification (/test) and self-review were **deselected by the user** in
> the feature run — the verification story is: rolled-back psql validation of the
> RPC math (Task 2), scoped typecheck + lint per task, and the user verifying in
> the browser themselves.

> **Generated types:** `pnpm db:migrate` applies the migration AND regenerates
> `packages/database/src/types.ts` + `swagger-docs-schema.ts`. Commit the
> regenerated files with the migration — they are part of the change (AGENTS.md:
> generate types after schema changes, BEFORE typechecking). Never hand-edit them.

## Progress
- [x] Task 1: Create the migration — `get_inventory_valuation` + `get_inventory_tie_out` RPCs (commit 1e3e89fbe)
- [x] Task 2: Apply migration and validate the math in a rolled-back psql transaction (7/7 asserts PASS; fixed account join — companyGroup-scoped, no companyId)
- [x] Task 3: Service functions + row types in the inventory module (typed rpc calls; erp typecheck green — note: correct filter is `erp`, not `@carbon/erp`)
- [x] Task 4: Path helper + sidebar nav entry (Track group, accounting_view-gated, LuChartBar)
- [x] Task 5: Workbench UI component (grouped union rows + tie-out popover + as-of label; cloned from ARAPWorkbench)
- [x] Task 6: Route `/x/inventory/valuation` (accounting_view gate; valuation errors throw to boundary; +156 translations filled via /translate)
- [x] Task 7: Final verification sweep (typecheck + biome + 7/7 psql asserts + pnpm test 21/21 green; fixed stale AGENTS.md validation command)

## Dependencies
- Task 2 needs Task 1 (migration file). Task 3 needs Task 2 (functions exist locally).
- Tasks 4 and 5 are independent of each other; both need Task 3 (types).
- Task 6 needs Tasks 3, 4, 5. Task 7 needs all.

---

## Task 1: Create the migration — `get_inventory_valuation` + `get_inventory_tie_out` RPCs

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_inventory-valuation-rpc.sql` (via `pnpm db:migrate:new`)
- Copy from (precedent): `packages/database/supabase/migrations/20260713235406_item-ledger-snapshot.sql` (snapshot+delta arms), `packages/database/supabase/migrations/20260713233919_balance-rpc-snapshot-delta.sql` (GL balance filter convention)

**Steps:**

1. Run `pnpm db:migrate:new inventory-valuation-rpc` from the repo root. It creates
   the timestamped file. Confirm the HHMMSS portion is not `000000`; if it is,
   rename the file with a randomized HHMMSS (e.g. `143217`) before writing SQL.
2. Write exactly this SQL into the file (bare `NUMERIC` everywhere — never a
   precision spec; no `SET search_path`, matching the 20260713235406 precedent):

```sql
-- ============================================================
-- get_inventory_valuation: method-faithful inventory value by (item, location).
-- Spec: .ai/specs/2026-07-14-inventory-value-report.md
--
--   * quantityOnHand = ALL physical stock (On Hold + Rejected included; they are
--     assets until written off). quantityOnHold / quantityRejected are additive
--     breakdown columns from the denormalized itemLedger.trackedEntityStatus.
--   * unitCost: FIFO/LIFO = remaining cost-layer value incl. applied adjustment
--     children (appliesToCostLedgerId), fallback itemCost.unitCost when no open
--     layers; Average = itemCost.unitCost; Standard = itemCost.standardCost.
--     This is the completeness spec's carrying CTE
--     (.ai/specs/2026-07-04-inventory-valuation-completeness.md §3).
--   * as_of_date NULL/today: snapshot + delta (exact 20260713235406 pattern).
--     as_of_date in the past: raw itemLedger scan filtered by postingDate —
--     the snapshot has no date grain. Costs are ALWAYS current-state; the UI
--     labels dated results accordingly.
--   * Status buckets reflect CURRENT tracked-entity statuses even for past
--     dates (statuses are rewritten in place by 20260420112047).
-- ============================================================

DROP FUNCTION IF EXISTS get_inventory_valuation(TEXT, DATE, TEXT);

CREATE OR REPLACE FUNCTION get_inventory_valuation(
  company_id TEXT,
  as_of_date DATE DEFAULT NULL,
  location_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  "locationId" TEXT,
  "locationName" TEXT,
  "itemId" TEXT,
  "readableIdWithRevision" TEXT,
  "name" TEXT,
  "type" "itemType",
  "replenishmentSystem" "itemReplenishmentSystem",
  "unitOfMeasureCode" TEXT,
  "costingMethod" "itemCostingMethod",
  "quantityOnHand" NUMERIC,
  "quantityOnHold" NUMERIC,
  "quantityRejected" NUMERIC,
  "unitCost" NUMERIC,
  "totalValue" NUMERIC
) AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_dated BOOLEAN := as_of_date IS NOT NULL AND as_of_date < CURRENT_DATE;
BEGIN
  SELECT MAX("snapshotCutoff") INTO v_cutoff
  FROM "itemLedgerSnapshot"
  WHERE "companyId" = company_id;

  RETURN QUERY
  WITH quantities AS (
    SELECT
      combined."itemId",
      combined."locationId",
      SUM(combined."quantity") AS "quantityOnHand",
      SUM(combined."onHold") AS "quantityOnHold",
      SUM(combined."rejected") AS "quantityRejected"
    FROM (
      -- Arm 1: snapshot (untracked, immutable). Skipped on dated queries —
      -- the snapshot has no postingDate grain.
      SELECT
        s."itemId",
        NULLIF(s."locationId", '') AS "locationId",
        s."quantity",
        0::NUMERIC AS "onHold",
        0::NUMERIC AS "rejected"
      FROM "itemLedgerSnapshot" s
      WHERE NOT v_dated
        AND s."companyId" = company_id
        AND (location_id IS NULL OR s."locationId" = location_id)

      UNION ALL

      -- Arm 2: tracked rows, always live (status flips in place).
      SELECT
        il."itemId",
        il."locationId",
        il."quantity",
        CASE WHEN il."trackedEntityStatus" = 'On Hold' THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'Rejected' THEN il."quantity" ELSE 0 END
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NOT NULL
        AND (location_id IS NULL OR il."locationId" = location_id)
        AND (NOT v_dated OR il."postingDate" <= as_of_date)

      UNION ALL

      -- Arm 3: untracked delta past the cutoff (current path) OR the full
      -- untracked history filtered by postingDate (dated path / no snapshot).
      SELECT
        il."itemId",
        il."locationId",
        il."quantity",
        0::NUMERIC,
        0::NUMERIC
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NULL
        AND (location_id IS NULL OR il."locationId" = location_id)
        AND (v_dated OR v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
        AND (NOT v_dated OR il."postingDate" <= as_of_date)
    ) combined
    GROUP BY combined."itemId", combined."locationId"
    HAVING SUM(combined."quantity") <> 0
  ),
  carrying AS (
    -- Company-level effective unit cost per item, by costing method.
    SELECT
      ic."itemId",
      ic."costingMethod",
      CASE ic."costingMethod"
        WHEN 'Standard' THEN ic."standardCost"
        WHEN 'Average' THEN ic."unitCost"
        ELSE COALESCE(layers."layerUnitCost", ic."unitCost")
      END AS "unitCost"
    FROM "itemCost" ic
    LEFT JOIN LATERAL (
      SELECT
        SUM(
          cl."remainingQuantity"
          * (cl."cost" + COALESCE(adj."applied", 0))
          / NULLIF(cl."quantity", 0)
        ) / NULLIF(SUM(cl."remainingQuantity"), 0) AS "layerUnitCost"
      FROM "costLedger" cl
      LEFT JOIN LATERAL (
        SELECT SUM(a."cost") AS "applied"
        FROM "costLedger" a
        WHERE a."appliesToCostLedgerId" = cl."id"
          AND a."companyId" = cl."companyId"
      ) adj ON TRUE
      WHERE cl."itemId" = ic."itemId"
        AND cl."companyId" = ic."companyId"
        AND cl."remainingQuantity" > 0
    ) layers ON ic."costingMethod" IN ('FIFO', 'LIFO')
    WHERE ic."companyId" = company_id
  )
  SELECT
    l."id" AS "locationId",
    l."name" AS "locationName",
    i."id" AS "itemId",
    i."readableIdWithRevision",
    i."name",
    i."type",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    c."costingMethod",
    q."quantityOnHand",
    q."quantityOnHold",
    q."quantityRejected",
    COALESCE(c."unitCost", 0) AS "unitCost",
    q."quantityOnHand" * COALESCE(c."unitCost", 0) AS "totalValue"
  FROM quantities q
  INNER JOIN "item" i ON q."itemId" = i."id" AND i."companyId" = company_id
  INNER JOIN "location" l ON q."locationId" = l."id"
  LEFT JOIN carrying c ON c."itemId" = q."itemId"
  ORDER BY l."name", i."readableIdWithRevision";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- get_inventory_tie_out: subledger value vs GL balance per stock account
-- (SAP MB5L shape). Subledger side calls get_inventory_valuation so the two
-- surfaces can never disagree. Items classify to accounts exactly like
-- resolveInventoryAccount (functions/shared/get-posting-group.ts):
-- Make / Buy and Make -> finishedGoodsAccount, else rawMaterialsAccount.
-- GL side follows the newest balance convention (20260713233919):
-- journal.status <> 'Draft', journal.postingDate <= as-of, journalLine.accountId.
-- ============================================================

DROP FUNCTION IF EXISTS get_inventory_tie_out(TEXT, DATE);

CREATE OR REPLACE FUNCTION get_inventory_tie_out(
  company_id TEXT,
  as_of_date DATE DEFAULT NULL
)
RETURNS TABLE (
  "accountKind" TEXT,
  "accountId" TEXT,
  "accountName" TEXT,
  "subledgerValue" NUMERIC,
  "glBalance" NUMERIC,
  "variance" NUMERIC
) AS $$
DECLARE
  v_as_of DATE := COALESCE(as_of_date, CURRENT_DATE);
  v_rm_account TEXT;
  v_fg_account TEXT;
BEGIN
  SELECT ad."rawMaterialsAccount", ad."finishedGoodsAccount"
  INTO v_rm_account, v_fg_account
  FROM "accountDefault" ad
  WHERE ad."companyId" = company_id;

  IF v_rm_account IS NULL OR v_fg_account IS NULL THEN
    RETURN; -- company has no account defaults (accounting never configured)
  END IF;

  RETURN QUERY
  WITH subledger AS (
    SELECT
      CASE WHEN v."replenishmentSystem" IN ('Make', 'Buy and Make')
           THEN 'finishedGoods' ELSE 'rawMaterials' END AS "kind",
      SUM(v."totalValue") AS "value"
    FROM get_inventory_valuation(company_id, as_of_date, NULL) v
    GROUP BY 1
  ),
  gl AS (
    SELECT jl."accountId" AS "account", SUM(jl."amount") AS "balance"
    FROM "journal" j
    INNER JOIN "journalLine" jl ON jl."journalId" = j."id"
    WHERE j."companyId" = company_id
      AND j."status" <> 'Draft'
      AND j."postingDate" <= v_as_of
      AND jl."accountId" IN (v_rm_account, v_fg_account)
    GROUP BY jl."accountId"
  ),
  accounts AS (
    SELECT 'rawMaterials' AS "kind", v_rm_account AS "account"
    UNION ALL
    SELECT 'finishedGoods' AS "kind", v_fg_account AS "account"
  )
  SELECT
    a."kind" AS "accountKind",
    a."account" AS "accountId",
    acc."name" AS "accountName",
    COALESCE(s."value", 0) AS "subledgerValue",
    COALESCE(g."balance", 0) AS "glBalance",
    COALESCE(s."value", 0) - COALESCE(g."balance", 0) AS "variance"
  FROM accounts a
  LEFT JOIN "account" acc ON acc."id" = a."account" AND acc."companyId" = company_id
  LEFT JOIN subledger s ON s."kind" = a."kind"
  LEFT JOIN gl g ON g."account" = a."account"
  ORDER BY a."kind" DESC; -- rawMaterials first
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Kept per spec decision (grill Q5): superseded but not dropped.
COMMENT ON FUNCTION get_inventory_value_by_location(TEXT) IS
  'Deprecated: superseded by get_inventory_valuation (method-faithful costs, status breakdown, as-of-date). Kept for API compatibility.';
```

3. Do not add tables, RLS, enums, or touch `get_inventory_value_by_location`'s
   body. If `journal` lacks a `status` or `postingDate` column, or `accountDefault`
   lacks `rawMaterialsAccount`/`finishedGoodsAccount` (check
   `20260713190909_raw-materials-finished-goods-accounts.sql`), STOP and report —
   do not improvise.

**Verify:**
```bash
ls packages/database/supabase/migrations/ | tail -3
# Expected: the new <timestamp>_inventory-valuation-rpc.sql is the newest file
# (timestamp strictly greater than 20260713235406) and HHMMSS != 000000
```

**Out of scope:** dropping or editing `get_inventory_value_by_location`;
`itemLedgerSnapshot` definition; any index changes; `costLedger` schema.

---

## Task 2: Apply migration and validate the math in a rolled-back psql transaction

**Depends on:** Task 1
**Files:**
- Create: `.ai/scratch/validate-inventory-valuation.sql` (gitignored scratch — do not commit)
- Copy from (precedent): the rolled-back-txn validation approach used for prior migrations (memory: BEGIN / fixtures / asserts / ROLLBACK as `supabase_admin`)

**Steps:**

1. Apply: `pnpm db:migrate`. This applies the pending migration and regenerates
   DB types + swagger. Confirm the new RPCs landed in the generated types:
   `grep -c "get_inventory_valuation\|get_inventory_tie_out" packages/database/src/types.ts`
   (expected: ≥ 2). The regenerated `types.ts` / `swagger-docs-schema.ts` diffs
   are part of this task's commit.
2. Write `.ai/scratch/validate-inventory-valuation.sql` with exactly:

```sql
BEGIN;
DO $test$
DECLARE
  cid TEXT; uid TEXT; loc_a TEXT; loc_b TEXT;
  itm_fifo TEXT; itm_std TEXT; itm_zero TEXT;
  l1 TEXT; l2 TEXT;
  r RECORD;
  v_total NUMERIC;
BEGIN
  SELECT id INTO cid FROM "company" LIMIT 1;
  SELECT id INTO uid FROM "user" WHERE "email" = 'system@carbon.ms';
  IF uid IS NULL THEN SELECT id INTO uid FROM "user" LIMIT 1; END IF;

  INSERT INTO "location" ("name", "timezone", "companyId", "createdBy")
  VALUES ('VALTEST-A', 'America/New_York', cid, uid) RETURNING id INTO loc_a;
  INSERT INTO "location" ("name", "timezone", "companyId", "createdBy")
  VALUES ('VALTEST-B', 'America/New_York', cid, uid) RETURNING id INTO loc_b;

  -- Items: interceptors auto-create itemCost/itemReplenishment on item insert.
  INSERT INTO "item" ("readableId", "name", "type", "replenishmentSystem",
                      "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
  VALUES ('VALTEST-FIFO', 'Valuation Test FIFO', 'Part', 'Buy', 'Inventory', 'EA', cid, uid)
  RETURNING id INTO itm_fifo;
  INSERT INTO "item" ("readableId", "name", "type", "replenishmentSystem",
                      "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
  VALUES ('VALTEST-STD', 'Valuation Test Standard', 'Part', 'Buy', 'Inventory', 'EA', cid, uid)
  RETURNING id INTO itm_std;
  INSERT INTO "item" ("readableId", "name", "type", "replenishmentSystem",
                      "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
  VALUES ('VALTEST-ZERO', 'Valuation Test Zero', 'Part', 'Buy', 'Inventory', 'EA', cid, uid)
  RETURNING id INTO itm_zero;

  UPDATE "itemCost" SET "costingMethod" = 'FIFO', "unitCost" = 99
   WHERE "itemId" = itm_fifo AND "companyId" = cid;
  UPDATE "itemCost" SET "costingMethod" = 'Standard', "standardCost" = 5, "unitCost" = 0
   WHERE "itemId" = itm_std AND "companyId" = cid;

  -- FIFO quantities: 80 @ A, 30 @ B (total 110)
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId",
                            "quantity", "companyId", "createdBy")
  VALUES ('Purchase', 'Purchase Receipt', itm_fifo, loc_a, 80, cid, uid),
         ('Purchase', 'Purchase Receipt', itm_fifo, loc_b, 30, cid, uid);

  -- FIFO layers: L1 qty 100 cost 1000 remaining 60; L2 qty 50 cost 600 remaining 50.
  -- Child on L1: +55 (appliesToCostLedgerId).
  -- Effective = (60*(1000+55)/100 + 50*600/50) / 110 = (633 + 600) / 110 = 11.2090909...
  INSERT INTO "costLedger" ("itemLedgerType", "costLedgerType", "itemId",
                            "quantity", "cost", "remainingQuantity", "companyId")
  VALUES ('Purchase', 'Direct Cost', itm_fifo, 100, 1000, 60, cid)
  RETURNING id INTO l1;
  INSERT INTO "costLedger" ("itemLedgerType", "costLedgerType", "itemId",
                            "quantity", "cost", "remainingQuantity", "companyId")
  VALUES ('Purchase', 'Direct Cost', itm_fifo, 50, 600, 50, cid)
  RETURNING id INTO l2;
  INSERT INTO "costLedger" ("itemLedgerType", "costLedgerType", "adjustment",
                            "appliesToCostLedgerId", "itemId", "quantity", "cost",
                            "remainingQuantity", "companyId")
  VALUES ('Purchase', 'Variance', true, l1, itm_fifo, 100, 55, 0, cid);

  -- Standard: 10 @ A. Zero-sum item: +5/-5 @ A (must be excluded).
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId",
                            "quantity", "companyId", "createdBy")
  VALUES ('Purchase', 'Purchase Receipt', itm_std, loc_a, 10, cid, uid),
         ('Purchase', 'Purchase Receipt', itm_zero, loc_a, 5, cid, uid),
         ('Negative Adjmt.', 'Inventory Shipment', itm_zero, loc_a, -5, cid, uid);

  -- Assert 1: FIFO @ A = 80 x 11.20909... = 896.73
  SELECT * INTO r FROM get_inventory_valuation(cid, NULL, NULL)
   WHERE "itemId" = itm_fifo AND "locationId" = loc_a;
  IF r IS NULL OR ROUND(r."totalValue", 2) <> 896.73 OR r."quantityOnHand" <> 80 THEN
    RAISE EXCEPTION 'FAIL FIFO@A: qty=%, value=%', r."quantityOnHand", r."totalValue";
  END IF;
  RAISE NOTICE 'PASS: FIFO layer math @ A (896.73)';

  -- Assert 2: FIFO @ B = 30 x 11.20909... = 336.27; item total = 1233.00
  SELECT * INTO r FROM get_inventory_valuation(cid, NULL, NULL)
   WHERE "itemId" = itm_fifo AND "locationId" = loc_b;
  IF ROUND(r."totalValue", 2) <> 336.27 THEN
    RAISE EXCEPTION 'FAIL FIFO@B: value=%', r."totalValue";
  END IF;
  SELECT SUM("totalValue") INTO v_total FROM get_inventory_valuation(cid, NULL, NULL)
   WHERE "itemId" = itm_fifo;
  IF ROUND(v_total, 2) <> 1233.00 THEN
    RAISE EXCEPTION 'FAIL FIFO total: %', v_total;
  END IF;
  RAISE NOTICE 'PASS: FIFO split + remaining-layer total (1233.00)';

  -- Assert 3: Standard valued at standardCost (10 x 5 = 50), not unitCost (0)
  SELECT * INTO r FROM get_inventory_valuation(cid, NULL, NULL)
   WHERE "itemId" = itm_std;
  IF ROUND(r."totalValue", 2) <> 50.00 OR r."costingMethod" <> 'Standard' THEN
    RAISE EXCEPTION 'FAIL Standard: value=%', r."totalValue";
  END IF;
  RAISE NOTICE 'PASS: Standard basis (50.00)';

  -- Assert 4: zero-sum item excluded
  IF EXISTS (SELECT 1 FROM get_inventory_valuation(cid, NULL, NULL) WHERE "itemId" = itm_zero) THEN
    RAISE EXCEPTION 'FAIL: zero-quantity item present';
  END IF;
  RAISE NOTICE 'PASS: HAVING <> 0 exclusion';

  -- Assert 5: dated query excludes today's rows (fixtures post today)
  IF EXISTS (SELECT 1 FROM get_inventory_valuation(cid, CURRENT_DATE - 1, NULL)
             WHERE "itemId" IN (itm_fifo, itm_std)) THEN
    RAISE EXCEPTION 'FAIL: as-of-date did not exclude today''s postings';
  END IF;
  RAISE NOTICE 'PASS: as-of-date postingDate filter';

  -- Assert 6: tie-out returns 2 rows (or 0 if accountDefault missing — then NOTICE)
  IF (SELECT COUNT(*) FROM get_inventory_tie_out(cid, NULL)) NOT IN (0, 2) THEN
    RAISE EXCEPTION 'FAIL: tie-out row count';
  END IF;
  RAISE NOTICE 'PASS: tie-out shape';

  -- Assert 7: status breakdown — a Rejected tracked entity is VALUED (all
  -- physical stock counts) and surfaces in quantityRejected.
  DECLARE
    te TEXT;
  BEGIN
    INSERT INTO "trackedEntity" ("readableId", "quantity", "status", "companyId", "createdBy")
    VALUES ('VALTEST-TE-1', 5, 'Rejected', cid, uid)
    RETURNING id INTO te;
    INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId",
                              "quantity", "trackedEntityId", "trackedEntityStatus",
                              "companyId", "createdBy")
    VALUES ('Purchase', 'Purchase Receipt', itm_std, loc_a, 5, te, 'Rejected', cid, uid);

    SELECT * INTO r FROM get_inventory_valuation(cid, NULL, NULL)
     WHERE "itemId" = itm_std AND "locationId" = loc_a;
    -- 10 untracked + 5 rejected tracked = 15 valued at standardCost 5 => 75
    IF r."quantityOnHand" <> 15 OR r."quantityRejected" <> 5
       OR ROUND(r."totalValue", 2) <> 75.00 THEN
      RAISE EXCEPTION 'FAIL status breakdown: qty=%, rejected=%, value=%',
        r."quantityOnHand", r."quantityRejected", r."totalValue";
    END IF;
    RAISE NOTICE 'PASS: rejected stock valued + bucketed (15 / 5 / 75.00)';
  END;
END
$test$;
ROLLBACK;
```

3. Run it against the local worktree DB as `supabase_admin` (port from `.env.local`):

```bash
PORT_DB=$(grep '^PORT_DB=' .env.local | cut -d= -f2)
psql "postgresql://supabase_admin:postgres@127.0.0.1:${PORT_DB}/postgres" \
  -v ON_ERROR_STOP=1 -f .ai/scratch/validate-inventory-valuation.sql
```

4. If an `INSERT` fails on a NOT NULL column not listed here (e.g. `item` or
   `trackedEntity` gained a required column), add that column to the INSERT with a
   sensible literal and re-run. If the `itemCost` UPDATE affects 0 rows
   (interceptor did not fire), STOP and report — do not hand-insert `itemCost`.
5. Expected-cost math note: if Assert 1 fails with value 896.72 vs 896.73, the
   difference is rounding order — STOP and report rather than adjusting the
   expected value; the assert values are exact for `ROUND(80 * (1233.0/110), 2)`.

**Verify:**
```bash
# (the psql run above)
# Expected: seven lines "PASS: ..." and final "ROLLBACK"; exit code 0
grep -c "get_inventory_valuation" packages/database/src/types.ts
# Expected: >= 1 (types regenerated with the new RPC)
```

**Out of scope:** committing the scratch SQL; seeding permanent fixtures;
refreshing `itemLedgerSnapshot`; hand-editing the regenerated types.

---

## Task 3: Service functions + row types in the inventory module

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — add `getInventoryValuation`, `getInventoryValuationTieOut` (place near `getInventoryItems`)
- Modify: `apps/erp/app/modules/inventory/types.ts` — add `InventoryValuationRow`, `InventoryTieOutRow`
- Copy from (precedent): `apps/erp/app/modules/invoicing/invoicing.service.ts` `getArTieOut` (~line 2286) for the rpc-wrapper shape

**Steps:**

1. In `inventory.service.ts`, add (client-first, `{data, error}` return, no
   throw; the RPC names are fully typed because Task 2 regenerated types):

```typescript
export async function getInventoryValuation(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { asOfDate?: string | null; locationId?: string | null }
) {
  return client.rpc("get_inventory_valuation", {
    company_id: companyId,
    as_of_date: args.asOfDate ?? undefined,
    location_id: args.locationId ?? undefined,
  });
}

export async function getInventoryValuationTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate?: string | null
) {
  return client.rpc("get_inventory_tie_out", {
    company_id: companyId,
    as_of_date: asOfDate ?? undefined,
  });
}
```

   If the generated `Args` type requires `null` rather than `undefined` for the
   optional params, use `?? null` instead — match whatever typecheck accepts.

2. In `types.ts`, derive the row types through the standard type chain
   (`Awaited<ReturnType<...>>`, the repo convention):

```typescript
import type {
  getInventoryValuation,
  getInventoryValuationTieOut,
} from "./inventory.service";

export type InventoryValuationRow = NonNullable<
  Awaited<ReturnType<typeof getInventoryValuation>>["data"]
>[number];

export type InventoryTieOutRow = NonNullable<
  Awaited<ReturnType<typeof getInventoryValuationTieOut>>["data"]
>[number];
```

   Match the file's existing import/derivation style (it already uses
   `Awaited<ReturnType<typeof ...>>` for other service functions — copy the
   nearest example exactly, including whether the functions are imported as
   types or values). The module barrel (`index.ts`) already re-exports service +
   types — verify (`export * from "./types"` / `"./inventory.service"`); add the
   export line only if missing.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck
# Expected: exits 0, no new errors
```

**Out of scope:** `inventory.models.ts` (no forms on this feature); touching
`getInventoryItems`; edge functions.

---

## Task 4: Path helper + sidebar nav entry

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add `inventoryValuation` near the existing inventory entries (~line 1068)
- Modify: `apps/erp/app/modules/inventory/ui/useInventorySubmodules.tsx` — add a "Valuation" route to the **Track** group
- Copy from (precedent): existing entries in both files

**Steps:**

1. `path.ts`, next to `inventory: \`${x}/inventory/quantities\``, add:
   `inventoryValuation: \`${x}/inventory/valuation\`,` (keep alphabetical-ish local
   ordering with the other `inventory*` keys).
2. `useInventorySubmodules.tsx`: the hook returns `{ groups }` filtered by
   `permissions`. Add to the "Track" group's `routes` array an entry shaped like
   its siblings:

```typescript
{
  name: t`Valuation`,
  to: path.to.inventoryValuation,
  icon: <LuChartColumn />,
}
```

   Import `LuChartColumn` from `react-icons/lu` (if that icon name doesn't exist in
   the installed version, pick another `Lu*` chart icon already used in the app —
   grep `react-icons/lu` imports). Gate it on accounting view: the hook already has
   `permissions` in scope (it filters by `permissions.is(...)`) — wrap the entry so
   it is only included when `permissions.can("view", "accounting")`. Follow the
   hook's existing filtering style: if routes support a `role` field only, filter
   the entry with a conditional spread:

```typescript
...(permissions.can("view", "accounting")
  ? [{ name: t`Valuation`, to: path.to.inventoryValuation, icon: <LuChartColumn /> }]
  : []),
```

   If `permissions.can` is not available in the hook, import `usePermissions` from
   `~/hooks` (it is the app's standard permissions hook). If the hook has no `t`
   macro, follow whatever its sibling entries do for names (match the file's
   existing i18n style exactly).

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck
# Expected: exits 0
grep -n "inventoryValuation" apps/erp/app/utils/path.ts apps/erp/app/modules/inventory/ui/useInventorySubmodules.tsx
# Expected: one hit in each file
```

**Out of scope:** new nav groups; changing other groups' entries; MES nav.

---

## Task 5: Workbench UI component

**Depends on:** Task 3 (types). Independent of Task 4.
**Files:**
- Create: `apps/erp/app/modules/inventory/ui/Valuation/InventoryValuationWorkbench.tsx`
- Create: `apps/erp/app/modules/inventory/ui/Valuation/index.ts` (barrel: `export { default as InventoryValuationWorkbench } from "./InventoryValuationWorkbench"` — match the export style of a sibling `ui/*/index.ts`)
- Modify: `apps/erp/app/modules/inventory/ui/index.ts` (or wherever sibling ui folders are re-exported — mirror how `ui/Receipts` etc. are exported; if ui folders are imported directly rather than barreled, skip this file)
- Copy from (precedent): `apps/erp/app/modules/invoicing/ui/Workbench/ARAPWorkbench.tsx` — clone its structure: union row type (lines ~92–204), heterogeneous columns (~236–396), filter bar with tie-out Popover + DatePicker + Select (~403–532)

**Steps:**

1. Clone the ARAPWorkbench skeleton and adapt:
   - **Props:** `{ rows: InventoryValuationRow[]; tieOut: InventoryTieOutRow[] | null; asOfDate: string; groupBy: "location" | "item"; locationId: string | null; locations: { id: string; name: string }[] }`.
   - **Row model:** `type ValuationRow = { kind: "group"; id: string; label: string; quantityOnHand: number; totalValue: number; pctOfTotal: number } | { kind: "detail"; ...InventoryValuationRow; pctOfTotal: number }`. Group rows are locations when `groupBy === "location"` (details = items at that location) and items when `groupBy === "item"` (details = locations holding that item). Compute groups + grand total with `useMemo` from `rows`; maintain `expandedIds` state exactly like ARAPWorkbench (chevron toggle on group rows, details rendered when expanded).
   - **Columns:** group/item label (with expand chevron on group rows), Costing Method (detail rows only, `groupBy === "location"`), Qty On Hand, On Hold, Rejected, UoM (detail only), Unit Cost (detail only), Total Value (bold on group rows), % of Total. Numeric formatting: `useCurrencyFormatter` for money (see its use in ARAPWorkbench) and plain number formatting for quantities. Style negative `quantityOnHand`/`totalValue` with the destructive text class used by ARAPWorkbench for negative amounts (grep `text-destructive` in that file; reuse the same class).
   - **Detail-row drill-through:** the item label on detail rows links to `path.to.inventoryItemActivity(itemId)`.
   - **Filter bar** (top, HStack — clone ARAPWorkbench's):
     - Tie-out `Popover` (only when `tieOut !== null`): a small table with one row per `tieOut` entry — Account (name), Subledger, GL Balance, Variance — plus a totals row; a muted caveat line: `t\`Manual quantity adjustments don't post to the GL yet, so a nonzero variance is expected if you cycle count.\``
     - Group-by `Select` with options Location / Item → `setParams({ groupBy })`.
     - Location combobox (options from `locations`, plus "All locations") → `setParams({ locationId })`.
     - `DatePicker` for asOfDate → `setParams({ asOfDate })` (clone ARAPWorkbench lines ~524–530).
   - **Semantics label:** when `asOfDate` is before today, render a muted inline note above the table: `t\`Values apply today's unit costs to historical quantities.\``
   - **Table + CSV:** use the same ERP `Table` component ARAPWorkbench uses so CSV export comes free (`.ai/rules/table-csv-export.md`); set `meta.exportValue` on money columns if ARAPWorkbench does.
   - **i18n:** every user-visible string through `useLingui().t` or `<Trans>` from `@lingui/react/macro` — never `t` from `@lingui/core/macro`.
2. Do not add charts, saved views, or storage-unit drill-down (spec: out of scope).

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck
# Expected: exits 0
pnpm exec biome check apps/erp/app/modules/inventory/ui/Valuation
# Expected: "Checked N files" with 0 errors
```

**Out of scope:** Recharts/graphs; editing ARAPWorkbench; TanStack saved-view
`table:` registration; MES.

---

## Task 6: Route `/x/inventory/valuation`

**Depends on:** Tasks 3, 4, 5
**Files:**
- Create: `apps/erp/app/routes/x+/inventory+/valuation.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/invoicing+/receivables.tsx` (loader shape, accountingEnabled gate, param parsing)

**Steps:**

1. Create the route with this structure (adapted from receivables.tsx):

```typescript
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getInventoryValuation,
  getInventoryValuationTieOut,
} from "~/modules/inventory";
import { InventoryValuationWorkbench } from "~/modules/inventory/ui/Valuation";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Valuation",
  to: path.to.inventoryValuation,
  module: "inventory",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
  });

  const url = new URL(request.url);
  const asOfDate =
    url.searchParams.get("asOfDate") ?? new Date().toISOString().slice(0, 10);
  const groupBy: "location" | "item" =
    url.searchParams.get("groupBy") === "item" ? "item" : "location";
  const locationId = url.searchParams.get("locationId") || null;

  const companySettings = await getCompanySettings(client, companyId);
  const accountingEnabled =
    (companySettings.data as { accountingEnabled?: boolean } | null)
      ?.accountingEnabled ?? false;

  const [valuation, tieOut, locations] = await Promise.all([
    getInventoryValuation(client, companyId, { asOfDate, locationId }),
    accountingEnabled
      ? getInventoryValuationTieOut(client, companyId, asOfDate)
      : Promise.resolve({ data: null, error: null }),
    client
      .from("location")
      .select("id, name")
      .eq("companyId", companyId)
      .order("name"),
  ]);

  return {
    asOfDate,
    groupBy,
    locationId,
    rows: valuation.data ?? [],
    tieOut: tieOut.data ?? null,
    locations: locations.data ?? [],
  };
}

export default function InventoryValuationRoute() {
  const { asOfDate, groupBy, locationId, rows, tieOut, locations } =
    useLoaderData<typeof loader>();
  return (
    <InventoryValuationWorkbench
      rows={rows}
      tieOut={tieOut}
      asOfDate={asOfDate}
      groupBy={groupBy}
      locationId={locationId}
      locations={locations}
    />
  );
}
```

2. Check `valuation.error` handling convention: receivables.tsx ignores `.error`
   and defaults to `[]`; per lesson "check `.error`, don't `?? []` a failed query
   into silent emptiness", improve on the precedent: if `valuation.error` is
   non-null, `throw new Error(valuation.error.message)` so the route error
   boundary surfaces it instead of rendering an empty report.
3. If `~/modules/inventory` barrel does not re-export the new service functions
   (Task 3 verified it), import from the service file path the barrel uses.
   If the breadcrumb convention in sibling inventory routes uses `msg\`...\``
   descriptors instead of plain strings, match the sibling exactly (check
   `apps/erp/app/routes/x+/inventory+/quantities.tsx`'s `handle`).

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck
# Expected: exits 0
grep -rn "view: \"accounting\"" apps/erp/app/routes/x+/inventory+/valuation.tsx
# Expected: 1 hit (the permission gate)
```

**Out of scope:** clientLoader caching; actions/mutations; changing
receivables.tsx.

---

## Task 7: Final verification sweep

**Depends on:** Tasks 1–6
**Files:** none (verification only)

**Steps:**

1. Run the scoped gates:

```bash
pnpm --filter @carbon/erp typecheck
pnpm exec biome check apps/erp/app/modules/inventory apps/erp/app/routes/x+/inventory+ apps/erp/app/utils/path.ts
```

2. Confirm the regenerated types were committed with the migration (Task 2's
   commit) and still contain the new RPCs:

```bash
git status --porcelain packages/database/src/
# Expected: empty (regenerated files were committed, not left dirty)
grep -c "get_inventory_valuation\|get_inventory_tie_out" packages/database/src/types.ts
# Expected: >= 2
```

3. Re-run the Task 2 psql validation once more against the applied DB (same
   command) — expected: all PASS lines, ROLLBACK.
4. Note in the run record (`.ai/runs/2026-07-14-inventory-value-report.md`) that
   browser verification was deselected by the user; suggest they verify manually:
   `crbn up`, log in, open `/x/inventory/valuation` with an accounting-view user,
   check group toggle, as-of label, tie-out popover, CSV download.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck && echo GATES-GREEN
# Expected: GATES-GREEN
```

**Out of scope:** committing (handled per task by /check-and-commit during
execute); pushing; PR creation (user decides).

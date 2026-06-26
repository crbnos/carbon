# Material Supersession

Last tested: 2026-06-24
Routes: `/x/part/$itemId/planning` (config), `/x/purchasing/planning`, `/x/production/planning` (Recalculate)

## What the feature does
Redirects demand from a discontinued item to its successor during MRP, and swaps
superseded components at job creation. Config lives on the Part → Planning tab
(`ItemSupersessionForm`). Modes: `Consume First`, `Prefer New`, `Stock Only`, `No Stock`.
Fields: supersessionMode, discontinuationDate, successorItemId, successorEffectivityDate,
conversionFactor; `minimumReserveQuantity` lives on `itemPlanning` (per location).

## ENVIRONMENT GOTCHAS (critical)
- The **claude.ai Carbon MCP** server points at a hosted instance (company "Acme Inc.",
  id SMBHQP55…) — NOT this branch's local DB. Do NOT use MCP `items_upsertPart` for
  local browser testing; the parts land in the wrong database/company.
- The **browser dev-bypass** (`test@carbon.ms`) is an employee of local company
  "Carbon Development" (id d8u703oeq0gg2jnc1k2g) only. Local DB: `localhost:<port>`
  from `.env.local` SUPABASE_DB_URL.
- The shared `agent-browser` is used by ALL worktree agents at once; another worktree
  will hijack the active tab. Pin every command with `agent-browser tab <n>`.
- Combobox/option refs re-render on async chart loads — snapshot+click must be in the
  SAME bash command, or refs go stale ("Unknown ref").

## Fast fixture setup (local DB, bypasses contended browser)
Parts: insert `item` (type Part) + `part` rows directly — the `trg_event_after_sync_item`
AFTER INSERT trigger auto-creates itemCost/itemReplenishment/itemPlanning/makeMethod.
- itemSupersession: one row per old item (mode, successorItemId, discontinuationDate ≤ today,
  successorEffectivityDate ≤ today, conversionFactor).
- BOM: `methodMaterial` rows on the parent's makeMethod id (itemType 'Part', methodType
  'Purchase to Order'/'Pull from Inventory', effectiveFrom/effectiveTo for line effectivity).
- On-hand: `itemLedger` (entryType 'Positive Adjmt.', itemId, locationId, quantity, companyId, createdBy).
- Stock Only reserve: UPDATE itemPlanning SET reorderingPolicy='Fixed Reorder Quantity',
  reorderPoint=1, minimumReserveQuantity=N.
- Demand: `demandProjection` (itemId, locationId, periodId, forecastQuantity) on the current
  week period. NOTE: independent (top-level) demand on a leaf Buy item does NOT surface in
  planning output — only **BOM-derived** (dependent) demand does. To test redirection put the
  old item in a parent's BOM.

## Run MRP (= the Recalculate button)
`POST https://api.<branch>.dev/functions/v1/mrp` with header
`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, body
`{"type":"company","id":"<companyId>","companyId":"<companyId>","userId":"<userId>"}`.
First call also creates the weekly `period` rows. Returns `{"success":true}`.

## Inspect / assert
- `demandForecastSource` (cols: itemId=successor, redirectedFromItemId=old, parentItemId,
  quantity in successor units) — the redirection lineage.
- `get_purchasing_planning(company_id, location_id, periods[])` and
  `get_production_planning(...)` — quantityToOrder, supersessionMode, minimumReserveQuantity.
  periods[] = `select id from period where "periodType"='Week' order by "startDate" limit 18`.
- Job substitution: insert a `public.job` row, invoke `get-method` body
  `{"type":"itemToJob","sourceId":"<itemId>","targetId":"<jobId>","companyId":..,"userId":..}`,
  then read `jobMaterial.substitutedFromItemId` / `substitutionFactor`.

## Browser verification (after data is set up)
- Purchasing/Production Planning tables show successors with "Order N"/"Make N"; old parts absent.
- Recalculate button (top of planning page) disables while running, re-renders same results.
- Part → Planning → Supersession shows mode + successor (with PHASE-OUT/OBSOLETE/SPARES-ONLY badge).
- Chain: a part whose successor is itself superseded shows "Supersession chain detected: A → B → C".
- Self-supersession: the successor picker excludes the part itself.

## Expected results for the canonical fixture (FG BOM consumes OLD1×1, OLD2×2, CHAIN-A×1, M-OLD×1; FG demand 100)
- NEW1 = 100 (Prefer New, factor 1) | NEW2 = 400 (Consume First, factor 2: 200×2)
- CHAIN-C = 100 (chain A→B→C collapse) | M-NEW = 100 in production planning (Make→Make)
- SPARE = 80 (reserve 100 − on-hand 20) | OLD1/OLD2/CHAIN-A/B/OBS/M-OLD excluded
- BOM-line effectivity: a future effectiveFrom or past effectiveTo line is skipped (no demand).

# Inventory Valuation Report — Interactive Value by Location and by Item

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-14
> Research: `.ai/research/inventory-value-report.md` (SAP / NetSuite / BC / Fishbowl / Odoo survey + per-location-costing addendum)
> Run record: `.ai/runs/2026-07-14-inventory-value-report.md`
> Companions: `.ai/specs/2026-07-04-inventory-valuation-completeness.md` (costing engine — revaluation, LCNRV, adjustment GL; this report reads the layer math that spec defines) · `.ai/specs/2026-07-13-raw-materials-finished-goods-accounts.md` (the RM/FG account split the tie-out panel reads)

## TLDR

A new **Inventory Valuation** report at `/x/inventory/valuation`: an interactive,
URL-state-driven screen showing inventory value grouped **by Location → items**
(default) or **by Item → locations**, with group subtotals, a grand total, % of
total, CSV export, an **as-of-date** selector (historical quantities exact from
`itemLedger.postingDate`; costs always current — labeled, SAP-Fiori-style), and a
**GL tie-out panel** (MB5L shape: one row per stock account — Raw Materials,
Finished Goods — comparing subledger value to GL balance). Value is
**method-faithful carrying cost**: FIFO/LIFO items use remaining cost-layer value
(including `appliesToCostLedgerId` adjustment children), Average uses
`itemCost.unitCost`, Standard uses `itemCost.standardCost`. All physical stock is
valued — On Hold and Rejected quantities are included in value and broken out in
their own columns (SAP MB52 stock-bucket precedent), because rejected stock remains
an asset until a write-off posts. Backed by one new RPC
(`get_inventory_valuation`), one service function pair, and one workbench component
cloned from the AR/AP aging precedent. Gated by `accounting_view`. No new tables;
the dead `get_inventory_value_by_location` RPC is kept (deprecated) for API
compatibility.

## Problem Statement

Verified current state:

1. **There is no inventory valuation surface anywhere in the app.** The only
   artifact is the RPC `get_inventory_value_by_location`
   (`packages/database/supabase/migrations/20260325031223_inventory-value-report.sql`)
   with **zero app callers** — it appears only in generated types and the swagger
   docs schema. Users cannot answer "what is our inventory worth, by site or by
   item" without SQL.
2. **The dead RPC's math is wrong for the books.** It values every item at
   `itemCost.unitCost` — but FIFO/LIFO items are carried in **cost layers**
   (`costLedger.remainingQuantity`, adjustment children via
   `appliesToCostLedgerId`, per `20260504000000_cost-layers.sql` and the
   completeness spec), and Standard items are costed at `standardCost`
   (`calculate-cogs.ts:38-45`). It is also not status-aware and takes no date.
3. **Every surveyed competitor ships this report** (research file §Key Consensus
   Patterns): NetSuite Inventory Valuation Summary/Detail, BC report 1001 + Power
   BI by-Item/by-Location, Fishbowl Inventory Valuation Summary (Group By =
   exactly Location | Item), SAP MB52/MB5L. Carbon's `itemLedger` is
   location-grained, so Carbon can do by-location valuation out of the box —
   something core Odoo cannot.
4. **The AR/AP workbench established the exact UI pattern** this report needs
   (`apps/erp/app/routes/x+/invoicing+/receivables.tsx` +
   `apps/erp/app/modules/invoicing/ui/Workbench/ARAPWorkbench.tsx`): URL-param
   loader, grouped union-row table with expand/collapse, tie-out popover, date
   picker — but nothing reuses it for inventory.

## Resolved Questions (grill, answered before writing, 2026-07-14)

- [x] **Valuation basis?** — **Method-faithful carrying cost.** FIFO/LIFO =
  remaining layer value incl. applied adjustment children (fallback
  `itemCost.unitCost` when an item has no layers); Average = `itemCost.unitCost`;
  Standard = `itemCost.standardCost`. Per-location row value = location qty ×
  company-level effective unit cost. Ties to the subledger and matches the
  completeness spec's carrying-cost CTE.
- [x] **Value Rejected / On Hold stock?** — **Yes, value all physical on-hand**,
  with `quantityOnHold` / `quantityRejected` breakdown columns. Rejected stock is
  an asset until written off (no write-off mechanism exists today); SAP MB52
  values blocked stock the same way. Excluding it would create a permanent
  unexplained gap vs the GL.
- [x] **As-of-date in v1?** — **Yes (overrode the defer recommendation), with
  explicitly labeled approximate-cost semantics**: quantities are exact
  (`itemLedger.postingDate <= asOfDate`); unit costs are always **today's**
  effective costs (SAP Fiori's documented "fast" semantics). Permanent UI label
  when a past date is selected. Two labeled caveats: the `itemLedgerSnapshot`
  matview has no date grain, so dated queries aggregate the raw ledger; the
  status breakdown reflects *current* tracked-entity statuses even at past dates.
- [x] **GL tie-out panel in v1?** — **Yes (overrode the defer recommendation).**
  Per-account rows (SAP MB5L shape): Raw Materials and Finished Goods — subledger
  value vs GL balance vs variance, plus total. Accounts resolve via
  `accountDefault.rawMaterialsAccount` / `finishedGoodsAccount`
  (`resolveInventoryAccount`, `shared/get-posting-group.ts:18`; split migration
  `20260713190909`). Rendered only when `companySettings.accountingEnabled`. WIP
  excluded. Panel copy carries a known-noise caveat: manual quantity adjustments
  do not post GL until completeness-spec §4 lands, so variance is expected
  nonzero for companies that cycle-count.
- [x] **Drop the dead `get_inventory_value_by_location` RPC?** — **No — keep it,
  deprecated.** Zero API-breakage risk accepted; the new `get_inventory_valuation`
  ships alongside. Its swagger description gains a deprecation note.
- [x] **Permission scope?** — **`accounting_view` gates the entire report**
  (strictest option). The nav entry lives in the Inventory sidebar but renders
  only for users with `accounting_view`; unit costs and GL balances never reach
  ops-only roles.

Pre-grill decision (recorded in the research addendum + run record):
**`costLedger` does NOT gain `locationId`.** Layer consumption is company-wide
(`calculate-cogs.ts:65` has no location filter), transfers write no cost entries
(`post-stock-transfer`), revaluations are company-scoped — a stamped column would
never balance per location. Per-location value is derived at report time as
location qty × company-level effective unit cost (SAP below-plant / SAP B1
company-level / Fishbowl semantics). True per-location costing (SAP per-plant,
NetSuite MLI) is an industry-validated future spec of its own; this report's data
contract keeps a per-row `unitCost` so a location-scoped cost can slot in later
without reshaping the UI.

## Proposed Solution

### 1. Report semantics

One screen, one RPC, two groupings:

- **Group by Location** (default): location group rows (subtotal qty-value) →
  item child rows. Fishbowl's default.
- **Group by Item**: item group rows (total across locations) → location child
  rows.

Columns (research §7 consensus): Item (readableId + name) / Location, Costing
Method, Qty On Hand, On Hold, Rejected, UoM, Unit Cost, Total Value, % of Total.
Group rows show subtotal value + % of grand total; a footer row shows the grand
total. Rows with zero on-hand are excluded (`HAVING SUM(quantity) <> 0`);
negative on-hand rows are shown (data-quality signal), styled as destructive.

**Effective unit cost** (company-level, per item):

| Costing method | Basis |
|---|---|
| FIFO / LIFO | `Σ remainingQuantity × (layer.cost + Σ applied children) / layer.quantity` ÷ `Σ remainingQuantity` over layers with `remainingQuantity > 0`; fallback `itemCost.unitCost` when the item has no open layers |
| Average | `itemCost.unitCost` |
| Standard | `itemCost.standardCost` |

The FIFO/LIFO expression is the completeness spec's carrying CTE (its §3 query).
Implementation must stay consistent with how `calculate-cogs.ts` consumes
adjustment children — a unit test pins the two together (see Risks).

**As-of-date**: `asOfDate` URL param (default today). Quantities aggregate
`itemLedger` rows with `postingDate <= asOfDate`. Costs are always current-state.
When `asOfDate` < today the UI shows a persistent inline label:
*"Values apply today's unit costs to historical quantities."*

### 2. New RPC — `get_inventory_valuation`

`get_inventory_valuation(company_id TEXT, as_of_date DATE DEFAULT NULL, location_id TEXT DEFAULT NULL)`

Returns one row per (item, location) with non-zero quantity:
`locationId, locationName, itemId, readableIdWithRevision, name, type,
replenishmentSystem, unitOfMeasureCode, costingMethod, quantityOnHand,
quantityOnHold, quantityRejected, unitCost, totalValue`.

- `quantityOnHand` = full physical sum (all tracked-entity statuses included).
  `quantityOnHold` / `quantityRejected` bucket by `itemLedger.trackedEntityStatus`
  (denormalized, current — `20260420112047`).
- **Current-date path** (`as_of_date IS NULL OR as_of_date >= CURRENT_DATE`):
  snapshot + delta, exactly the `get_inventory_quantities` pattern
  (`20260713235406_item-ledger-snapshot.sql`) — `itemLedgerSnapshot` for untracked
  rows older than the cutoff, live delta for newer + all tracked rows. NOTE: the
  snapshot's status-blind `quantity` is fine because untracked rows have no
  status; buckets come only from tracked (live) rows.
- **Dated path**: raw `itemLedger` aggregation filtered by `postingDate`.
  Supported by the `20260713224517` ledger indexes; `location_id` narrows the
  scan.
- `replenishmentSystem` is returned so the app can classify each row to its stock
  account (Make / Buy and Make → Finished Goods, else Raw Materials — mirroring
  `resolveInventoryAccount`) for the tie-out's per-account subledger sums.
- `SECURITY DEFINER`, same as `get_inventory_quantities` (required to read the
  REVOKEd matview), `company_id` parameter scoping, `SET search_path = public`.

The old `get_inventory_value_by_location` is untouched (kept per grill Q5) apart
from a `COMMENT ON FUNCTION` deprecation note pointing at the new RPC.

### 3. GL tie-out — `getInventoryValuationTieOut`

Service function (precedent: `getArTieOut`, `invoicing.service.ts:2286`):

- **Subledger side**: the report rows' `totalValue`, summed per account class
  (RM / FG via `replenishmentSystem`), at the same `asOfDate`.
- **GL side**: balance per account = `Σ journalLine.amount` for
  `accountDefault.rawMaterialsAccount` and `accountDefault.finishedGoodsAccount`
  where `postingDate <= asOfDate` (accounts resolved **by id** from
  `accountDefault` — never by number, per `.ai/lessons.md`).
- Output: `[{ accountKind: 'rawMaterials' | 'finishedGoods', accountId, accountName,
  subledgerValue, glBalance, variance }]` + totals row.
- Rendered as an ARAPWorkbench-style Popover panel; visible only when
  `accountingEnabled`. Panel copy includes the caveat: *"Manual quantity
  adjustments do not yet post to the GL — nonzero variance is expected if you
  cycle-count."* (removable once completeness-spec §4 ships).

### 4. Route, service, UI

- **Route**: `apps/erp/app/routes/x+/inventory+/valuation.tsx`.
  `requirePermissions(request, { view: "accounting" })`. Parses `asOfDate`,
  `groupBy` (`location` | `item`, default `location`), `locationId` (optional
  filter, default all locations). Parallel loads: `getInventoryValuation`,
  `getInventoryValuationTieOut` (only when `accountingEnabled`), locations list.
  Plain-object return (no `Response.json`).
- **Service** (`inventory.service.ts`): `getInventoryValuation(client, companyId,
  { asOfDate, locationId })` → RPC call; `getInventoryValuationTieOut(client,
  companyId, asOfDate)`. Types flow via `Awaited<ReturnType<...>>` in
  `types.ts`.
- **UI**: `apps/erp/app/modules/inventory/ui/Valuation/InventoryValuationWorkbench.tsx`
  cloned from `ARAPWorkbench.tsx`: union row type
  `{ kind: "group" | "detail" }`, `expandedIds` state, expand/collapse chevrons,
  group subtotal styling, grand-total footer; filter bar with `DatePicker`
  (asOfDate → `setParams`), group-by `Select`, `Location` combobox, tie-out
  `Popover`. Uses the ERP `Table` component → CSV export comes free
  (`.ai/rules/table-csv-export.md`); currency via `useCurrencyFormatter`; all
  strings through `useLingui`/`<Trans>`.
- **Drill-through**: item detail rows link to
  `path.to.inventoryItemActivity(itemId)` (the existing ledger activity page) —
  the "Detail report" level every competitor pairs with the summary.
- **Nav**: new entry **Valuation** in `useInventorySubmodules` "Track" group,
  rendered only when `permissions.can("view", "accounting")`; `path.to.
  inventoryValuation = ${x}/inventory/valuation` in `path.ts`.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Multi-tenancy (heuristic 1) | No new tables. RPC takes `company_id`, `SECURITY DEFINER` + explicit company scoping, mirroring `get_inventory_quantities` | Only correct way to read the REVOKEd `itemLedgerSnapshot`; the exact precedent this repo blessed in `20260713235406` |
| 2 | Service shape (heuristic 2) | `getInventoryValuation` / `getInventoryValuationTieOut` in `inventory.service.ts`, client-first, `{data,error}` | One service file per module; RPC via `client.rpc()` returns `{data,error}` naturally |
| 3 | RLS (heuristic 3) | N/A — no new tables; function follows the SECURITY DEFINER quantity-function pattern | Same guard model as `get_inventory_quantities` |
| 4 | Permissions (heuristic 4) | `view: "accounting"` on the route; nav entry gated by `permissions.can("view", "accounting")` | Grill Q6 (Brad): strictest — costs never reach ops-only roles |
| 5 | Forms (heuristic 5) | N/A — URL-param-driven report (`useUrlParams`/`setParams`), no ValidatedForm | AR/AP workbench precedent; no mutations on this screen |
| 6 | Module layout (heuristic 6) | Report lives in the **inventory** module (`ui/Valuation/`), permission from accounting | Inventory is the domain home (Fishbowl/NetSuite/BC all file it under Inventory); lesson "features live inside existing permission modules" — no new module/permission family invented |
| 7 | Backward compatibility (heuristic 7) | Everything additive: new RPC, new route, new nav entry; old RPC kept deprecated (grill Q5) | Zero breakage; swagger keeps both functions |
| 8 | Valuation basis | Method-faithful carrying cost (grill Q1) | Ties to subledger/GL; single source of math with the completeness spec |
| 9 | Per-location cost | Company-level effective unit cost × location qty; NO `costLedger.locationId` | Engine is company-scoped (consumption/transfers/revaluations); see research addendum — a stamped column would never balance |
| 10 | Status scope | Value all physical stock; break out On Hold / Rejected (grill Q2) | GL-faithful (rejected stock is an un-written-off asset); SAP MB52 buckets |
| 11 | As-of semantics | Historical qty exact, cost always current, permanently labeled (grill Q3) | SAP documents this exact fast-vs-accurate split; honesty beats false precision |
| 12 | Tie-out shape | Per stock account (RM, FG) + total, MB5L-style (grill Q4) | Two actionable rows beat one blended number; accounts already split by `20260713190909` |
| 13 | Group-by | Toggle Location ↔ Item, Location default | Fishbowl's exactly-two-groupings model; matches the verbatim feature request |
| 14 | Zero/negative rows | Zero-qty rows excluded; negative rows shown styled destructive | Zero rows are noise; negatives are a data-quality signal the report should surface, not hide |
| 15 | Drill-through | Item row → existing item activity (ledger) page; no new detail report | Summary→Detail consensus satisfied by an existing screen; scope discipline |

## Data Model Changes

No new tables. One migration (`pnpm db:migrate:new inventory-valuation-rpc`;
timestamp HHMMSS randomized per house rule; idempotent):

```sql
-- get_inventory_valuation: method-faithful inventory value by (item, location).
-- Follows get_inventory_quantities (20260713235406): SECURITY DEFINER to read
-- itemLedgerSnapshot; snapshot+delta on the current-date path, raw ledger on the
-- dated path. Sketch (final SQL forks from the NEWEST get_inventory_quantities
-- definition at implementation time — never an older revision):

DROP FUNCTION IF EXISTS get_inventory_valuation(TEXT, DATE, TEXT);
CREATE FUNCTION get_inventory_valuation(
  company_id TEXT,
  as_of_date DATE DEFAULT NULL,
  location_id TEXT DEFAULT NULL
) RETURNS TABLE (
  "locationId" TEXT, "locationName" TEXT,
  "itemId" TEXT, "readableIdWithRevision" TEXT, "name" TEXT,
  "type" "itemType", "replenishmentSystem" "itemReplenishmentSystem",
  "unitOfMeasureCode" TEXT, "costingMethod" "itemCostingMethod",
  "quantityOnHand" NUMERIC, "quantityOnHold" NUMERIC, "quantityRejected" NUMERIC,
  "unitCost" NUMERIC, "totalValue" NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
-- quantities CTE: snapshot+delta (as_of_date null/today) or raw postingDate
--   filter (dated), grouped by item+location, HAVING SUM(quantity) <> 0;
--   status buckets from trackedEntityStatus on tracked rows.
-- carrying CTE (completeness-spec math): per item,
--   FIFO/LIFO: SUM(cl."remainingQuantity" * (cl."cost" + COALESCE(adj.applied,0))
--              / NULLIF(cl."quantity",0)) / NULLIF(SUM(cl."remainingQuantity"),0)
--              over layers WHERE cl."remainingQuantity" > 0, with
--              adj = LATERAL SUM(cost) of rows a WHERE a."appliesToCostLedgerId" = cl."id";
--              fallback ic."unitCost" when no open layers.
--   Average:  ic."unitCost"    Standard: ic."standardCost"
-- final SELECT: quantities × carrying joined to item/location, company-scoped.
$$;
-- plpgsql (never LANGUAGE sql): internal ORDER BY must survive PostgREST (.ai/lessons.md)

COMMENT ON FUNCTION get_inventory_value_by_location(TEXT) IS
  'Deprecated: superseded by get_inventory_valuation (method-faithful costs, status breakdown, as-of-date).';
```

Then `pnpm run generate:types` before any typechecking.

## API / Service Changes

- `inventory.service.ts`: `getInventoryValuation(client, companyId, { asOfDate?, locationId? })`
  → `client.rpc("get_inventory_valuation", ...)`; `getInventoryValuationTieOut(client, companyId, asOfDate)`
  → Kysely sums of `journalLine` per `accountDefault.rawMaterialsAccount`/`finishedGoodsAccount`
  (by id) + subledger sums from the RPC rows (precedent `getArTieOut`).
- `inventory/types.ts`: `InventoryValuationRow`, `InventoryValuationTieOut` via `Awaited<ReturnType<...>>`.
- `path.ts`: `inventoryValuation: ${x}/inventory/valuation`.
- No models changes (no forms). No edge functions. No Inngest.

## UI Changes

- New route `x+/inventory+/valuation.tsx` (loader described in §4; `handle` module inventory).
- New `modules/inventory/ui/Valuation/InventoryValuationWorkbench.tsx` (+ barrel export)
  cloned from `ARAPWorkbench.tsx`: grouped union-row table, expand/collapse,
  subtotals + grand total, % of total, filter bar (DatePicker, group-by Select,
  location combobox), tie-out Popover, as-of semantics label, CSV export via the
  standard `Table`, destructive styling on negative rows, item drill-through links.
- `useInventorySubmodules.tsx`: "Valuation" entry in the Track group, gated by
  `permissions.can("view", "accounting")`.
- New strings marked for i18n; `/translate` fills catalogs at commit time.

## Acceptance Criteria

- [ ] **FIFO carrying math (numeric).** Item F-1 (FIFO) with layers: 100 @ $10.00
  (60 remaining) and 50 @ $12.00 (50 remaining) → effective unit cost
  $(60×10 + 50×12)/110 = $10.9091$. On-hand 110 split 80 @ Location A / 30 @
  Location B → row values $872.73 / $327.27; item total $1,200.00 equals the
  layers' remaining value exactly.
- [ ] **Adjustment children included.** A +$55.00 variance child
  (`appliesToCostLedgerId` → the 60-remaining layer, quantity 100) raises that
  layer's effective unit cost by $0.55 and the report total by 60 × $0.55 = $33.00.
- [ ] **Standard method.** Item S-1 (`costingMethod = 'Standard'`,
  `standardCost = 5.00`, `unitCost = 0`) with 10 on hand values at $50.00, not $0.
- [ ] **Status breakdown.** Item T-1 with 120 physical (5 Rejected, 10 On Hold):
  row shows Qty 120 / On Hold 10 / Rejected 5, value = 120 × unit cost.
- [ ] **As-of-date.** After a receipt posted today, setting asOfDate = yesterday
  removes today's quantity from the report, and the label "applies today's unit
  costs to historical quantities" is visible; asOfDate = today shows no label.
- [ ] **Group toggle.** By Location: location group rows with subtotals and item
  children; by Item: mirrored. Grand total identical in both groupings; % of
  total sums to 100%.
- [ ] **Tie-out (numeric).** Fresh company, accounting enabled: receive 10 @ $8.00
  of a Buy item → tie-out shows Raw Materials subledger $80.00, GL balance $80.00,
  variance $0.00; Finished Goods row $0/$0/$0. Panel hidden when
  `accountingEnabled = false`.
- [ ] **Permissions.** A user with `inventory_view` but not `accounting_view` gets
  no "Valuation" nav entry and a 403 on direct navigation; with `accounting_view`
  both work.
- [ ] **Deprecated RPC untouched.** `get_inventory_value_by_location` still
  returns its old shape (API compatibility).
- [ ] **CSV export** downloads the visible rows with item, location, quantities,
  unit cost, total value.
- [ ] `pnpm run generate:types` then
  `pnpm exec turbo run typecheck --filter=@carbon/erp` passes; new RPC migration
  applies idempotently (re-run safe).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Carrying-cost SQL drifts from `calculate-cogs.ts` layer semantics (adjustment-children handling) | High | The FIFO/LIFO expression is lifted from the completeness spec's carrying CTE; add a service-level test seeding layers + children and asserting the RPC's unitCost matches the COGS math; coordinate if completeness PR 1 changes the expression |
| Dated-path performance on large ledgers (no snapshot) | Med | `20260713224517` indexes cover item/location aggregation; `location_id` param narrows; report is a deliberate pull, not a hot path — measure with `EXPLAIN ANALYZE` on seeded volume before ship |
| Tie-out shows structural variance (unposted cycle-count adjustments) | Med | Known-noise caveat in panel copy (grill Q4 decision); resolves when completeness-spec §4 lands |
| As-of numbers change retroactively as costs move | Med | Permanent semantics label (grill Q3); documented in the docs page for the report |
| `itemLedgerSnapshot` status-blindness misread as a bug | Low | Untracked rows carry no status; buckets computed from tracked (live) rows only — noted in the migration comment |
| Effective-cost fallback (`unitCost`) for layerless FIFO items misleads | Low | Fallback matches what COGS would charge today (`calculate-cogs` falls back the same way for Average); costingMethod column keeps provenance visible |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] Valuation basis — **method-faithful carrying cost** (Brad, 2026-07-14; grill Q1).
- [x] Rejected/On-Hold stock — **valued, with breakdown columns** (Brad, 2026-07-14; grill Q2).
- [x] As-of-date — **in v1, approximate cost + permanent label** (Brad, 2026-07-14; grill Q3, overrode defer recommendation).
- [x] GL tie-out — **in v1, per-account MB5L shape + known-noise caveat** (Brad, 2026-07-14; grill Q4, overrode defer recommendation).
- [x] Old RPC — **kept, deprecated** (Brad, 2026-07-14; grill Q5).
- [x] Permissions — **accounting_view gates the report** (Brad, 2026-07-14; grill Q6).
- [x] `costLedger.locationId` — **not added**; per-location costing deferred to its own future spec (Brad, 2026-07-14; pre-grill, research addendum).

No new blocking questions surfaced while writing; judgment calls (zero/negative
row handling, drill-through target, group-by default, nav placement) are baked as
Design Decisions 13–15 and revisitable without schema churn.

## Changelog

- 2026-07-14: Created — after competitor research (`.ai/research/inventory-value-report.md`)
  and a 6-question grill with Brad (all resolutions inline above). Grounded in
  code exploration: dead RPC `20260325031223`, cost layers + `appliesToCostLedgerId`
  (`20260504000000`, completeness spec), snapshot pattern `20260713235406`,
  RM/FG account split `20260713190909`, AR/AP workbench precedent
  (`receivables.tsx` / `ARAPWorkbench.tsx`).

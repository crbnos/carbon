# Research — demo datasets for the three remaining onboarding industries

Date: 2026-08-13. Feeds the spec for adding `robotics`, `precision` and `motor` datasets
alongside the existing `satellite`.

Two questions were investigated: (1) is the stashed robotics work revivable, and (2) can the
engine actually accept a second dataset today. Answers: yes, and no.

---

## Current state

`DATASETS` holds exactly one entry, `satellite` (`datasets/index.ts:26`), bound to
`industryId: "aerospace_satellite"`. The other three industry rows already exist in the
database from `20260617100002_onboarding-and-backups.sql:25-35`:

| id | name | sortOrder | dataset |
|----|------|-----------|---------|
| `robotics_oem` | Robotics OEM | 1 | none |
| `precision_manufacturing` | Precision Manufacturing | 2 | none |
| `automotive_precision` | Motor Assembly | 3 | none |
| `aerospace_satellite` | Aerospace / Satellite | 4 | `satellite` |

**No migration is needed** for the three new datasets — the rows exist. Only satellite
needed one (`20260813023744_add-aerospace-industry.sql`).

Since commit `19773927c`, onboarding filters the industry picker through
`datasetForIndustry`, so the three industries without a dataset are hidden rather than
silently producing an empty company.

Satellite's data is **2,824 lines** across 12 files. Three more at parity ≈ 8,500 lines.

---

## Finding 1 — the stashed robotics dataset is 99.9% salvageable

`stash@{0}` ("robotics dataset — unfinished, cut from feat/onboarding-templates") holds no
tracked changes; everything is in the untracked commit `stash@{0}^3` (`97fb929b9`):

| File | Lines |
|------|-------|
| `data/robotics/foundation.ts` | 525 |
| `data/robotics/items.ts` | 746 |
| **Total** | **1,271** |

It was written **after** the data/engine refactor, against the current contracts — imports,
type names and `ctx.refs` key prefixes (`sp:`, `procedure:`) are byte-identical in shape to
satellite's. It uses no banned pattern: zero `new Date`, zero `CURRENT_DATE`, zero literal
primary keys, zero absolute date strings (unsurprising — `foundation` and `items` carry no
dates by nature).

**One incompatibility, one line:** `foundation.ts:513` sets `structuralSteps: ARM_BASE_STEPS_V2`,
and `FoundationData` no longer has that field (it was deleted as dead type surface in
commit `abdd4bc13`). `ARM_BASE_STEPS_V2` itself stays — `PROCEDURES` v2 references it at
`foundation.ts:374`.

Item-array cardinality is at exact satellite parity: 11 buy parts, 6 materials, 2 consumables,
2 tools, 1 service, 11 make parts, 11 make methods, 13 supplier links. The BOM is a real
4-level tree (`ROB-2000` → base/link/wrist/controller/harness/gripper → `DRV-J2-MOD`, `PCB-*`,
`GRP-JAW-80` → buy parts) with an outside-processing operation and an `Assembly`-type op for
the MES view.

Restore read-only, without popping (the working tree has advanced well past the stash):

```bash
git show stash@{0}^3:packages/database/src/datasets/data/robotics/foundation.ts > packages/database/src/datasets/data/robotics/foundation.ts
git show stash@{0}^3:packages/database/src/datasets/data/robotics/items.ts     > packages/database/src/datasets/data/robotics/items.ts
```

**Missing: 9 of 11 slices** — inventory, sales, purchasing, production, quality, changeOrders,
accounting, workflows, planning, plus `data/robotics/index.ts`. Satellite's equivalents total
1,552 lines (workflows 511, sales 290, production 195, purchasing 194, accounting 114,
inventory 77, change-orders 71, planning 70, quality 30) + 34 for `index.ts`.

So the stash is ~44% of a finished dataset by line count, and the harder, more
judgement-heavy half by effort — the coherent BOM, costing and lead times.

---

## Finding 2 — the tiers are NOT industry-agnostic yet

The stated contract is that a tier reads `ctx.dataset.<slice>` and knows nothing about which
industry it is inserting. In practice the engine carries a lot of satellite.

### Blockers — a second dataset cannot be added correctly without these

| # | Problem | Where | Failure if ignored |
|---|---------|-------|--------------------|
| R1 | `DatasetKey` union + `DATASETS` record | `types.ts:9`, `index.ts:26` | Won't compile. Cheap and by design. |
| R2 | `need(ctx.refs.documents, "job:in-progress")` — the job key is a literal in the engine | `06-production.ts:101,163` | **Hard throw, full rollback.** A dataset whose jobs are keyed differently cannot be applied at all. |
| R3 | `refs.shippingMethods["UPS Ground"]` — literal default shipping method | `01-foundation.ts:253,309`, `04-sales.ts:31`, `05-purchasing.ts:15` | **Silent NULL** `shippingMethodId` across six shipment/delivery tables; the shipments/receipts UI breaks. |
| R4 | A supplier literally named `"Orbital Staffing"` inserted unconditionally, typed via `refs.misc["stype:Services"]` | `01-foundation.ts:366-372` | A satellite company name appears in the robotics, machining and motor templates. Silent NULL type if a dataset omits `"Services"`. |
| R5 | Shelf names `A1-L1`…`A3-L3` / `CleanRoom` are generated by the engine but referenced by the dataset's `openingStock[].shelf` | `01-foundation.ts:113-142` → `03-inventory.ts:13,82` | **All opening stock silently dropped** if a dataset writes a different shelf string. Worst failure mode in the engine — the company looks provisioned. |
| R6 | `industryId` per dataset | `data/<key>/index.ts` | Without it `datasetForIndustry` returns null and the picker hides the industry. No migration needed. |

Estimated: 5 engine files, ~60–90 lines, plus a re-seed of satellite to prove the refactor
dropped nothing (diff `Seeded row counts` and the structural sums against
`.ai/runs/2026-08-13-seed-baseline.txt`).

### Satellite content still living in the engine (not strictly blocking, but visibly wrong)

`tiers/01-foundation.ts` is the offender:

- `:66-74` — the plant is `4500 Space Commerce Drive, Houston, TX 77058`, `America/Chicago`
- `:17-38` — exactly two shifts, `"Day Shift"` 06:00–14:30 and `"Swing Shift"` 14:30–23:00,
  Mon–Fri. `FoundationData` has no `shifts` field at all
- `:89-104` — exactly three warehouses (`Main Warehouse` / `RMA / Return` / `QC Hold`)
- `:113-142` — one aisle, hard-coded `for (let row = 1; row <= 3; row++)`, plus a
  `"Clean Room Shelf"` — an aerospace concept in shared code
- `:398-404` — a printer route at `http://192.168.1.50:9100`
- `:216-221` — payment term resolved by `name ILIKE '%net%30%'`; throws if absent
- `:242,299,370` — `currencyCode: "USD"` on every customer and supplier
- `:269-275,325-331` — every customer and supplier billing address is Houston, TX

Elsewhere: `unitOfMeasureCode: "EA"` is hard-coded ~20 times across tiers 4/5/6,
`"Part"` line types ~10 times, `methodType: "Make to Order"` on every quote and order line.
Those three are fine for robotics / machining / motor (all sell discrete parts in USD) and
become blockers only for a dataset selling material by `FT`/`LB` or in another currency.

`tiers/workflow-definitions.ts:6` re-exports `../data/satellite/workflows.ts` — the engine
importing one dataset by name. `packages/workflows/src/seed-workflows.test.ts` therefore
validates satellite's workflows only.

### Silent skips that would produce a plausible but half-empty company

Each is a `continue`/`return` with no error. The highest-blast-radius ones:

- `03-inventory.ts:14,36,57,83` — an unknown item or shelf name drops opening stock, lots,
  kanban cards or count lines entirely
- `06-production.ts:118` — if the in-progress job's method copied zero operations, **no
  production events at all**, silently
- `06-production.ts:165,179,218` — the whole as-built genealogy skipped
- `07-quality.ts:39,42,56` — an NCR exists but is unlinked to any job, and its affected-items
  list is silently empty (the `items` loop is nested inside the `jobOperation` guard)
- `01-foundation.ts:352,412` — a supplier-process or procedure name mismatch cascades into
  silent NULLs in tier 2
- `helpers/job-method.ts:101` — a Make item with no `Active` make method yields a job with
  zero operations, logged only as `method: 0 operations`

### Type-contract gaps a new dataset author will hit

- `Dataset.companyName` (`types.ts:681`) is **dead** — nothing reads it
- `FixedAssetSpec.location: "Plant" | "HQ"` freezes the two-location model into the data type
- `JournalLineSpec.accountClass: "Asset" | "Revenue"` only — no Expense/Liability/Equity line
- `inventoryCount`, `genealogyAssembly`, `demandOrder` are required single objects, not arrays
  — every dataset must invent exactly one of each, and none can have zero or two
- The whole purchasing-RFQ story (`rfqQuotes`, `rfqWinningQuote`, `rfqOrderQuantity`, …) is
  required and throws if inconsistent (`05-purchasing.ts:265,269`)
- Non-null assertions instead of `need()` at `02-items.ts:81`, `12-planning.ts:80,109`,
  `06-production.ts:122` — a missing key becomes a NULL column or an unhelpful `TypeError`

### Volume assumptions baked into tiers

`03-inventory.ts:79` counts only `openingStock.slice(0, 6)` (array *order* decides which
items get counted); `06-production.ts:115` `LIMIT 2` so only the first two operations get
production events; `01-foundation.ts:122` exactly 3 racking rows; `12-planning.ts:21` always
48 weeks, only the first 8 published to refs.

---

## Implications for the spec

1. Engine work comes **first** — R2 and R5 in particular, or the new datasets fail loudly
   (rollback) or quietly (empty inventory).
2. Robotics should be dataset #2: the stash gives its hardest half for one deleted line, and
   `robotics_oem` is `sortOrder` 1, the first card a user sees.
3. Whether to lift shifts/locations/warehouses/printer out of tier 1 is a real cost/quality
   trade-off and is the main open question for the user — leaving them means a robotics OEM
   and a motor-assembly shop both operate from a Houston aerospace address.
4. Only satellite has a row-count baseline (`.ai/runs/2026-08-13-seed-baseline.txt`); each new
   dataset needs its own, since `printSummary` is the documented verification.

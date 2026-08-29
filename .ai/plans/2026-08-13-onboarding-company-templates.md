# Onboarding company templates — implementation plan

**Spec / source:** `.ai/specs/2026-08-13-onboarding-company-templates.md`
**Research:** `.ai/research/onboarding-templates.md`
**Branch:** `feat/onboarding-templates`

## Read this first (executor briefing)

The dev seed (`pnpm db:seed:dev`) fills one company with a satellite manufacturer's
data across 12 "tiers" that run in numeric order. Today the data is hardcoded inside
the tier files. This plan splits **engine** (insertion logic) from **data**, so the
same engine can apply either a `satellite` or a `robotics` dataset, and so onboarding's
"Use a demo template" can run it against a real new company.

Three rules that govern every task:

1. **Row-count parity is the safety net.** Task 1 captures a baseline of the seed's
   `printSummary` output. Every extraction task must reproduce that baseline exactly.
   A count that changes means data was dropped or altered — STOP and fix, do not proceed.
2. **Never rebuild or reset the database to test.** If a task needs a migration applied,
   STOP and ask the user to run it (`AGENTS.md`, "Never" section).
3. **The repo's type-regen script is `pnpm db:types`**, not `pnpm run generate:types`
   (which does not exist despite what root `AGENTS.md` says). Verified in root
   `package.json`.

Terminology used below: a **tier** is one numbered seed file; **refs** are the
`ctx.refs` registry mapping human-readable keys (`"NovaSat"`, `"SAT-1000"`) to the
database ids created by earlier tiers.

## Progress

- [x] Task 1: Capture the pre-refactor seed baseline
- [x] Task 2: Rename `src/seed-dev/` to `src/datasets/` and repoint every import
- [x] Task 3: Introduce the `Dataset` type, `ctx.dataset`, and `applyDataset()`
- [x] Task 4: Extract tier 1 foundation data
- [x] Task 5: Extract tier 2 item specs
- [x] Task 6: Extract tier 2 BOM/BOP into a declarative method spec
- [x] Task 7: Extract tier 3 inventory data
- [x] Task 8: Extract tier 4 sales chain data
- [x] Task 9: Extract tier 5 purchasing data
- [x] Task 10: Extract tier 6 production data
- [x] Task 11: Extract tier 7 quality data
- [x] Task 12: Extract tier 8 change-order data (incl. follow-up: `Revision` branch generalised via `RevisionSpec`)
- [x] Task 13: Extract tier 9 accounting data
- [x] Task 14: Extract tier 11 workflow definitions
- [x] Task 15: Extract tier 12 planning data
- [x] Task 16: Add day-offset date resolution and convert satellite's date literals
- [x] Task 17: Add `--dataset` to the dev CLI
- [ ] Task 18: Author the robotics dataset
- [x] Task 19: Migration — add the `aerospace_satellite` industry row (applied 2026-08-13)
- [x] Task 20: Declare the `carbon/company-template` event
- [x] Task 21: Build the `company-template` Inngest job
- [x] Task 22: Wire the template branch through onboarding
- [x] Task 23: UI — industry icon and template card copy
- [x] Task 24: Sync the stale rules and docs
- [ ] Task 25: End-to-end verification

## Dependencies

- Task 2 needs Task 1. Task 3 needs Task 2.
- Tasks 4–15 each need Task 3. **They are otherwise independent of each other** and may
  run as parallel subagents — but each must re-verify count parity on its own, and two
  agents must not edit `data/satellite/index.ts` concurrently (serialize that one file,
  or have each agent add its slice in a separate commit).
- Task 6 needs Task 5 (both touch tier 2).
- Task 16 needs Tasks 4–15 (it edits the extracted data modules).
- Task 17 needs Task 3. Task 18 needs Tasks 16 and 17.
- Task 19 is independent of everything above; Tasks 20–21 need Task 3; Task 22 needs
  Tasks 19, 20, 21; Task 23 needs Task 19.
- Task 25 needs everything.

---

## Task 1: Capture the pre-refactor seed baseline

**Depends on:** none
**Files:**
- Create: `.ai/runs/2026-08-13-seed-baseline.txt`

**Steps:**

1. Confirm a local Supabase stack is running with all migrations applied. If it is not,
   STOP and ask the user to bring it up — do not run migrations or reset the database
   yourself.
2. Run the seed against the standard dev user and save its full output:

   ```bash
   pnpm db:seed:dev -- --email test@carbon.ms > .ai/runs/2026-08-13-seed-baseline.txt 2>&1
   ```

3. Confirm the file ends with `Dev environment seeded successfully!` and contains the
   `printSummary` table of per-table row counts (27 tables, listed in
   `packages/database/src/seed-dev/sql.ts:273-301`). If the run failed, STOP and report —
   every later task is verified against this file.

4. Capture the structural baselines Tasks 6, 8 and 13 compare against, into
   `.ai/runs/2026-08-13-seed-baseline-structural.txt`. Row counts alone do not catch a
   BOM whose quantities changed.

**Verify:**
```bash
grep -c "Dev environment seeded successfully" .ai/runs/2026-08-13-seed-baseline.txt
# Expected: 1
```

**Result (2026-08-13):** seed exited 0. Dev company id `d9uhui8im0gg282odrl0`.
Row counts recorded under the heading `Seeded row counts` (NOT "Summary" — the later
tasks' diff commands grep for that exact heading). Headline counts: `item` 34,
`makeMethod` 27, `methodMaterial` 51, `job` 8, `jobOperation` 81, `salesOrder` 10,
`purchaseOrder` 4, `workflow` 7, `fixedAsset` 4, `nonConformance` 2, `changeOrder` 3.
Structural baselines: `methodMaterial` 51 rows / quantity sum `258.375`;
`methodOperation` 33 rows / laborTime sum `263.75` / machineTime `0.00` / setupTime
`0.00`; `salesOrderLine` 13 rows / saleQuantity sum `112.00000`; `quoteLinePrice` 8
rows; unbalanced journal entries `0`.

**Out of scope:** Changing any seed code. This task only records the current behaviour.

---

## Task 2: Rename `src/seed-dev/` to `src/datasets/` and repoint every import

**Depends on:** Task 1
**Files:**
- Move: `packages/database/src/seed-dev/` → `packages/database/src/datasets/`
- Modify: `packages/database/src/seed-dev.ts` — update its 6 relative imports
- Modify: `packages/database/package.json` — repoint the `"./seed-workflows"` export
- Modify: `packages/database/AGENTS.md` — the "Dev Seed" section names the old path

**Steps:**

1. `git mv packages/database/src/seed-dev packages/database/src/datasets`
2. Update the imports in `packages/database/src/seed-dev.ts:18-23` from
   `./seed-dev/<x>.ts` to `./datasets/<x>.ts`. Leave the file itself named
   `seed-dev.ts` — it is the dev CLI entry point and `package.json:39` references it.
3. In `packages/database/package.json`, change the `"./seed-workflows"` export from
   `"./src/seed-dev/tiers/workflow-definitions.ts"` to
   `"./src/datasets/tiers/workflow-definitions.ts"`. **This subpath has an external
   consumer** — a missed rename here fails only at runtime.
4. Search the whole repo for any other reference to the old path and update it:

   ```bash
   grep -rn "seed-dev/" --include=*.ts --include=*.json --include=*.md . | grep -v node_modules
   ```

5. Update the "Dev Seed" section of `packages/database/AGENTS.md:46-55` to say
   `src/datasets/` and to describe the engine/data split introduced by this plan.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: no errors
pnpm db:seed:dev -- --email test@carbon.ms > /tmp/seed-after-task2.txt 2>&1
diff <(grep -A40 "Seeded row counts" .ai/runs/2026-08-13-seed-baseline.txt) <(grep -A40 "Seeded row counts" /tmp/seed-after-task2.txt)
# Expected: no output (identical row counts)
```

**Out of scope:** Any change to what the tiers insert. This is a pure move.

---

## Task 3: Introduce the `Dataset` type, `ctx.dataset`, and `applyDataset()`

**Depends on:** Task 2
**Files:**
- Create: `packages/database/src/datasets/index.ts`
- Create: `packages/database/src/datasets/data/satellite/index.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `dataset` and `anchor` to `Ctx`
- Modify: `packages/database/src/seed-dev.ts` — call `applyDataset` instead of inlining the loop
- Modify: `packages/database/package.json` — add the `"./datasets"` export

**Steps:**

1. In `packages/database/src/datasets/types.ts`, add to the `Ctx` type (currently lines
   46-54):

   ```typescript
   dataset: Dataset;
   anchor: CalendarDate;   // from @internationalized/date
   ```

   and extend `buildCtx` (lines 104-136) to take `dataset` and `anchor` as arguments and
   pass them through. Its existing pre-flight checks (company row, a `location`, a
   `unitOfMeasure` with code `EA`) stay exactly as they are.

2. Create `packages/database/src/datasets/types.ts`'s new `Dataset` type — put it in
   `types.ts` next to `Ctx`:

   ```typescript
   export type DatasetKey = "satellite" | "robotics";

   export type Dataset = {
     key: DatasetKey;
     label: string;
     /** industry.id this dataset backs, or null for dev-only datasets. */
     industryId: string | null;
     companyName: string;
     foundation: FoundationData;
     items: ItemsData;
     inventory: InventoryData;
     sales: SalesData;
     purchasing: PurchasingData;
     production: ProductionData;
     quality: QualityData;
     changeOrders: ChangeOrderData;
     accounting: AccountingData;
     workflows: WorkflowData;
     planning: PlanningData;
   };
   ```

   For **this task only**, declare every slice type as `unknown` and have
   `data/satellite/index.ts` export `satellite: Dataset` with each slice set to `{}`.
   Tasks 4–15 replace one slice each with its real type and real data. This keeps the
   tree compiling between tasks.

3. Create `packages/database/src/datasets/index.ts`:

   ```typescript
   import type { PoolClient } from "pg";
   import { ensureSequences } from "./sql.ts";
   import { selectTiers } from "./tiers/index.ts";
   import { buildCtx, type Dataset, type DatasetKey } from "./types.ts";
   import { satellite } from "./data/satellite/index.ts";

   export const DATASETS: Record<DatasetKey, Dataset> = { satellite, robotics };

   export function datasetForIndustry(industryId: string | null): Dataset | null {
     if (!industryId) return null;
     return Object.values(DATASETS).find((d) => d.industryId === industryId) ?? null;
   }

   export async function applyDataset(
     client: PoolClient,
     opts: {
       companyId: string;
       userId: string;
       dataset: Dataset;
       timeZone: string;
       tiers?: number[] | null;
       log?: (message: string) => void;
     }
   ): Promise<void>;
   ```

   `applyDataset` performs exactly what `seed-dev.ts:43-71` does today, minus bootstrap
   and wipe: build the anchor with `datetime.today(opts.timeZone)` from `@carbon/utils`,
   `buildCtx`, `BEGIN`, `SET LOCAL "app.sync_in_progress" = 'true'`, `ensureSequences`,
   run the selected tiers in order, `COMMIT`, and `ROLLBACK` + rethrow on any error.
   `log` defaults to a no-op so the job is not forced to print to stdout.

   Until Task 18 exists, `robotics` is not yet defined — for this task declare
   `DATASETS` with only `satellite` and widen it in Task 18.

4. Rewrite `packages/database/src/seed-dev.ts:43-71` to call `applyDataset`, keeping
   `resolveCompany`, `bootstrap`, `wipeCompanyBusinessData`, `printSummary`, and the
   success banner exactly where they are. The wipe must still run **before**
   `applyDataset` and **outside** it, because wiping is dev-only. Note that today the
   wipe runs *inside* the transaction (`seed-dev.ts:55-60`); preserve that by having the
   dev CLI open its own transaction around wipe + apply, or by passing an
   `beforeTiers?: (ctx) => Promise<void>` hook into `applyDataset`. Prefer the hook — it
   keeps the "one transaction" guarantee in one place.
5. For the timezone in the dev CLI, call `getCompanyTimeZone`. It is overloaded for a
   Supabase client or a Kysely handle, **not** a raw `pg` `PoolClient`
   (`packages/database/supabase/functions/lib/datetime.ts:60-71`). In the dev CLI, read
   `company.timezone` with a direct `client.query` instead and default to `"UTC"`.
   If `company` turns out to have no timezone column, STOP and report — do not invent one.
6. Add `"./datasets": "./src/datasets/index.ts"` to `packages/database/package.json`
   `exports`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: no errors
pnpm db:seed:dev -- --email test@carbon.ms > /tmp/seed-after-task3.txt 2>&1
diff <(grep -A40 "Seeded row counts" .ai/runs/2026-08-13-seed-baseline.txt) <(grep -A40 "Seeded row counts" /tmp/seed-after-task3.txt)
# Expected: no output
```

**Deviation (2026-08-13):** the plan said to build the anchor with `datetime.today` from
`@carbon/utils`. `@carbon/utils` is **not** a dependency of `@carbon/database`, so
`applyDataset` calls `today(timeZone)` from `@internationalized/date` directly — which is
exactly what `datetime.today` wraps (`packages/utils/src/datetime.ts:42`). Same semantics,
no new dependency. `packages/database/src` is not scanned by the `no-local-timezone` check
(`packages/checks/src/sources/server-files.ts:10-14`), and the timezone is explicit anyway.

Also: `company.timezone` exists, so `resolveCompanyTimeZone(client, companyId)` was added to
`types.ts` (raw `pg` query, falls back to `"UTC"`). The `beforeTiers` hook was taken, so the
wipe still runs inside the tiers' transaction and after `ensureSequences`, as before.

`DATASETS` is typed `Partial<Record<DatasetKey, Dataset>>` until Task 18 adds `robotics`;
`getDataset(key)` returns `Dataset | null`, which is also what the job's unknown-key guard needs.

Known consumer of the `"./seed-workflows"` subpath, relevant to Task 14:
`packages/workflows/src/seed-workflows.test.ts:1` imports `buildSeedWorkflows` from it.

**Out of scope:** Moving any data yet. Tier files are untouched in this task except for
the `Ctx` type change.

---

## Tasks 4–15: extract the data, one tier at a time

Every one of these tasks follows the **same recipe**, so it is stated once here and each
task below only names its file, its constants, and its shape.

**The recipe:**

1. Create `packages/database/src/datasets/data/satellite/<slice>.ts`.
2. Move the named module-level constants there **verbatim**, exporting each one.
3. Move the types that describe them into
   `packages/database/src/datasets/types.ts` (so both datasets share one shape) and
   export the slice type named in the task.
4. In `data/satellite/index.ts`, add the slice to the `satellite` object.
5. In `types.ts`, replace that slice's `unknown` with its real type.
6. In the tier file, delete the moved constants and read them from
   `ctx.dataset.<slice>` instead.
7. **Do not change any value.** No renaming, no reordering, no "while I'm here" fixes.
8. Verify count parity (command below). Any diff means data was lost — STOP.

**The verify block, identical for Tasks 4–15** (substitute the task number):

```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: no errors
pnpm db:seed:dev -- --email test@carbon.ms > /tmp/seed-after-taskN.txt 2>&1
diff <(grep -A40 "Seeded row counts" .ai/runs/2026-08-13-seed-baseline.txt) <(grep -A40 "Seeded row counts" /tmp/seed-after-taskN.txt)
# Expected: no output
```

**Out of scope for all of Tasks 4–15:** date changes (Task 16 owns those), the robotics
dataset (Task 18), and any behaviour change in the insertion logic.

---

**Findings from the extraction waves (2026-08-13):**

- **Tier 2 BOM/BOP** (Task 6): 11 `MakeMethodSpec` entries, 40 BOM lines, 28 BOP
  operations. One field had to be ADDED to `BopOperationSpec`: `procedure?: string`
  (3 operations pass `procedureId: ctx.refs.misc["procedure:..."]`). Equivalence was
  checked by normalising every old call and every new spec to one line per row and
  diffing — byte-identical.
- **Tier 5 purchasing** (Task 9): `PurchaseOrderSpec` is a discriminated union on
  `source: "direct" | "winningQuote"`, because the tier loops the array twice —
  direct POs before the RFQ, winning-quote POs after the quotes — and that ordering
  must not change. **3 of the 10 date literals stayed in the tier** (inside the
  supplier-quote loop: `quotedDate`, `expirationDate`, `expiresAt`); Task 16 must
  handle those in the tier or move them into `rfqQuotes` first.
- **Tier 8 change orders** (Task 12): headers and affected items extracted cleanly, but
  **the `Revision` branch still hardcodes satellite data** — the revision item payload
  (`revision: "A"`, `unitSalePrice: 120000`), four draft edits (`MAT-KAPTON` delete,
  `BAT-LIION-48V` qty 2, `HARNESS-001` line, an operation rename), and the `EPS-001.A`
  string in a throw. A robotics `Revision` change order would apply EPS edits.
  **Task 18 must either avoid `Revision` change orders in robotics, or a follow-up
  extraction must add a `revision` + `draftEdits` sub-spec.** Not silently ignorable.
- **Tier 12 planning** (Task 15): the inline `unitCost * 1.5` became
  `unitPriceMultiplier: 1.5` on the line spec, so a second dataset can set its own margin.
- **Tier 9 accounting** (Task 13): `JournalLineSpec.accountClass` replaces the resolved
  `acctAR.id` / `acctSales.id`, because the tier resolves accounts by GL class at run
  time. Signs untouched; the entry still nets to zero.

---

## Task 4: Extract tier 1 foundation data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/foundation.ts`
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `FoundationData`

**Steps:**

1. Follow the recipe. Move these module-level constants (line numbers are pre-change):
   `DEPT_NAMES` (29), `ABILITIES` (30-37), `PROCESSES` (38-52), `WORK_CENTERS` (54-104),
   `CUSTOMERS` (106-135), `CUSTOMER_CONTACTS` (137-166), `SUPPLIERS` (168-205),
   `SUPPLIER_CONTACTS` (207-250), `SUPPLIER_PROCESSES` (253-258),
   `STRUCTURAL_STEPS_V2` (260-297), `PROCEDURES` (299-417), `SHIPPING_METHODS` (419-425),
   `SHIPPING_TERMS` (426-431), `ITEM_POSTING_GROUPS` (433-439).
2. Also move these **inline** literals out of the `runTier1` body — they are data, not
   logic: `wcProcessLinks` (595-603), `contractorDefs` (826-840), the ability-level array
   at 559, the customer-types array at 624, the supplier-types array at 632-641, the
   customer-statuses array near 675-681, the cost-centers array at 909-914, and the
   no-quote-reasons array at 920-925.
3. Move the types `ProcedureStepSpec` (4-12) and `ProcedureSpec` (14-23) into `types.ts`.
4. `FoundationData` is an object with one field per moved constant, camelCased
   (`departments`, `abilities`, `processes`, `workCenters`, `customers`,
   `customerContacts`, `suppliers`, `supplierContacts`, `supplierProcesses`,
   `structuralSteps`, `procedures`, `shippingMethods`, `shippingTerms`,
   `itemPostingGroups`, `workCenterProcessLinks`, `abilityLevels`, `customerTypes`,
   `supplierTypes`, `customerStatuses`, `costCenters`, `noQuoteReasons`, `contractors`).

**Findings (2026-08-13):**
- **`customerStatuses` does not exist and was dropped from the field list.** Lines ~675-681
  are a `SELECT id, name FROM "customerStatus"` query, not a literal — the statuses are
  seeded by `bootstrap.ts` from the shared
  `supabase/functions/lib/seed.data.ts`, so they are cross-dataset reference data, not
  per-dataset content. Making them per-dataset would be a real behaviour change to
  bootstrap, not a move; out of scope.
- **`abilityLevels` was a misnomer** — the `["L1", "L2", "L3"]` array builds storage-bin
  racking names (`A1-L1` … `A3-L3`), nothing to do with abilities. Renamed to `binLevels`
  before it ossified. Value unchanged.
- Slice types must be **structural**, not `typeof SOME_CONSTANT` — a `typeof` field pins
  the shape to satellite's literal values and robotics could never satisfy it. This applies
  to every extraction task, not just this one.

**Verify:** the shared block above, with `taskN` = `task4`.

---

## Task 5: Extract tier 2 item specs

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/items.ts`
- Modify: `packages/database/src/datasets/tiers/02-items.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `ItemsData`

**Steps:**

1. Follow the recipe for `BUY_PARTS` (22-128), `MATERIALS` (130-180),
   `CONSUMABLES` (182-197), `TOOLS` (199-212), `SERVICES` (214-223),
   `MAKE_PARTS` (226-317). All six are `ItemSpec[]`.
2. Also move `supplierLinks` (751-827, 13 entries) — it is data.
3. `ItemSpec` already lives in `helpers/items.ts:4-20`; re-export it from `types.ts`
   rather than duplicating the definition.
4. `ItemsData` = `{ buyParts, materials, consumables, tools, services, makeParts,
   supplierLinks, methods }`. Leave `methods` typed but absent until Task 6.
5. Leave the BOM/BOP block (363-748) and the local `needMM` helper (849-855) alone.

**Verify:** the shared block above, with `taskN` = `task5`.

---

## Task 6: Extract tier 2 BOM/BOP into a declarative method spec

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/src/datasets/data/satellite/items.ts` — add `METHODS`
- Modify: `packages/database/src/datasets/tiers/02-items.ts` — replace lines 363-748
- Modify: `packages/database/src/datasets/types.ts` — add the method spec types

**Steps:**

This is the first task where a shape has to be **invented** rather than moved: lines
363-748 are ~100 imperative `addBomLine(...)` / `addBopOperation(...)` calls, not a data
literal. Convert them to data with this shape (add to `types.ts`):

```typescript
export type BomLineSpec = {
  /** readableId of the component item; resolved through ctx.refs.items */
  component: string;
  quantity: number;
  order: number;
  methodType?: MethodType;   // from helpers/items.ts
  kit?: boolean;
};

export type BopOperationSpec = {
  /** keys into ctx.refs.processes / ctx.refs.workCenters */
  process: string;
  workCenter?: string;
  description: string;
  order: number;
  laborTime?: number;
  laborUnit?: string;
  setupTime?: number;
  machineTime?: number;
  operationType?: OperationType;   // from helpers/items.ts
  /** key into ctx.refs.misc, e.g. "sp:AstroMill Machining:Outside Processing" */
  supplierProcess?: string;
  operationLeadTime?: number;
  operationUnitCost?: number;
};

export type MakeMethodSpec = {
  /** readableId of the make part this method belongs to */
  readableId: string;
  bom: BomLineSpec[];
  bop: BopOperationSpec[];
};
```

1. Transcribe each `{ ... }` block in 363-748 into one `MakeMethodSpec` entry in a new
   exported `METHODS: MakeMethodSpec[]`, preserving the **exact** order the blocks appear
   in today — `order` indices and insertion order both matter to the resulting BOM.
2. Replace 363-748 with a loop over `ctx.dataset.items.methods` that resolves
   `readableId` → make method via the existing `needMM` helper, then calls `addBomLine`
   and `addBopOperation` with the spec fields. The helpers'
   signatures are unchanged (`helpers/items.ts:165-189` and `:202-239`).
3. Any `addBopOperation` option not covered by `BopOperationSpec` above must be **added
   to the type**, not dropped. If you find one, add it and note it in the plan file.

**Verify:** the shared block above, with `taskN` = `task6`. Additionally, because BOM
structure is not fully captured by row counts, compare BOM contents directly:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*), SUM(quantity) FROM \"methodMaterial\";"
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*), SUM(\"laborTime\"), SUM(\"machineTime\") FROM \"methodOperation\";"
# Expected: identical to the same two queries run before this task — capture them first.
```

**Out of scope:** changing any quantity, time, or order index.

---

## Task 7: Extract tier 3 inventory data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/inventory.ts`
- Modify: `packages/database/src/datasets/tiers/03-inventory.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `InventoryData`

**Steps:** follow the recipe for `OPENING_STOCK` (6-31), `ON_HAND_TRACKED` (34-61), the
inline `kanbanItems` (112-117), and the inline inventory-count literal (138-141). Lift
the inline types on lines 6-11 and 34-37 into named types in `types.ts`.
`sampleLines = OPENING_STOCK.slice(0, 6)` (142) is derived — leave that line in the tier.

**Verify:** the shared block above, with `taskN` = `task7`.

---

## Task 8: Extract tier 4 sales chain data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/sales.ts`
- Modify: `packages/database/src/datasets/tiers/04-sales.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `SalesData`

**Steps:**

This is the **hardest extraction**: almost the entire 646-line file is inline document
literals rather than named constants. Work in this order and re-verify after each step,
so a break is attributable.

1. Move the already-named constants first: `SAT_PRICE_BREAKS` (20-25),
   `EPS_PRICE_BREAKS` (28-37), `NOVASAT_QUOTE_LINK_ID` (44),
   `NOVASAT_QUOTE_EXPIRATION` (45), `STAGGERED_DELIVERIES` (50-54), and the type
   `PriceBreak` (10-16). The `*_BREAK_QUANTITIES` consts (26, 38) are derived from the
   break arrays — leave them computed in the tier.
2. Move `statusOrders` (489-544) next — it is already an array literal.
3. Then convert each opportunity chain into one entry of an `opportunities` array. Shape:

   ```typescript
   export type SalesOpportunitySpec = {
     key: string;               // ref key, e.g. "ORBSEC"
     customer: string;          // key into ctx.refs.customers
     rfq?: SalesRfqSpec;
     quote?: SalesQuoteSpec;    // includes lines, payment, shipment, price breaks
     order?: SalesOrderSpec;    // includes lines, payment, shipment
     shipment?: ShipmentSpec;
     invoice?: SalesInvoiceSpec;
   };
   ```

   The five chains are: ORBSEC (126-297), NovaSat (299-370), Apex (372-400),
   PolarView (402-483), staggered (592-644). Each sub-spec's fields are exactly the
   columns the corresponding insert passes today — transcribe them, do not redesign.
4. The inline price-break arrays at 190-192 and 439-441 belong to their quote lines —
   fold them into the relevant `quote` sub-spec rather than leaving them in the tier.
5. `insertPriceBreaks` (56-75) is logic — it stays in the tier file.
6. `SalesData` = `{ opportunities, statusOrders, priceBreaks: { sat, eps },
   staggeredDeliveries, novasatQuoteLinkId, novasatQuoteExpiration }`.

If any chain proves not to fit the shape above without changing what is inserted, STOP
and report rather than reshaping the insert.

**Verify:** the shared block above, with `taskN` = `task8`. Additionally:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*), SUM(\"unitPrice\") FROM \"salesOrderLine\";"
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM \"quoteLinePrice\";"
# Expected: identical to the same queries captured before this task.
```

---

## Task 9: Extract tier 5 purchasing data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/purchasing.ts`
- Modify: `packages/database/src/datasets/tiers/05-purchasing.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `PurchasingData`

**Steps:** move `RFQ_QUANTITY_BREAKS` (6), `RFQ_LINES` (8-11), `RFQ_QUOTES` (30-112),
`RFQ_WINNING_QUOTE` (114), `RFQ_ORDER_QUANTITY` (115), and the type `RfqQuoteSpec`
(13-26). Then convert the four inline purchase-order chains — PO1 + receipt (132-205),
PO2 + invoice (207-274), PO3 draft (276-312), PO4 (438-505) — and the RFQ header
(314-344) into a `purchaseOrders: PurchaseOrderSpec[]` array, same transcribe-don't-
redesign rule as Task 8. **Superseded: do NOT keep the fixed `externalLinkId` values in
`RFQ_QUOTES` (30-112).** `externalLink` is keyed on `id` alone, so a literal collides on
the second company seeded into the same database. Omit the id and read back the one the
column default mints.

**Verify:** the shared block above, with `taskN` = `task9`.

---

## Task 10: Extract tier 6 production data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/production.ts`
- Modify: `packages/database/src/datasets/tiers/06-production.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `ProductionData`

**Steps:** move `JOBS` (27-119) and its type `JobSpec` (12-25), `GENEALOGY_INPUTS`
(288-299) and its inline type (288-292), and the `shifts` array inside
`seedProductionEvents` (224-259). `operationStatusFor` (123-138), `seedProductionEvents`
(202-284) and `seedGenealogy` (309-400) are logic and stay — but the literal payloads
inside `seedGenealogy` (330-397) move too.

Note: this file holds 28 date literals, most of them full ISO timestamps in the `shifts`
array. Leave them as strings here; Task 16 converts them.

**Verify:** the shared block above, with `taskN` = `task10`.

---

## Task 11: Extract tier 7 quality data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/quality.ts`
- Modify: `packages/database/src/datasets/tiers/07-quality.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `QualityData`

**Steps:** this file has **no** module-level constants — all data is inline in
`runTier7` (4-85). Extract the two `nonConformance` payloads (18-30, 35-47), the
`nonConformanceJobOperation` payload (70-77), and the `nonConformanceItem` loop's data
(79-84) into `QualityData = { nonConformances: NonConformanceSpec[] }`, where each spec
carries its own job-operation and item associations.

**Verify:** the shared block above, with `taskN` = `task11`.

---

## Task 12: Extract tier 8 change-order data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/change-orders.ts`
- Modify: `packages/database/src/datasets/tiers/08-change-orders.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `ChangeOrderData`

**Steps:** extract the three inline change-order payloads — CO1 (115-147), CO2 (149-223),
CO3 (225-251) — each with its `changeOrder` fields and `changeOrderAffectedItem` entries,
into `ChangeOrderData = { changeOrders: ChangeOrderSpec[] }`.

**Leave `CLONE_EXCLUDE` (20-29) in the tier file** — it is a list of column names to skip
when cloning, i.e. engine configuration, not company data. Likewise `baseMakeMethod`
(33-45) and `cloneMethodRows` (53-108) are logic.

**Verify:** the shared block above, with `taskN` = `task12`.

---

## Task 13: Extract tier 9 accounting data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/accounting.ts`
- Modify: `packages/database/src/datasets/tiers/09-accounting.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `AccountingData`

**Steps:** move `DEPRECIATION_PERIOD_END` (33), `FIXED_ASSETS` (35-106) and its type
`FixedAssetSpec` (8-29), plus the inline journal entry and its two journal lines
(136-160).

Guard rail from `.ai/lessons.md`: a seeded `journalLine`'s sign must move the account
toward its natural balance (`+` increases an Asset/Expense, `+` increases a
Liability/Equity/Revenue). Do not "fix" the existing signs while moving them — an
unbalanced entry silently blocks period close.

**Verify:** the shared block above, with `taskN` = `task13`. Additionally:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT \"journalEntryId\", SUM(amount) FROM \"journalLine\" GROUP BY 1 HAVING SUM(amount) <> 0;"
# Expected: 0 rows
```

---

## Task 14: Extract tier 11 workflow definitions

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/workflows.ts`
- Modify: `packages/database/src/datasets/tiers/workflow-definitions.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `WorkflowData`

**Steps:**

The data here is **not** a plain constant: it is the ~470-line literal inside
`buildSeedWorkflows(refs: { ownerId, issueTypeId })`'s return statement (94-558), which
is parameterized by ids resolved at run time. Keep the factory shape:

```typescript
export type WorkflowData = {
  build: (refs: { ownerId: string; issueTypeId: string }) => SeedWorkflow[];
};
```

1. Move `buildSeedWorkflows` and the DSL builders it uses (`ref` 56-61, `item` 63,
   `text` 65, `template` 67, `literal` 69-73, `str`/`num`/`user`/`issueType` 75-78,
   `edge()` 80-87) into `data/satellite/workflows.ts`, exporting
   `satelliteWorkflows: WorkflowData`.
2. Keep `FORMAT_VERSION` (5), `EVENT_SOURCES` (9-28), and the `Node` / `Edge` /
   `SeedWorkflow` types (30-54) in `workflow-definitions.ts` — those are engine, shared
   by every dataset.
3. **`packages/database/package.json` exports `"./seed-workflows"` pointing at
   `workflow-definitions.ts`.** Check what the external consumer imports from it:

   ```bash
   grep -rn "seed-workflows" --include=*.ts . | grep -v node_modules
   ```

   If the consumer imports `buildSeedWorkflows`, either keep a re-export in
   `workflow-definitions.ts` or repoint the subpath. If you cannot tell what it needs,
   STOP and report — do not guess.
4. `tiers/11-workflows.ts` calls `ctx.dataset.workflows.build({ ownerId, issueTypeId })`
   in place of the direct import.

**Verify:** the shared block above, with `taskN` = `task14`. Additionally:

```bash
pnpm run check:workflow-catalog
# Expected: passes (this is a real root script)
```

---

## Task 15: Extract tier 12 planning data

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/datasets/data/satellite/planning.ts`
- Modify: `packages/database/src/datasets/tiers/12-planning.ts`
- Modify: `packages/database/src/datasets/types.ts` — add `PlanningData`

**Steps:** move `BUY_ITEM_IDS` (15-22), `MAKE_ITEM_IDS` (24-30),
`DEMAND_PROJECTIONS` (42-46), and the inline sales order + payment + shipment + two
order lines (110-160). `WEEKS_TO_PROJECT` (37) is engine configuration — leave it in the
tier.

**Verify:** the shared block above, with `taskN` = `task15`.

---

## Task 16: Add day-offset date resolution and convert satellite's date literals

**Depends on:** Tasks 4–15
**Files:**
- Create: `packages/database/src/datasets/dates.ts`
- Modify: every `packages/database/src/datasets/data/satellite/*.ts` containing a date
- Modify: the tier files that consume those dates

**Steps:**

1. Create `dates.ts`:

   ```typescript
   import { type CalendarDate, parseDate } from "@internationalized/date";

   /** Signed days from the dataset anchor (today, in the company's timezone). */
   export type DayOffset = number;

   /** "YYYY-MM-DD" for a DATE column. */
   export function resolveDate(anchor: CalendarDate, offset: DayOffset): string;

   /** Full ISO instant for a TIMESTAMPTZ column, preserving a time-of-day. */
   export function resolveTimestamp(
     anchor: CalendarDate,
     offset: DayOffset,
     timeOfDay: string,   // "13:00:00"
     timeZone: string
   ): string;
   ```

   Use `anchor.add({ days: offset })` from `@internationalized/date`. **Do not use
   JavaScript `Date`** anywhere in this file (`.claude/rules/date-handling.md`).

2. Convert every date literal in the satellite data modules to an offset. The reference
   date is **2026-08-13**: an offset is `literalDate − 2026-08-13` in days. Compute these
   arithmetically, one file at a time, rather than by eye. Counts to expect, from the
   inventory: tier 4 = 17, tier 5 = 10, tier 6 = 28 (mostly full ISO timestamps —
   those split into an offset plus a `timeOfDay` string), tier 7 = 2, tier 8 = 5,
   tier 9 = 13, tier 12 = 1. Tiers 1, 2, 3, 10, 11 have none.
3. Each tier resolves its offsets through `resolveDate` / `resolveTimestamp` using
   `ctx.anchor` at insert time.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
pnpm db:seed:dev -- --email test@carbon.ms > /tmp/seed-after-task16.txt 2>&1
diff <(grep -A40 "Seeded row counts" .ai/runs/2026-08-13-seed-baseline.txt) <(grep -A40 "Seeded row counts" /tmp/seed-after-task16.txt)
# Expected: no output (row counts unchanged — only the date VALUES move)

psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM \"salesOrder\" WHERE \"orderDate\" > \"promisedDate\";"
# Expected: 0
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM job WHERE \"releasedDate\" > \"dueDate\";"
# Expected: 0
psql "$SUPABASE_DB_URL" -c "SELECT MAX(\"orderDate\") FROM \"salesOrder\";"
# Expected: within the last 30 days of today, not 2026-08-03
```

**Out of scope:** changing the *relative* spacing between any two dates. Offsets are
derived arithmetically precisely so intervals cannot drift.

**Result (2026-08-13):** all 71 literals converted; `grep` for `\d{4}-\d{2}-\d{2}` over
`src/datasets` now matches only `dates.ts`'s own docblock. `resolveTimestamp` takes no
timeZone argument — the ISO literals it replaces were all `...Z`, so the time-of-day is
UTC and adding a zone would have shifted them. Two special cases: the depreciation run's
`periodEnd` is derived by a new `previousMonthEnd(anchor)` helper rather than an offset
(it must stay a month end for `getNextPeriodEnd`), and the fixed assets'
`depreciationCharge` literals were left alone (acquisition date and period end move
together, so the elapsed month count is stable). The seed-run verifications are deferred
to Task 25.

---

## Task 17: Add `--dataset` to the dev CLI

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/src/datasets/cli.ts` — add the option
- Modify: `packages/database/src/seed-dev.ts` — pass the selected dataset

**Steps:**

1. In `cli.ts`, add `dataset: { type: "string", default: "satellite" }` to the
   `parseArgs` options (currently lines 48-56), add `dataset: DatasetKey` to the
   `SeedArgs` type (25-29), validate it against `DATASETS`, and exit with a clear error
   listing the valid keys if it does not match.
2. Add the flag to `printUsage` (31-44).
3. In `seed-dev.ts`, look the dataset up in `DATASETS` and pass it to `applyDataset`.

**Verify:**
```bash
pnpm db:seed:dev -- --email test@carbon.ms --dataset satellite > /tmp/seed-task17.txt 2>&1
diff <(grep -A40 "Seeded row counts" .ai/runs/2026-08-13-seed-baseline.txt) <(grep -A40 "Seeded row counts" /tmp/seed-task17.txt)
# Expected: no output
pnpm db:seed:dev -- --email test@carbon.ms --dataset nope 2>&1 | head -3
# Expected: an error naming the valid dataset keys, exit code 1
pnpm db:seed:dev -- --email test@carbon.ms > /tmp/seed-task17-default.txt 2>&1
diff <(grep -A40 "Seeded row counts" .ai/runs/2026-08-13-seed-baseline.txt) <(grep -A40 "Seeded row counts" /tmp/seed-task17-default.txt)
# Expected: no output (omitting the flag still seeds satellite)
```

**Out of scope:** `crbn up` / `ensureSmokeTestUser`
(`packages/dev/src/services/migrations.ts:298-338`) must keep working with no flag
change — that is what the third check above proves.

---

## Task 18: Author the robotics dataset

**Depends on:** Tasks 16, 17
**Files:**
- Create: `packages/database/src/datasets/data/robotics/` — one file per slice, mirroring
  `data/satellite/`
- Modify: `packages/database/src/datasets/index.ts` — add `robotics` to `DATASETS`

**Steps:**

1. Create a `robotics` dataset with `industryId: "robotics_oem"` and
   `companyName` for a robotics OEM (the `industry` row's description is
   "Original Equipment Manufacturer building robots and automation systems").
2. Set `satellite.industryId = "aerospace_satellite"` (the row Task 19 adds).
3. Fill every slice with robotics-appropriate content at **the same shape and roughly
   the same volume** as satellite — the satellite row counts are the coverage contract.
   Rough targets from the inventory: ~34 items across buy/material/consumable/tool/
   service/make, 4 customers, 6 suppliers, 4 departments, 7 work centers, ~5 sales
   opportunity chains, ~8 purchase orders, jobs across the In Progress / Ready / Planned
   states, 2 non-conformances, 3 change orders, fixed assets, workflows, demand
   projections.
4. Use robotics item id prefixes (e.g. `ROB-`, `ARM-`, `DRV-`, `CTRL-`, `SNS-`, `GRP-`)
   and **no** `SAT-` / `BUS-` / `EPS-` / `ADCS-` / `COMMS-` / `PROP-` prefixes.
5. All dates are `DayOffset` values from the start — never absolute strings.
6. Reuse the satellite dataset's workflow `build` factory if the workflows are generic;
   only diverge where the workflow references item or customer names.

**Verify:**
```bash
pnpm db:seed:dev -- --email robotics-dev@carbon.ms --dataset robotics 2>&1 | tail -40
# Expected: "Dev environment seeded successfully!" and a summary with non-zero counts
# for every table that satellite also populates.
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM item WHERE \"readableId\" LIKE 'SAT-%' OR \"readableId\" LIKE 'EPS-%';"
# Expected: 0 for the robotics company (scope the query by that companyId)
```

**Out of scope:** changing any satellite data to match robotics, or vice versa.

---

## Task 19: Migration — add the `aerospace_satellite` industry row

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_add-aerospace-industry.sql`

**Steps:**

1. `pnpm db:migrate:new add-aerospace-industry`. **Check the generated filename's HHMMSS
   is not `000000`** — rename it if it is (`AGENTS.md`, cross-branch collision rule).
2. Contents — note `industry` is a global catalog with a plain `TEXT PRIMARY KEY`, no
   `companyId`, no audit columns (`20260617100002_onboarding-and-backups.sql:14-23`), so
   the standard company-scoped table template does **not** apply here:

   ```sql
   INSERT INTO "industry" ("id", "name", "description", "iconName", "sortOrder")
   VALUES (
     'aerospace_satellite',
     'Aerospace & Satellite',
     'Small-satellite and spacecraft subsystem manufacturing',
     'satellite',
     4
   )
   ON CONFLICT ("id") DO NOTHING;
   ```

3. **STOP and ask the user to apply it** (`pnpm db:migrate`). Do not run it yourself —
   `AGENTS.md` forbids rebuilding the database to test changes.
4. Once the user confirms it is applied, regenerate types: `pnpm db:types`.
   (`industry` gains no columns, so types should not change — if they do, inspect why.)

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT id, name, \"iconName\", \"sortOrder\" FROM industry ORDER BY \"sortOrder\";"
# Expected: 4 rows, the fourth being aerospace_satellite / Aerospace & Satellite / satellite / 4
```

**Status (2026-08-13):** migration written to
`packages/database/supabase/migrations/20260813023744_add-aerospace-industry.sql`
(HHMMSS `023744`, not `000000`). **BLOCKED — the user must run `pnpm db:migrate`.**
Tasks 22 and 23 can be written before it is applied; Task 25's end-to-end run cannot.

**Out of scope:** adding a `datasetKey` column to `industry`. The mapping lives in code
(`datasetForIndustry`), per the spec's Design Decisions.

---

## Task 20: Declare the `carbon/company-template` event

**Depends on:** Task 3
**Files:**
- Modify: `packages/lib/src/events.ts` — add to the `Events` type
- Modify: `packages/lib/src/trigger.ts` — add to the `taskToEvent` map

**Steps:**

1. In `packages/lib/src/events.ts`, inside `export type Events = { ... }` (starts line
   14), next to `"carbon/company-import"` (lines 167-188), add:

   ```typescript
   // Onboarding demo template — applies a shared dataset (the same code the dev
   // seed runs) to a freshly created company.
   "carbon/company-template": {
     data: {
       companyId: string;
       userId: string;
       datasetKey: string;
       templateRunId: string;
     };
   };
   ```

   `datasetKey` is typed as `string`, not `DatasetKey` — `@carbon/lib` must not take a
   dependency on `@carbon/database` just for a union. The job validates it.

2. In `packages/lib/src/trigger.ts`, add to the `taskToEvent` map (lines 9-45, alphabetical
   near line 14):

   ```typescript
   "company-template": "carbon/company-template",
   ```

   Nothing else in that file changes — `TaskPayloads` derives the typing automatically
   (lines 47-62).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: no errors
```

**Out of scope:** touching the existing `templateIndustryId` field on
`carbon/company-import` — it stays dormant, per the spec.

---

## Task 21: Build the `company-template` Inngest job

**Depends on:** Tasks 3, 20
**Files:**
- Create: `packages/jobs/src/inngest/functions/tasks/company-template.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/index.ts` — export it
- Modify: `packages/jobs/src/inngest/index.ts` — import it and add to the `functions` array
- Copy from (precedent): `packages/jobs/src/inngest/functions/tasks/company-import.ts:33-80`
  for the function shape; `packages/jobs/src/inngest/functions/tasks/company-restore.ts:275-314`
  for the status-marker helper

**Steps:**

1. Create the function mirroring `company-import`'s options:

   ```typescript
   export const companyTemplateFunction = inngest.createFunction(
     {
       id: "company-template",
       retries: 1,
       concurrency: { key: "event.data.companyId", limit: 1 }
     },
     { event: "carbon/company-template" },
     async ({ event, step, logger }) => { ... }
   );
   ```

2. Add `export const TEMPLATE_INTEGRATION = "company-template";` and a
   `writeTemplateMarker` helper copied in shape from `writeRestoreMarker`
   (`company-restore.ts:275-314`) — read-then-insert-or-update a single
   `externalIntegrationMapping` row keyed by `metadata->>templateRunId`, with
   `entityType: "template"`, `entityId: templateRunId`, `integration: TEMPLATE_INTEGRATION`.
   Statuses: `running` → cleared on success, `failed` with the error message on throw.
3. Body, inside one `step.run("apply-template", ...)`:
   - Resolve the dataset: `DATASETS[datasetKey]` from `@carbon/database/datasets`.
     Unknown key → write a `failed` marker and throw.
   - **Double-apply guard**: with the service-role Supabase client, count `item` rows for
     the company. Non-zero → write a `failed` marker with a clear message and return
     without writing anything.
   - Resolve the timezone: `getCompanyTimeZone(client, companyId)` from `@carbon/database`,
     passing the **service-role Supabase client** (the overload accepts a Supabase client
     or a Kysely handle, not a raw `pg` client —
     `packages/database/supabase/functions/lib/datetime.ts:60-71`).
   - Open a pool: `const pool = getPostgresConnectionPool(1)` from
     `@carbon/database/client`; `const pgClient = await pool.connect()`. `applyDataset`
     needs a real `PoolClient` because it issues `BEGIN` and `SET LOCAL`; the shared
     `getJobDatabaseClient` Kysely handle cannot do that. **Release the client in a
     `finally`** — leaking it starves the pool.
   - Call `applyDataset(pgClient, { companyId, userId, dataset, timeZone, log: logger.info })`.
   - On success clear the marker; on throw write `failed` and rethrow.
4. `packages/jobs/src/inngest/functions/tasks/index.ts` — add
   `export { companyTemplateFunction } from "./company-template";` next to the
   `company-import` line (currently line 4).
5. `packages/jobs/src/inngest/index.ts` — add `companyTemplateFunction,` to the import
   block from `"./functions/tasks"` (lines 63-82) **and** to the `functions` array under
   the `// Tasks` comment (near line 113). Missing either one means the job silently
   never runs.
6. **Do not call `getLocalTimeZone()` anywhere in this file.** `packages/jobs/src` is
   scanned by the `no-local-timezone` conformance check
   (`packages/checks/src/sources/server-files.ts:10-14`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no errors
pnpm --filter @carbon/checks test
# Expected: passes, no new no-local-timezone violation
grep -c "companyTemplateFunction" packages/jobs/src/inngest/index.ts
# Expected: 2 (the import and the array entry)
```

**Deviations (2026-08-13):**
- Pool size is `getPostgresConnectionPool(2)`, not `(1)`. Pools are cached by connection
  count (`functions/lib/postgres/index.ts:40-53`), so size 1 is the *shared* pool behind
  `getJobDatabaseClient()` — which the event drainer and workflow matcher run on. Holding
  its single connection for a whole dataset transaction would starve them. Size 2 is a
  distinct cache key, so this job never contends with them.
- `startedAt` uses `datetime.timestamp()` from `@carbon/utils`, not `new Date()`, per
  `.claude/rules/date-handling.md`.

**Environment note:** `pnpm --filter @carbon/checks test` initially failed with
`Cannot find module '.../packages/config/dist/vitest.mjs'`. Pre-existing and unrelated —
`@carbon/config` simply had not been built in this worktree. Fixed with
`pnpm exec turbo run build --filter=@carbon/config`; the suite then passed 54/54,
including `no-local-timezone`.

**Out of scope:** a UI for template progress. The marker exists for diagnosis; the
onboarding screen does not poll it in this change.

---

## Task 22: Wire the template branch through onboarding

**Depends on:** Tasks 19, 20, 21
**Files:**
- Modify: `apps/erp/app/services/onboarding.server.ts` — `provisionCompanyData` (33-93)
  and `provisionOnboardingCompany` (101-210)
- Modify: `apps/erp/app/routes/onboarding+/industry.tsx` — the action (107-183)

**Steps:**

1. `provisionCompanyData` takes a third input alongside `backup`:
   `template: string | null` (a dataset key). Branch table:

   | Input | Seed call | Then |
   |---|---|---|
   | `backup` set | `seedCompany(..., { identityOnly: true })` | unpack + `trigger("company-import")` — unchanged |
   | `template` set | `seedCompany(serviceRole, companyId, userId)` (full) | `trigger("company-template", { companyId, userId, datasetKey: template, templateRunId: nanoid() })` |
   | neither | `seedCompany(serviceRole, companyId, userId)` (full) | nothing — unchanged |

   The template branch needs the **full** clean seed, not `identityOnly` — the tiers'
   `buildCtx` pre-flight requires a chart of accounts, a `location`, and a
   `unitOfMeasure` with code `EA`.

2. Wrap the `trigger` call in the same try/catch as the import branch
   (`onboarding.server.ts:80-92`) and throw `"Fatal: failed to start company template"`
   on failure. A silent enqueue failure would leave the user with an empty company while
   onboarding reported success.
3. `provisionOnboardingCompany` passes `template` straight through to
   `provisionCompanyData`.
4. In `industry.tsx`'s action, after the existing `backup` resolution (149-155), add:

   ```typescript
   // "Use a demo template" → the dataset registered for the chosen industry, if any.
   // An industry with no dataset falls through to a clean seed, exactly as before.
   const template =
     dataChoice === "template"
       ? (datasetForIndustry(companyData.industryId)?.key ?? null)
       : null;
   ```

   importing `datasetForIndustry` from `@carbon/database/datasets`, and pass `template`
   into `provisionOnboardingCompany` (157-161).

5. `industry.tsx` is a route module, so its `action` **is** scanned by the
   `no-local-timezone` check — do not introduce any date handling here.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors. Note the erp package is named `erp`, not `@carbon/erp` —
# a wrong filter silently passes without checking anything.
pnpm --filter @carbon/checks test
# Expected: passes
```

**Out of scope:** removing the `isInternalEmail` gate (92-94, 112-114). The step stays
internal-only.

---

## Task 23: UI — industry icon and template card copy

**Depends on:** Task 19
**Files:**
- Modify: `apps/erp/app/routes/onboarding+/industry.tsx` — `INDUSTRY_ICONS` (71-75) and
  the `template` choice card (230-250)
- Copy from (precedent): the existing entries in `INDUSTRY_ICONS` (71-75) and the
  neighbouring `ChoiceCardOption` elements (230-250) in the same file

**Steps:**

1. Add a `satellite` entry to `INDUSTRY_ICONS` matching the shape of the existing three
   (`<LuSatellite className="h-5 w-5" />`), importing the icon from the same `react-icons/lu`
   module the file already imports `LuBot` / `LuCog` / `LuWrench` from. If `LuSatellite`
   does not exist in the installed version, use `LuRadio` and note the substitution —
   do not leave the icon falling through to `LuFactory`.
2. Update the `template` card's description so it says the demo data is being set up and
   will appear shortly, rather than implying it is present the moment onboarding
   finishes — the job is asynchronous. Keep the existing `ChoiceCardOption` props and
   styling; change copy only.
3. Any new user-facing string must be wrapped for translation the way its neighbours in
   this file are (`<Trans>` or `useLingui().t` from the macro imports) —
   `.claude/rules/i18n-lingui-system.md`. Do **not** run `pnpm lingui:extract`; on this
   branch it produces ~120k lines of unrelated churn.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
grep -n "satellite" apps/erp/app/routes/onboarding+/industry.tsx
# Expected: a line inside INDUSTRY_ICONS
```

**Out of scope:** redesigning the three-way picker, or adding a "coming soon" state for
industries without a dataset — they behave exactly as they do today.

---

## Task 24: Sync the stale rules and docs

**Depends on:** Tasks 21, 22
**Files:**
- Modify: `.claude/rules/company-backup-restore.md` — the "Onboarding seed" section
- Modify: `packages/database/supabase/backups/README.md`
- Modify: `packages/database/AGENTS.md` — the "Dev Seed" section (if Task 2 left gaps)
- Modify: `.ai/lessons.md` — add a lesson if anything surprising came up

**Steps:**

1. `.claude/rules/company-backup-restore.md`'s "Onboarding seed" section currently states
   that a demo template is a committed `.gz` at
   `packages/database/supabase/backups/<industryId>.carbon.json.gz` imported on top of an
   identity-only seed. **That was never implemented and is not what this change does.**
   Rewrite it to describe the `company-template` job applying a shared dataset, and note
   that `TEMPLATE_BUCKET`, `TEMPLATE_ASSET_PREFIX`, `ci/src/upload-backup-templates.ts`,
   and `company-import`'s `templateIndustryId` are dormant.
2. `packages/database/supabase/backups/README.md:26-31` makes the same stale claim —
   correct it, or delete the file if nothing in it is still true. Per
   `.claude/rules/keep-sources-in-sync.md`, deleting a wrong line beats leaving it.
3. Confirm `packages/database/AGENTS.md`'s "Dev Seed" section names `src/datasets/`,
   documents the engine/data split, and mentions the `--dataset` flag.

**Verify:**
```bash
grep -rn "carbon.json.gz" .claude/rules/company-backup-restore.md packages/database/supabase/backups/README.md
# Expected: no line still claiming the onboarding template is a committed .gz
```

**Out of scope:** rewriting the backup/restore documentation generally. Only the
onboarding-seed claims are wrong.

---

## Task 25: End-to-end verification

**Depends on:** all
**Files:** none (verification only)

**Steps:**

1. Full static gate:

   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs --filter=@carbon/lib --filter=erp
   pnpm exec biome check
   pnpm run test
   ```

   For biome, fix only error-severity findings — the repo carries ~419 pre-existing
   warnings; do not touch those. Do **not** run the whole-repo `pnpm typecheck`, which
   runs out of memory.

2. Dev seed, both datasets, verified against the Task 1 baseline for satellite.
3. Onboarding, in a browser, with the local stack running and Inngest dev running
   (`pnpm --filter @carbon/jobs dev:jobs`). Ask the user before driving the browser.
   Sign up with an internal email (`@carbon.ms`), reach the data-choice step, and run
   all four cases:
   - "Use a demo template" + **Robotics OEM** → the new company's Parts list is non-empty
     within a minute and shows `ROB-`/`ARM-` ids.
   - "Use a demo template" + **Aerospace & Satellite** → shows `SAT-`/`EPS-` ids.
   - "Use a demo template" + **Precision Manufacturing** (no dataset) → a clean company,
     no error, and no `company-template` row in `externalIntegrationMapping`.
   - "I don't need data" → identical clean company.
4. Failure paths:
   - Re-trigger `company-template` against a company that already has items → the job
     writes a `failed` marker and inserts nothing.
   - Temporarily force a throw inside a mid-numbered tier, run the job, and confirm the
     company has **zero** dataset rows afterwards (the transaction rolled back). Revert
     the forced throw.
5. Freshness and invariants:

   ```bash
   psql "$SUPABASE_DB_URL" -c "SELECT MAX(\"orderDate\") FROM \"salesOrder\";"
   # Expected: within the last 30 days
   psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM \"salesOrder\" WHERE \"orderDate\" > \"promisedDate\";"
   # Expected: 0
   psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM job WHERE \"releasedDate\" > \"dueDate\";"
   # Expected: 0
   ```

6. Tick every box in the spec's Acceptance Criteria, or state plainly which ones did not
   pass and why. Do not claim completion without the command output to back it.

**Out of scope:** committing. Per the user's standing rule, commit only when explicitly
asked.

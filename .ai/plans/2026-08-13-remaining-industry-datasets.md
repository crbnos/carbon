# Remaining industry demo datasets — implementation plan

**Spec / source:** `.ai/specs/2026-08-13-remaining-industry-datasets.md`
**Research:** `.ai/research/2026-08-13-remaining-industry-datasets.md`
**Branch:** `feat/onboarding-templates`

## Progress

- [x] Task 1: Add the new foundation/production spec types
- [x] Task 2: Move satellite's tier-1 content into its data slice
- [x] Task 3: Make `tiers/01-foundation.ts` read the dataset instead of its own literals
- [x] Task 4: Dataset-drive the two job ref keys in `tiers/06-production.ts`
- [x] Task 5: Delete the dead `Dataset.companyName` field
- [x] Task 6: **GATE** — prove satellite's seeded output is unchanged
- [x] Task 7: Recover the robotics foundation + items slices from the stash
- [x] Task 8: Write the nine remaining robotics slices
- [x] Task 9: Register `robotics` and seed-verify it
- [x] Task 10: Write the `precision` dataset
- [x] Task 11: Write the `motor` dataset
- [x] Task 12: End-to-end verification across all four datasets
- [x] Task 13: Refresh the docs

## Dependencies

- Tasks 1 → 2 → 3 → 6 are a strict chain. Task 4 and Task 5 are independent of 2/3 and may run in parallel with them, but all of 1–5 must land before Task 6.
- **Task 6 is a hard gate.** Do not start Task 7 until it passes. If satellite's counts changed, the refactor dropped rows and must be fixed first — that is the whole point of doing satellite before robotics.
- Task 7 → 8 → 9.
- Tasks 10 and 11 are independent of each other and both depend only on Task 9 (which proves the engine accepts a second dataset). They may run as parallel subagents.
- Task 12 depends on 9, 10, 11. Task 13 last.

## Environment notes

- The local Supabase stack must be up. If `pnpm db:seed:dev` fails with `SELF_SIGNED_CERT_IN_CHAIN` or `Failed to create user: fetch failed`, your local certificate chain is the problem. Point Node at the local CA with `NODE_EXTRA_CA_CERTS=/path/to/local-ca.pem`, or fix the chain. Do not disable certificate validation.
- To query the database directly:
  ```bash
  DBURL=$(grep -h '^SUPABASE_DB_URL=' .env.local .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
  psql "$DBURL" -c "<sql>"
  ```
- **Never rebuild the database.** If a migration seems needed, STOP and report — this plan requires none.
- `journal` survives the dev wipe (`tiers/09-accounting.ts` skips an entry whose `journalEntryId` already exists). When re-seeding to check an accounting change, delete the rows first:
  ```bash
  psql "$DBURL" -c "DELETE FROM \"journalLine\" WHERE \"companyId\"='<id>'; DELETE FROM journal WHERE \"companyId\"='<id>';"
  ```

## Rules that apply to every task

These are established branch conventions. Violating any of them is a defect, not a style choice.

1. **No JavaScript `Date`** anywhere under `packages/database/src/datasets/`, and **no `CURRENT_DATE`** in a tier's SQL. Every date is a signed `DayOffset` resolved against `ctx.anchor` via `dates.ts`. Nothing enforces this automatically — `@carbon/checks` does not scan `packages/database/src/**`.
2. **Never write a literal primary key.** `externalLink` and `period` are keyed on `id` alone, so a fixed literal collides on the second company seeded into the same database. Let the column default mint it and read it back with `insertId`.
3. **Journal lines must balance.** A *positive* amount on a Revenue account IS the credit. Asset `+X` / Revenue `+X` balances; Revenue `-X` reads as a second debit and blocks period close.
4. **New content goes in `data/<key>/` only.** The tiers are shared, industry-agnostic code. The only tier edits in this plan are Tasks 3 and 4, which *remove* industry content.
5. **Comments:** one line, only where a future dev genuinely needs the *why*. No banners, no narration of the change.

---

## Task 1: Add the new foundation/production spec types

**Depends on:** none
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — add five new spec types, extend `FoundationData` and `ProductionData`

**Steps:**

1. Add these exported types next to the other foundation specs (near `ContractorSpec`, around line 85):

```typescript
export type ShiftSpec = {
  name: string;
  /** "HH:MM:SS", plant-local wall clock. */
  startTime: string;
  endTime: string;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
};

export type PlantSpec = {
  name: string;
  addressLine1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  timezone: string;
};

export type WarehouseSpec = {
  /** ctx.refs.warehouses key, and what ShelfSpec.warehouse references. */
  key: string;
  name: string;
  requiresPick?: boolean;
  requiresPutAway?: boolean;
  requiresBin?: boolean;
};

export type ShelfSpec = {
  /** The exact string openingStock[].shelf and the inventory count reference. */
  name: string;
  /** WarehouseSpec.key this shelf lives in. */
  warehouse: string;
  /** One of FoundationData.storageTypes. */
  storageType: string;
  /** Another ShelfSpec.name this nests under, for racking rows. */
  parent?: string;
};

export type PrinterRouteSpec = {
  name: string;
  format: string;
  printerUrl: string;
};

export type ContractorAgencySpec = {
  name: string;
  /** One of FoundationData.supplierTypes. */
  type: string;
  phone: string;
};
```

2. Extend `FoundationData` (currently `types.ts:92-113`) with these fields, and **remove `binLevels`** (the explicit `shelves` list replaces it):

```typescript
  plant: PlantSpec;
  shifts: ShiftSpec[];
  warehouses: WarehouseSpec[];
  storageTypes: string[];
  shelves: ShelfSpec[];
  printerRoute: PrinterRouteSpec | null;
  /** Must be one of shippingMethods; applied to every customer and supplier. */
  defaultShippingMethod: string;
  contractorAgency: ContractorAgencySpec | null;
  /** Billing address used for every customer and supplier location. */
  partyAddressCity: string;
  partyAddressStateProvince: string;
  partyAddressPostalCode: string;
  partyAddressCountryCode: string;
```

3. Extend `ProductionData` (currently `types.ts:504-509`) with the two job keys tier 6 currently hard-codes:

```typescript
export type ProductionData = {
  jobs: JobSpec[];
  shifts: ShiftEventSpec[][];
  genealogyInputs: GenealogyInputSpec[];
  genealogyAssembly: GenealogyAssemblySpec;
  /** JobSpec.key whose operations get production events. */
  eventsJobKey: string;
  /** JobSpec.key the as-built genealogy hangs off. */
  genealogyJobKey: string;
};
```

Note `ProductionData.shifts` is `ShiftEventSpec[][]` (production event blocks) and is unrelated to the new `FoundationData.shifts` (`shift` table rows). Do not merge them.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database 2>&1 | tail -20
# Expected: failures ONLY in data/satellite/*.ts and tiers/*.ts for the new
# required fields — those are fixed in Tasks 2-4. No errors in types.ts itself.
```

**Out of scope:** Do not touch `SalesData`, `PurchasingData`, `QualityData` or any other slice type. Do not make the purchasing-RFQ slice optional — that is deliberately deferred.

---

## Task 2: Move satellite's tier-1 content into its data slice

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/datasets/data/satellite/foundation.ts` — add the new consts and wire them into `satelliteFoundation`

**Steps:**

1. Add these exported consts. **Every value is copied verbatim from `tiers/01-foundation.ts` so satellite's output does not change** — do not "improve" any of them.

```typescript
export const PLANT: PlantSpec = {
  name: "Manufacturing Plant",
  addressLine1: "4500 Space Commerce Drive",
  city: "Houston",
  stateProvince: "TX",
  postalCode: "77058",
  countryCode: "US",
  timezone: "America/Chicago"
};

export const SHIFTS: ShiftSpec[] = [
  {
    name: "Day Shift",
    startTime: "06:00:00",
    endTime: "14:30:00",
    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true
  },
  {
    name: "Swing Shift",
    startTime: "14:30:00",
    endTime: "23:00:00",
    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true
  }
];

export const WAREHOUSES: WarehouseSpec[] = [
  { key: "Main", name: "Main Warehouse", requiresPick: true, requiresPutAway: true, requiresBin: true },
  { key: "RMA",  name: "RMA / Return" },
  { key: "QC",   name: "QC Hold", requiresBin: true }
];

export const STORAGE_TYPES = ["Shelf", "Bin", "Rack"];

export const PRINTER_ROUTE: PrinterRouteSpec = {
  name: "Main Label Printer",
  format: "zpl",
  printerUrl: "http://192.168.1.50:9100"
};

export const CONTRACTOR_AGENCY: ContractorAgencySpec = {
  name: "Orbital Staffing",
  type: "Services",
  phone: "+1-281-555-1100"
};
```

2. Replace `BIN_LEVELS` with an explicit `SHELVES` list that reproduces exactly what the tier generates today: one `Aisle-A` rack, then `A{1..3}-{L1,L2,L3}` bins under it, then the clean-room shelf. That is **1 + 9 + 1 = 11 entries**:

```typescript
export const SHELVES: ShelfSpec[] = [
  { name: "Aisle-A", warehouse: "Main", storageType: "Rack" },
  { name: "A1-L1", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A1-L2", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A1-L3", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A2-L1", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A2-L2", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A2-L3", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A3-L1", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A3-L2", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A3-L3", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "CleanRoom", warehouse: "Main", storageType: "Shelf" }
];
```

The old generator produced the storage unit named `Clean Room Shelf` under the ref key `CleanRoom`. The new model uses one name for both, so the storage unit is now **named `CleanRoom`**. That is an intentional, cosmetic rename; note it in the Task 6 report rather than treating it as a regression. Ref keys are unchanged, so `data/satellite/inventory.ts` needs no edit.

3. Delete the `BIN_LEVELS` const and its `binLevels:` line from `satelliteFoundation`.

4. Add to `satelliteFoundation`: `plant: PLANT`, `shifts: SHIFTS`, `warehouses: WAREHOUSES`, `storageTypes: STORAGE_TYPES`, `shelves: SHELVES`, `printerRoute: PRINTER_ROUTE`, `defaultShippingMethod: "UPS Ground"`, `contractorAgency: CONTRACTOR_AGENCY`, `partyAddressCity: "Houston"`, `partyAddressStateProvince: "TX"`, `partyAddressPostalCode: "77058"`, `partyAddressCountryCode: "US"`.

5. Import the new types from `../../types.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database 2>&1 | tail -20
# Expected: no remaining errors in data/satellite/foundation.ts.
# Errors in tiers/01-foundation.ts and tiers/06-production.ts are expected until Tasks 3-4.
```

**Out of scope:** Do not change any existing const in this file (`DEPT_NAMES`, `PROCESSES`, `CUSTOMERS`, `SUPPLIERS`, `PROCEDURES`, …). Do not change `data/satellite/inventory.ts`.

---

## Task 3: Make `tiers/01-foundation.ts` read the dataset instead of its own literals

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts`

**Steps:**

1. **Shifts** (replaces lines 15–38): loop `data.shifts`, inserting one `shift` row each with `locationId` and the day booleans defaulting to `false` when absent. Publish each as `ctx.refs.shifts[spec.name] = id`.
   Note: the old code published the keys `Day` and `Swing`; a grep confirms `refs.shifts` is **read nowhere**, so changing the key shape is safe. If that grep now shows a reader, STOP and report.

2. **Plant location** (replaces lines 64–74): build the `location` insert from `data.plant`. Keep `ctx.refs.locations.Plant` / `.HQ` and the `employeeJob` UPDATE exactly as they are.

3. **Warehouses** (replaces lines 87–104): loop `data.warehouses`, insert with `locationId: plantId` and the three boolean flags defaulting to `false`, publish `ctx.refs.warehouses[w.key] = id`.

4. **Storage types + shelves** (replaces lines 106–142): insert one `storageType` per `data.storageTypes` entry into a local `Map<string, string>`. Then insert `data.shelves` **in array order** so a parent always precedes its children, resolving `parentId` from `ctx.refs.shelves[spec.parent]` and `warehouseId` from `ctx.refs.warehouses[spec.warehouse]`. Publish `ctx.refs.shelves[spec.name] = id`.
   Use `need()` from `../sql.ts` for the warehouse, the storage type and the parent — a mismatch must be a loud error, because today it silently drops all opening stock. If a `parent` is named that has not been inserted yet, throw with a message naming both shelves.

5. **Default shipping method** (lines 253 and 309): replace both `ctx.refs.shippingMethods["UPS Ground"]` reads with `need(ctx.refs.shippingMethods, data.defaultShippingMethod)`.

6. **Party addresses** (lines 269–275 and 325–331): replace the hard-coded `Houston` / `TX` / `77058` / `US` with `data.partyAddressCity` etc. Leave `addressLine1: "See parent"` and `"See supplier record"` as they are — they are generic.

7. **Contractor agency** (lines 366–372): if `data.contractorAgency` is null, skip the agency and the whole contractor loop. Otherwise insert the supplier from the spec, with `supplierTypeId: need(ctx.refs.misc, \`stype:${data.contractorAgency.type}\`)`, and publish `ctx.refs.suppliers[data.contractorAgency.name]`.

8. **Printer route** (lines 398–404): skip entirely when `data.printerRoute` is null; otherwise build the insert from the spec.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database 2>&1 | tail -20
# Expected: no errors in tiers/01-foundation.ts.
grep -nE "Houston|Space Commerce|Orbital Staffing|192\.168|UPS Ground|Day Shift|Swing Shift|Main Warehouse|Clean Room|binLevels" packages/database/src/datasets/tiers/01-foundation.ts
# Expected: no output at all.
```

**Out of scope:** Do not touch the payment-term `ILIKE '%net%30%'` lookup, `currencyCode: "USD"`, `supplierProcess.leadTime: 5`, or `contractor.hoursPerWeek: 40`. Those are deferred cleanup and changing them here would muddy the Task 6 baseline diff.

---

## Task 4: Dataset-drive the two job ref keys in `tiers/06-production.ts`

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/datasets/tiers/06-production.ts` — lines 101 and 163
- Modify: `packages/database/src/datasets/data/satellite/production.ts` — add the two new fields

**Steps:**

1. At `06-production.ts:101`, replace `need(ctx.refs.documents, "job:in-progress")` with ``need(ctx.refs.documents, `job:${data.eventsJobKey}`)``.
2. At `06-production.ts:163`, replace the same literal with ``need(ctx.refs.documents, `job:${data.genealogyJobKey}`)``.
3. In `data/satellite/production.ts`, add `eventsJobKey: "in-progress"` and `genealogyJobKey: "in-progress"` to the exported `satelliteProduction` object, preserving today's behaviour exactly.

**Verify:**
```bash
grep -n "job:in-progress" packages/database/src/datasets/tiers/06-production.ts
# Expected: no output.
pnpm exec turbo run typecheck --filter=@carbon/database 2>&1 | tail -10
# Expected: no errors in tiers/06-production.ts or data/satellite/production.ts.
```

**Out of scope:** Do not change `07-quality.ts`, which reaches jobs through `data/satellite/quality.ts:14`'s own ref string — that is already dataset-driven.

---

## Task 5: Delete the dead `Dataset.companyName` field

**Depends on:** none
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — remove `companyName: string;` (line 681)
- Modify: `packages/database/src/datasets/data/satellite/index.ts` — remove `companyName: "Orbital Systems Inc.",`

**Steps:**

1. Confirm it is genuinely unread first:
   ```bash
   grep -rn "companyName" packages/database/src/datasets packages/jobs/src apps/erp/app --include=*.ts --include=*.tsx | grep -v "data/satellite/index.ts" | grep -v "types.ts:681"
   ```
   If this returns any reader, **STOP and report** — do not delete.
2. Remove both lines. Keep the company's identity in the file's doc comment so the story is still readable.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs --filter=erp 2>&1 | tail -6
# Expected: "Tasks: 3 successful, 3 total"
```

**Out of scope:** `Dataset.label` and `Dataset.key` are both live — do not remove them.

---

## Task 6: GATE — prove satellite's seeded output is unchanged

**Depends on:** Tasks 1–5
**Files:** none (verification only)

**Steps:**

1. Seed satellite into a clean company and capture the printed counts:
   ```bash
   pnpm db:seed:dev -- --email test@carbon.ms --dataset satellite 2>&1 | tee /tmp/satellite-after.txt
   ```
2. Diff the `Seeded row counts` block against the committed baseline:
   ```bash
   sed -n '/Seeded row counts/,/^$/p' /tmp/satellite-after.txt > /tmp/counts-after.txt
   diff <(grep -E "^  [a-z]" .ai/runs/2026-08-13-seed-baseline.txt) <(grep -E "^  [a-z]" /tmp/counts-after.txt)
   ```
   **Expected: no output.** Any difference means the refactor dropped or duplicated rows — fix it before going further.
3. Check the structural sums that counts alone miss, per `.ai/runs/2026-08-13-seed-baseline-structural.txt`: `methodMaterial` count + quantity sum, `methodOperation` count + time sums, `salesOrderLine` count + quantity sum. Compare each against that file.
4. Confirm the shelves resolved — opening stock must not be silently empty:
   ```bash
   psql "$DBURL" -c "SELECT count(*) FROM \"itemLedger\" WHERE \"companyId\"='<companyId>';"
   # Expected: 19, matching the baseline.
   ```

**If any check fails, STOP and report the exact diff. Do not proceed to Task 7 and do not "fix" the baseline file to match.**

**Out of scope:** Do not edit `.ai/runs/2026-08-13-seed-baseline.txt` — it is the reference, not an output.

---

## Task 7: Recover the robotics foundation + items slices from the stash

**Depends on:** Task 6
**Files:**
- Create: `packages/database/src/datasets/data/robotics/foundation.ts` (525 lines, from the stash)
- Create: `packages/database/src/datasets/data/robotics/items.ts` (746 lines, from the stash)

**Steps:**

1. Restore both files read-only. **Do not pop or apply the stash** — the working tree has advanced far past it:
   ```bash
   mkdir -p packages/database/src/datasets/data/robotics
   git show "stash@{0}^3:packages/database/src/datasets/data/robotics/foundation.ts" > packages/database/src/datasets/data/robotics/foundation.ts
   git show "stash@{0}^3:packages/database/src/datasets/data/robotics/items.ts"      > packages/database/src/datasets/data/robotics/items.ts
   ```
   If `stash@{0}` is no longer the robotics stash (check `git stash list` — its message must contain `robotics dataset`), **STOP and report** rather than restoring the wrong stash.
2. Delete the one incompatible line in `foundation.ts`: `structuralSteps: ARM_BASE_STEPS_V2,` (was line 513). Keep the `ARM_BASE_STEPS_V2` const itself — `PROCEDURES` v2 references it.
3. Add the fields Task 1 introduced to `roboticsFoundation`, with **robotics-appropriate** values (this is a robot-arm OEM, not an aerospace shop — a plausible Midwest US automation company). Supply: `plant`, `shifts`, `warehouses`, `storageTypes`, `shelves`, `printerRoute`, `defaultShippingMethod` (must be one of its own `shippingMethods`), `contractorAgency` (whose `type` must be one of its own `supplierTypes`), and the four `partyAddress*` fields.
   The `shelves` list must contain **every** shelf name that `data/robotics/inventory.ts` will later reference in Task 8 — get these two consistent or opening stock is dropped.

**Verify:**
```bash
grep -n "structuralSteps" packages/database/src/datasets/data/robotics/foundation.ts
# Expected: no output.
grep -c "readableId:" packages/database/src/datasets/data/robotics/items.ts
# Expected: 34 (11 buy + 6 materials + 2 consumables + 2 tools + 1 service + 11 make, plus method references).
```

**Out of scope:** Do not restyle or renumber the recovered content. It is at satellite parity by design; changing item counts breaks the coverage contract.

---

## Task 8: Write the nine remaining robotics slices

**Depends on:** Task 7
**Files:**
- Create, each mirroring its `data/satellite/` counterpart: `inventory.ts`, `sales.ts`, `purchasing.ts`, `production.ts`, `quality.ts`, `change-orders.ts`, `accounting.ts`, `workflows.ts`, `planning.ts`, `index.ts` — all under `packages/database/src/datasets/data/robotics/`
- Copy from (precedent): the same-named file under `packages/database/src/datasets/data/satellite/`

**Steps:**

1. For each slice, open satellite's equivalent and write the robotics version with the same **structure and cardinality**, substituting robotics items, customers and suppliers. Satellite's line counts for reference: workflows 511, sales 290, production 195, purchasing 194, accounting 114, inventory 77, change-orders 71, planning 70, quality 30, index 34.
2. `index.ts` mirrors `data/satellite/index.ts`: assemble all eleven slices into an exported `Dataset` with `key: "robotics"`, `label: "Robotics OEM"`, `industryId: "robotics_oem"`. There is **no `companyName`** field (Task 5 removed it).
3. Slice-specific requirements:
   - **inventory** — every `openingStock[].shelf` must exactly match a `ShelfSpec.name` from Task 7. Buy parts get stock; Make parts do not.
   - **production** — set `eventsJobKey` and `genealogyJobKey` to real `JobSpec.key` values from this dataset's own `jobs` array. `shifts` is `ShiftEventSpec[][]`, indexed by operation position; supply at least two blocks.
   - **accounting** — the journal entry must balance: Asset `+X` and Revenue `+X`, **both positive**. Every date is a `DayOffset`.
   - **sales / purchasing** — no `id:` field on any external-link spec; the column default mints it.
   - **quality** — an NCR's `openDateOffset` must be **on or after** the released date of the job it references. Satellite currently violates this (`quality.ts:9` is `-312` vs a job released at `-297`); do not copy that mistake.
   - **planning** — `promisedDateOffset` must land inside the 48-week horizon (satellite uses `56`).
4. Cross-check every `readableId`, customer name and supplier name against `data/robotics/items.ts` and `foundation.ts`. A typo becomes a silent NULL or a dropped row, not an error.

**Verify:**
```bash
grep -rn "new Date\|CURRENT_DATE" packages/database/src/datasets/data/robotics/
# Expected: no output.
grep -rnE "\"[0-9a-f]{8}-[0-9a-f]{4}-" packages/database/src/datasets/data/robotics/
# Expected: no output (no UUID literals).
pnpm exec turbo run typecheck --filter=@carbon/database 2>&1 | tail -6
# Expected: "Tasks: 1 successful, 1 total"
```

**Out of scope:** Do not modify any tier or any satellite file. If a robotics story genuinely cannot be expressed through the existing slice types, STOP and report rather than widening a type — that is a spec change.

---

## Task 9: Register `robotics` and seed-verify it

**Depends on:** Task 8
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `DatasetKey` becomes `"satellite" | "robotics"`
- Modify: `packages/database/src/datasets/index.ts` — import `robotics`, add to `DATASETS`
- Create: `.ai/runs/2026-08-13-robotics-baseline.txt`

**Steps:**

1. Widen the union and the registry.
2. Seed robotics into a fresh company:
   ```bash
   pnpm db:seed:dev -- --email robotics-demo@carbon.ms --dataset robotics 2>&1 | tee /tmp/robotics.txt
   ```
3. Save the printed `Seeded row counts` block to `.ai/runs/2026-08-13-robotics-baseline.txt`.
4. Check every acceptance criterion for this dataset:
   ```bash
   # No table at zero, counts within ~10% of satellite's
   sed -n '/Seeded row counts/,/^$/p' /tmp/robotics.txt
   # Journal balances
   psql "$DBURL" -c "SELECT \"journalEntryId\",\"totalDebits\",\"totalCredits\" FROM \"journalEntries\" WHERE \"companyId\"='<roboticsCompanyId>';"
   # Expected: totalDebits = totalCredits for every row.
   # Opening stock landed
   psql "$DBURL" -c "SELECT count(*) FROM \"itemLedger\" WHERE \"companyId\"='<roboticsCompanyId>';"
   # Expected: non-zero.
   # No satellite identity leaked in
   psql "$DBURL" -c "SELECT count(*) FROM location WHERE \"companyId\"='<roboticsCompanyId>' AND city='Houston';"
   # Expected: 0.
   ```

**If seeding throws, report the exact error and the tier it failed in. A `need()` throw means a ref key the dataset did not define; a silently empty table means a name mismatch.**

**Out of scope:** No migration — `robotics_oem` already exists as an `industry` row.

---

## Task 10: Write the `precision` dataset

**Depends on:** Task 9
**Files:**
- Create: `packages/database/src/datasets/data/precision/` — all eleven slices + `index.ts`
- Modify: `packages/database/src/datasets/types.ts`, `packages/database/src/datasets/index.ts` — register `"precision"`
- Create: `.ai/runs/2026-08-13-precision-baseline.txt`

**Steps:**

1. Story: **Meridian Precision Works**, a contract machine shop — CNC milling/turning plus sheet-metal fabrication, customer-supplied prints, short lead times, outside processing (anodize, heat treat) as a first-class routing step. `key: "precision"`, `label: "Precision Manufacturing"`, `industryId: "precision_manufacturing"`.
2. Follow every step, requirement and constraint from Tasks 7–9, substituting this story. All eleven slices, satellite-parity volume, no empty slice.
3. This dataset is **data-only** — the engine already accepts a second dataset by now. If it does not, STOP and report; that means Tasks 3–4 missed a coupling.

**Verify:** same command set as Task 9, with `--dataset precision` and this dataset's company id.

**Out of scope:** No tier edits. No migration.

---

## Task 11: Write the `motor` dataset

**Depends on:** Task 9
**Files:**
- Create: `packages/database/src/datasets/data/motor/` — all eleven slices + `index.ts`
- Modify: `packages/database/src/datasets/types.ts`, `packages/database/src/datasets/index.ts` — register `"motor"`
- Create: `.ai/runs/2026-08-13-motor-baseline.txt`

**Steps:**

1. Story: **Torque Dynamics LLC**, precision motor assemblies — stator / rotor / housing / shaft sub-assemblies, batch-tracked windings and magnets, a tighter inspection regime than the other three. `key: "motor"`, `label: "Motor Assembly"`, `industryId: "automotive_precision"`.
2. Otherwise identical process to Task 10.

**Verify:** same command set as Task 9, with `--dataset motor`.

**Out of scope:** No tier edits. No migration.

---

## Task 12: End-to-end verification across all four datasets

**Depends on:** Tasks 9, 10, 11
**Files:** none (verification only)

**Steps:**

1. Seed all four into **the same database**, each into its own company, and confirm no duplicate-key failure:
   ```bash
   for d in satellite robotics precision motor; do
     pnpm db:seed:dev -- --email "$d-demo@carbon.ms" --dataset "$d" 2>&1 | tail -3
   done
   ```
2. Confirm globally-keyed tables did not collide:
   ```bash
   psql "$DBURL" -c "SELECT count(*) AS links, count(DISTINCT id) AS distinct_ids FROM \"externalLink\";"
   # Expected: links = distinct_ids.
   psql "$DBURL" -c "SELECT count(*) AS weeks, count(DISTINCT \"startDate\") AS distinct_starts FROM period WHERE \"periodType\"='Week';"
   # Expected: weeks = distinct_starts = 48 (the advisory lock prevents duplicates).
   ```
3. Confirm each company's journals balance and each has non-zero `itemLedger`.
4. Confirm every industry now resolves to a dataset:
   ```bash
   psql "$DBURL" -c "SELECT id, name FROM industry ORDER BY \"sortOrder\";"
   # Expected: 4 rows, and datasetForIndustry returns non-null for all four.
   ```
5. Run the full check set:
   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs --filter=erp 2>&1 | tail -6
   # Expected: "Tasks: 3 successful, 3 total"
   pnpm exec biome check packages/database/src/datasets 2>&1 | tail -4
   # Expected: warnings only, "Found 0 errors" (no error-severity diagnostics).
   pnpm --filter @carbon/workflows test 2>&1 | tail -6
   # Expected: all tests pass.
   ```
6. Browser check: open onboarding, confirm all four industry cards appear, and provision one non-satellite company end to end.

**Out of scope:** Do not commit until every check above passes.

---

## Task 13: Refresh the docs

**Depends on:** Task 12
**Files:**
- Modify: `packages/database/src/datasets/AGENTS.md` — four datasets not one; the new `FoundationData` fields; shelves are dataset-declared; drop the "Tier 1 hard-codes satellite specifics" rough edge now that it is fixed
- Modify: `.claude/rules/onboarding-company-templates.md` — the "Adding an industry" section, and the four baseline files
- Modify: `packages/database/AGENTS.md` — mention the four dataset keys
- Move: `.ai/specs/2026-08-13-remaining-industry-datasets.md` → `.ai/specs/implemented/`

**Steps:**

1. Update each file against the code as it now stands — do not describe intent, describe behaviour.
2. In `AGENTS.md`, replace the `binLevels` mention with the explicit `shelves` contract, and state plainly that a shelf name in `openingStock` with no matching `ShelfSpec` is now a hard error.
3. Add a `.ai/lessons.md` entry only if something durable was learned that is not already recorded.

**Verify:**
```bash
grep -rn "binLevels\|Houston" packages/database/src/datasets/AGENTS.md .claude/rules/onboarding-company-templates.md
# Expected: no output.
```

**Out of scope:** Do not rewrite the parts of these docs that describe the onboarding job, the failure marker, or the transaction model — unchanged by this work.

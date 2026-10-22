---
paths:
  - "apps/erp/app/components/ImportCSVModal/**"
  - "apps/erp/app/modules/shared/imports.models.ts"
  - "apps/erp/app/routes/x+/shared+/import.$tableId.tsx"
  - "apps/erp/app/modules/shared/shared.service.ts"
---

# CSV Import System

Bulk-import ERP entities from a user-uploaded CSV. Two-stage UI wizard (upload → map),
a thin route action, and `importCsvTable` (`shared.service.ts`, ported from the `import-csv` server function) that does the actual inserts/updates inside
a transaction. Imports are idempotent via the `externalIntegrationMapping` table.

## Flow

1. **Upload** — `UploadCSV.tsx` parses the file client-side with **PapaParse** and uploads
   it to the company's own bucket (`storage(client).company(companyId)`) at
   `${companyId}/imports/${nanoid()}.csv`.
2. **Map** — `FieldMappings.tsx` lets the user map CSV columns → entity fields, plus per-field
   **enum mappings** (e.g. CSV `"B"` → `"Buy"`) and creatable lookups/forms.
3. **Submit** — form POSTs to `/x/shared/import/$tableId`.
4. **Route action** validates, then calls the `importCsvFile` service function.
5. **`importCsvTable`** downloads the CSV, maps, classifies each row, and writes in a transaction.

## Frontend (`apps/erp/app/components/ImportCSVModal/`)

- `ImportCSVModal.tsx` — modal orchestrating the wizard.
- `UploadCSV.tsx` — drag-drop upload; PapaParse; uploads to the company bucket (see path above).
- `FieldMappings.tsx` — column/enum mapping UI; `enumMatch.ts` does fuzzy enum matching;
  `useCreateLookup.ts` creates missing lookup values inline.
- `useCsvContext.tsx` — shared state (`file`, `filePath`, `fileColumns`, `firstRows`).

Mounted from exactly one place: `apps/erp/app/components/Table/components/TableHeader.tsx`
(the Bulk Import dropdown). A list page opts in by passing `importCSV={[{ table, label }]}`
to `<Table>` — that prop is the whole UI-side registration.

## Models (`apps/erp/app/modules/shared/imports.models.ts`)

Three exported maps, all keyed by table name:

- `fieldMappings` — field definitions per table. A field is:
  ```ts
  {
    label: string;
    required: boolean;
    type: "string" | "boolean" | "number" | "enum";
    default?: string | number;
    enumData?: {
      description?: string;
      fetcher?: (client, companyId) => Promise<...>;   // dynamic options
      creatableLookup?: "supplierType" | "customerType" | "customerStatus";
      creatableForm?: "paymentTerm" | "shippingMethod";
      options?: readonly string[];                      // static options
    };
  }
  ```
- `importPermissions` — table → permission module. The one map: `importCsvFile`'s gate reads it.
- `importSchemas` — `Record<keyof fieldMappings, z.ZodObject>` for per-table validation.

Other exports: `creatableLookups`, and types `CreatableLookup`, `CreatableForm`.

> **Every field in `fieldMappings[table]` must also be declared in `importSchemas[table]`.**
> The route builds `columnMappings` from the zod parse result, and a zod object strips
> keys it does not declare — so a field the wizard offers but the schema omits is mapped
> by the user, submitted, and silently dropped before `importCsvTable` sees it. That is
> what made every CSV-imported item land at revision `"0"` while the wizard marked the
> Revision column required. `apps/erp/app/modules/shared/imports.models.test.ts` asserts
> the invariant per table; add the field to BOTH maps when adding one.

### Tables & permissions

`customer`, `customerContact` → `sales`; `supplier`, `supplierContact` → `purchasing`;
`part`, `material`, `tool`, `fixture`, `consumable`, `service`, `bom`,
`operations`, `partWithMethod`, `materialSubstance`, `materialForm`, `materialFinish`,
`materialGrade`, `materialType`, `materialDimension`, `unitOfMeasure`,
`storageType` → `parts`;
`workCenter`, `process`, `scrapReason` → `production`; `storageUnit`,
`inventoryQuantity`, `batchQuantity`, `serialQuantity` → `inventory`;
`department` → `people`; `itemPostingGroup`, `fixedAsset` → `accounting`.

An import's permission is the one its table's **RLS INSERT policy** requires, not
the one that opens its list page. `importCsvTable` writes through a service-role
Kysely connection that bypasses RLS, so `importPermissions` is the only
authorization on a bulk import — taking it from the page gate would let a user
create rows the database itself would refuse. `itemPostingGroup` is where the two
disagree: its page is parts-gated, its policies are `accounting_*`.

The import's own `table` enum (`importCsvInput`, `shared.service.ts`) accepts: `consumable`,
`customer`, `customerContact`, `fixture`, `material`, `bom`, `operations`,
`partWithMethod`, `part`, `service`, `supplier`, `supplierContact`, `tool`,
`workCenter`, `process`, `storageUnit`, `unitOfMeasure`, `itemPostingGroup`,
`storageType`, `scrapReason`, `department`, `materialSubstance`, `materialForm`,
`materialFinish`, `materialGrade`, `materialType`, `materialDimension`,
`inventoryQuantity`, `batchQuantity`, `serialQuantity`. Note it does
**not** list `fixedAsset` (see Gotchas).

### Service import (rides the item path)

A `service` is an item — `item.type = "Service"` plus a row in `service` keyed by
`readableId` — so it is handled by the SAME case as part/tool/fixture/consumable
rather than a path of its own. Two service-specific rules live in that case:
`itemTrackingType` is forced to `"Non-Inventory"` before validation (a service can
never be shipped, received or stocked, so the wizard offers no Tracking Type
column, and the item validator requires one), and the type-row insert writes the
legacy `serviceType: "External"` instead of `approved: true`. Both mirror
`upsertService` in `items.service.ts`; the wizard's replenishment options are
narrowed to `Buy | Make`, since "Buy and Make" is not a service.

### Storage-unit import (natural-key match + two-pass parent linking)

`storageUnit` imports the fields `id` (Unique ID), `name`, `locationId` (Location,
an enum resolved via the FieldMappings location fetcher), `parentName`,
`storageTypeNames` (comma-separated), and `active`. Because storage unit names are
unique **per location** (`storageUnit_name_locationId_key`), both in-file dedup and
match-existing-to-update key on `(locationId, lower(name))` — NOT `classifyImportRow`'s
name-only dedup. A csv `id` still writes an `externalIntegrationMapping` for id-based
re-import. Updates deliberately never change `locationId` (avoids the "cannot move a
unit with children" interceptor); a unit's location is **immutable via import**, so a row
whose csv id resolves to a unit in a DIFFERENT location than the row states is reported as
a row error (not a silent move), and an id-matched rename onto a name another unit already
owns in that location is likewise reported rather than crashing the batch on
`storageUnit_name_locationId_key`. `storageTypeNames` resolve case-insensitively against
existing company `storageType` rows, **creating** any missing ones (mirrors the creatable
StorageTypes combobox). `parentName` is applied in a **second pass** after all inserts —
individual `UPDATE`s outside the insert transaction — so a parent defined later in the
same file resolves and an unresolved/cyclic/self parent reports a per-row error instead
of rolling back the whole import. The DB same-location / no-cycle interceptors
(`20260417000200`) are the final guard; their exceptions are caught per row.

### Opening-stock imports (additive Positive Adjmt. only)

`inventoryQuantity`, `batchQuantity` and `serialQuantity` load on-hand stock for
items that already exist, one import per `itemTrackingType` (Inventory / Batch /
Serial; Non-Inventory has none). Surfaced from the Inventory → Quantities table
(`InventoryTable.tsx`). Handled by `importStockQuantities` (`shared.service.ts`); the pure
per-row decision is `classifyStockRow` (tested by `shared.classify-stock-row.test.ts`).

- **Columns**: `readableId` (Part Number), `revision` (blank → `"0"`), `locationId`
  (enum via the shared `locationFetcher`, re-checked against the company's locations),
  `storageUnitName` (optional, resolved case-insensitively within the row's location
  like the storageUnit natural key; named-but-missing is a row error, never created),
  `quantity` (Inventory/Batch; must be > 0), `batchNumber` / `serialNumber`,
  `expirationDate` (Batch/Serial; optional ISO `YYYY-MM-DD`), `comment` (itemLedger
  comment). Serial rows have no Quantity: each row is 1 unit.
- **Item resolution**: readableId + revision (method-import key). `item_unique`
  includes `type`, so several items can share the key; `buildStockItemMap` prefers
  the candidate whose tracking type matches the import, else the first by
  `(type, id)`. Wrong tracking type, missing item or missing `itemCost` row → row error.
- **Storage units**: only `active` units resolve, matching
  `getStorageUnitsListForLocation` in the manual adjustment; an inactive name is the
  "not found in this location" row error.
- **Dedup**: Batch/Serial key on `(itemId, readableId)`. A number already on that item
  (any status) or repeated in the file → `skipped`. Same number on different items is
  fine. Inventory rows have **no natural key**: re-importing posts them again.
- **Writes** mirror post-inventory-adjustment's Positive Adjmt.: Batch/Serial rows
  insert a new `trackedEntity` (sourceDocument "Item", `"Inventory Adjustment"`
  attributes stamp with reason "Created via CSV import", Fixed Duration shelf-life
  fallback when no expiry), then every row gets an `itemLedger` row, a `costLedger`
  layer at current item cost and a balanced `journalLine` pair with
  its `journalLineDimension` tags — posting date = company today, `documentType`
  NULL. The whole file shares ONE journal (Provisional before the accounting
  cutover, with no period; Posted after it), created only if
  some row carries value (post-inventory-count pattern). Accounting context is
  resolved before the transaction; the whole file writes in one transaction.
- **Bulk writes, not `bookAdjustment` per row.** `bookAdjustment` costs ~7 round
  trips per movement, which is ~7 rows/second — a 2,000-row file exceeded the
  runtime's wall clock and rolled back. The importer instead plans every row in
  memory and writes one statement per table per 500-row chunk (`INSERT_CHUNK_SIZE`).
  The rows are byte-for-byte what `bookAdjustment` writes because **both call the
  same pure builders** in `shared.service.ts` — `buildItemLedgerRow`,
  `buildCostLedgerRow`, `buildAdjustmentJournalLines`, `buildJournalLineDimensions`,
  `toJournalLineDocumentType` — and the same open-layer query (`loadOpenCostLayers`
  in `shared.service.ts`, which takes a list of item ids and chunks its
  applied-child lookup over the layer ids, since open layers per item are
  unbounded). Do not fork a row shape or an arithmetic step into the importer:
  a column added to a builder must reach both paths at once, which is the whole
  reason the item ledger row is built there too rather than inline.
- **Ids come back keyed, not positional.** Each movement's `itemLedger` id is the
  `documentId` on its cost layer and journal lines, so a reordered `RETURNING`
  would silently attach them to the wrong movement. `itemLedger` returns
  `["id", "entryNumber"]` and each chunk is sorted by that SERIAL; `journalLine`
  returns `["id", "journalLineReference"]` and the pair is grouped by the
  reference the importer generated per movement.
- **The plan itself is pure and tested.** `planStockRows` in
  `shared.service.ts` takes the file's rows plus the item costs and open
  layers and returns, per row, `{ carriesValue, cost, postsJournal }` — the
  per-item grouping, the cost replay, the scatter back onto source rows and the
  journal filter. The transaction body only inserts what it returns.
  `apps/erp/test/database/lib/plan-adjustment.test.ts` covers mixed items, repeated rows for one item,
  valuing against open layers, a zero-cost item (a layer, no journal) and a
  Non-Inventory / zero-quantity row. A row's journal depends only on its cost,
  never on the cutover: `postsJournal = cost !== 0`.
- **Cost layers are replayed, not hoisted.** `bookAdjustment` re-reads the item's
  open layers before every increase, so row n+1 sees the layer row n wrote.
  `planIncreaseUnitCosts` reproduces that in memory from one snapshot per item.
  Standard/Average ignore layers, so their unit cost is constant per item; FIFO/LIFO
  are unchanged by adding a layer at the current weighted average **in exact
  arithmetic** — but the layer is stored at `round(q × u, 5)`, so the average drifts
  by the rounding and the drift is scaled by the next row's quantity (a 1-unit row at
  ⅓ stores 0.33333, and a following 1000-unit row books 333.33, not 333.33333).
  Hoisting one unit cost per item would therefore change what is written. Pinned by
  `apps/erp/test/database/lib/plan-adjustment.test.ts`, which asserts the plan equals booking the rows
  one at a time for all four costing methods.
- No Unique ID column and no `externalIntegrationMapping` writes. Business rules
  (`evaluateLinesForSurface`) that the single-record adjustment route runs are NOT
  evaluated by the import. The journal description is the fixed
  "Inventory Adjustment — CSV import" (no per-row comment), and a zero-cost row
  posts no journal lines.

### Configuration-lookup imports (skip-duplicate, create-only)

`unitOfMeasure`, `itemPostingGroup`, `storageType`, `scrapReason` and `department`
are small company-scoped config tables filled in once during onboarding. They are
handled by `importConfigLookups` (`shared.service.ts`) — one `CONFIGS` entry per table,
one shared walk — with the same **create-only, skip-duplicate** semantics as the
material lookups below: no `externalIntegrationMapping`, no updates, and no
`id` column in the wizard, because none of these carries a natural external id.

Dedup mirrors the DB unique constraints, case- and whitespace-insensitively.
`unitOfMeasure` is the one with TWO of them (`code` and `name`, each unique per
company), so it contributes two keys and a row colliding on either is reported as
skipped rather than swallowed by the `ON CONFLICT DO NOTHING` clause. Every other
table keys on `name` alone.

`department.parentName` resolves in a **second pass** after the inserts commit —
individual `UPDATE`s outside the insert transaction, so a parent defined further
down the same file resolves and an unresolved or self-referencing parent reports
one row error instead of rolling back the batch. Same shape as the storage-unit
parent pass. `CONFIGS[table].parentField` is what gates it; only `department` sets
one, and `config-lookup-import.test.ts` pins that.

### Material-property imports (skip-duplicate, create-only)

The six material-taxonomy lookups (`materialSubstance`, `materialForm`,
`materialFinish`, `materialGrade`, `materialType`, `materialDimension`) are each a
standalone import surfaced from its own config table (`apps/erp/app/modules/items/ui/Material*`).
They are handled by `importMaterialProperties` (`shared.service.ts`, its table map is
`materialPropertyImportCONFIGS`; not the item/customer
paths) with **create-only, skip-duplicate** semantics — no `externalIntegrationMapping`,
no updates. A row matching an existing entry for the company **or** a global system row
(`companyId IS NULL`) is reported as `skipped`; re-importing the same file is a no-op.
Dedup keys mirror the DB unique constraints (case/whitespace-insensitive):
`code` (substance/form), `(materialSubstanceId, name)` (finish/grade),
`(materialFormId, name)` (dimension), and both `(substance, form, code)` and
`(substance, form, name)` (type). Parent substance/shape are referenced **by name**
and resolved to ids by the FieldMappings enum-mapping step (fetchers on
`materialSubstance` / `materialForm`), so parents must already exist — an unresolved
parent is an `errors` row. New rows get a DB-generated `xid()` id.

### Method imports (append to the target version)

`bom`, `operations` and `partWithMethod` are handled by `importMethods`
(`shared.service.ts`). Rows carry a Row Type (`PART`, `BOM`, `BOP`, `STEP`,
`TOOL`, `PARAM`; blank means `BOM` in the `bom` file) and name their parent part
(`parentId` + `parentRevision`). The import groups rows by parent part, validates
each group (`validateGroup`, pure), then writes each part in its own Kysely
transaction (`writeGroup`): a part with any error writes nothing, other parts
continue.

- **Target version** (`pickMethodImportTarget`): a blank Make Method Version
  targets the highest non-archived version that existed before the import; an
  explicit one targets that version, created as a Draft when missing. An
  explicit version must be above 0 with at most 2 decimals
  (`methodVersionIssue`): `makeMethod.version` is `NUMERIC(10, 2)`, so Postgres
  would store 1.555 as 1.56 and a re-run could not find it again.
- **Locks** (`methodImportLock`, which returns the editors' `LockCheck`), the
  same rules as the BOM and BOP editors: the target must be a Draft; a Draft
  owned by a change notice follows the notice's engineering lock; a Production
  revision follows `plmReleaseControl` through `getLockVerdict`. A refusal
  throws `MethodImportRefused` inside the transaction, so a Draft the file
  created for that part is rolled back too. Under release control "warn" the
  import writes, as the editors do, and returns the lock's message in
  `warnings` for each part it wrote rows into; `ImportResultsModal` shows them
  in a warning alert.
- **Append, not fill** (`planMaterialAppend`, `planOperationAppend`): new BOM
  lines are ordered after the highest existing line; a material already on the
  version is skipped. An Op No is the operation's `order`, so it must be a
  number of 0 or more, and Op Nos compare by value (`opKey`: "10", "10.0" and
  "010" are one). An Op No equal to an existing operation's `order` names that
  operation: the BOP row is skipped and STEP / TOOL / PARAM rows attach to it
  (they may reference it with no BOP row). A non-numeric Op No was refused
  because a re-run could not find its operation again and would add it twice. A step with the same name, a tool
  with the same item and a parameter with the same key are skipped. Every skip
  goes to `skipped`, so re-running a file writes nothing.
- **Results count parts, then rows.** `inserted` and `updated` count parts.
  The summary also carries `added` (`MethodRowsAdded`, `modules/shared/types.ts`):
  the BOM lines, operations, steps, tools and parameters written. `importCsvFile`
  returns it (null for every other table), and `ImportResultsModal`
  (`MethodImportCounts`) and the `ImportCSVModal` toast name the parts, then
  the rows. A PART row counts as inserted only when it created the part
  (`xmax = 0` on the item upsert). For a part that exists, the upsert keeps
  the part's fields, so the PART row is listed as skipped and the part counts
  as updated only when its method rows were written.
- **Rows match the editors' rows.** BOM lines copy `methodType` /
  `sourcingType` / `materialMakeMethodId` / `storageUnitIds` from the component
  item, as `upsertMethodMaterial` does, and take the component's unit when the
  file has none. A blank Operation Type takes the process's `processType` and a
  blank description the process's name, as BillOfProcess `onProcessChange`
  fills them. The wizard presets no Default for the BOM Unit of Measure or the
  Operation Type (`fieldMappings` in `imports.models.ts`): an enum Default
  fills every blank and unmapped cell before the import runs, so a preset
  would replace these fallbacks. Step descriptions go through `toTiptapDoc`, as the step form's
  validator does. `customFields` is `{}` on lines and operations, as the
  routes' `setCustomFields` writes it.
  `apps/erp/test/database/method-import-parity.test.ts` builds one method
  through the editors' validators and building blocks and one through the
  import, and compares every column but ids and timestamps.
- **Refusals match the editors' validators** (`methodMaterialValidator`,
  `methodOperationValidator`, `operationStepValidator`,
  `operationToolValidator`): a BOM line must be a Part, Material or Consumable
  and not the part itself, with quantity 0 or more; a TOOL row's item must be a
  Tool, with quantity above 0; times, costs and lead time are 0 or more; a
  Process operation needs setup, labor and machine units, an Assembly operation
  setup and labor; step min and max are 0 or more, max at least min; a List
  step needs one non-blank option; a Make Method Version must be above 0 with
  at most 2 decimals. An Inspection operation is refused, because
  `methodOperationValidator` requires an Inspection Plan and a CSV has no
  column for one. Pinned by `method-import-guards.test.ts`.
- **Concurrency.** `writeGroup` locks the part's `item` row (`FOR NO KEY
  UPDATE`, so rows that reference the item can still be written) before it
  reads the versions, so two imports that create the same new version create
  it once. It then locks the target `makeMethod` row
  (`FOR NO KEY UPDATE`) before it reads the version's lines, so two imports of
  one file write each line once. Not `FOR UPDATE`: that also blocks the
  `KEY SHARE` lock the `materialMakeMethodId` foreign key takes, so every BOM
  line elsewhere pointing at this method would wait for the import. The
  refusals read the status and change notice of the locked row, so a Draft an editor activates or links to a notice
  while the import waits is refused. A version the import created for a
  refused part rolls back with it.
- **Change notice locks are read before any transaction** (`loadChangeNoticeLocks`):
  `getChangeNoticeEngineeringLocks` (`items.service.ts`) reads pending approvals
  for every notice in one service-role request (`pendingApprovalDocumentIds`,
  `@carbon/ee/approvals.server`), which must not run while a part's
  transaction is open. A Draft whose notice was linked after that read is
  refused.
- Known gaps: a sub-assembly created by a `PART` row must come before its parent
  in the file (parts are written in order of first appearance); a `PART` row
  does not write the Unique ID mapping; the Supplier Process column is unused;
  items are looked up by readable id
  and revision only, so a readable id shared by two item types resolves to
  either; the import needs only `update: parts`, while the editors' create
  routes need `create: parts`.

> The models also include `customerStatus` / `customerType` field-mapping entries (used by
> creatable lookups), but only the tables above appear in `importPermissions`.

## Route (`apps/erp/app/routes/x+/shared+/import.$tableId.tsx`)

Action only (no loader). It validates the form (`filePath`, `enumMappings` as JSON;
every other field is a column mapping) and calls `importCsvFile` (`shared.server.ts`)
(`importCsvFile` in `apps/erp/app/modules/shared/shared.server.ts`), which:
1. Refuses a `table` that is not a key of `importPermissions`.
2. Gates on `{ by: "table" }`: `update` on `importPermissions[table]`, plus `create` on
   the same module for tables in `importRequiresCreate` (the three stock imports, matching
   the single-record adjustment's `create: inventory` route gate and `update: inventory`
   Save button).
3. Validates `columnMappings` against `importSchemas[table]` (required fields mapped).
4. Calls `importCsv(ctx, { table, filePath, columnMappings, enumMappings })`
   (quote tables go through `importQuotes` instead).
5. Returns `{ inserted, updated, skipped, errors, added, warnings }` (`added` is null
   and `warnings` empty for all but the method imports); `ImportCSVModal` reads it
   from the result's `data`.

The lookup values an import creates on the fly (`api+/csv+/create-lookup.tsx`) are
`createImportLookups` (`shared.server.ts`), gated on `create` of the lookup's module.

`importCsv` lives in `apps/erp/app/modules/shared/shared.service.ts` and is a thin wrapper:
it calls `invokePosting(ctx, "import-csv", args, importCsvTable)`, so the import runs
under `importCsvFile`'s gate. Step 2 is the only permission check.

## The import (`importCsvTable`, `shared.service.ts`)

Ported from the `import-csv` server function. Its input is `importCsvInput` (table enum,
`filePath`, `columnMappings`, optional `enumMappings`).

- Checks no permission itself: it runs under `importCsvFile`'s gate. A new import type
  adds its table to `importPermissions` and to `importCsvInput`'s `table` enum.
- Refuses a `filePath` outside the `${companyId}/` prefix, then downloads it from the
  company bucket.
- Parses with `parseCsv` (`@carbon/files/csv`, PapaParse), falling back to a custom
  `parsePermissiveCsv()` when a row's field count disagrees with the header.
- Applies `columnMappings`, then `enumMappings` (unknown CSV value → the enum's `"Default"`);
  `"N/A"` / unmapped columns are skipped.
- **Material Finish / Grade / Dimensions arrive as raw text** (`finish`, `grade`,
  `dimensions` — they can't be flat enum mappings because `materialFinish`/`materialGrade`
  are scoped by substance and `materialDimension` by form). `resolveMaterialTaxonomyIds()`
  resolves them per row within the row's substance/form scope — case-insensitive match
  against global (`companyId IS NULL`) + company rows (company wins) — and **creates a
  company-scoped taxonomy row for unmatched names** (mirroring the creatable comboboxes on
  the material form). A row with no substance (finish/grade) or no form (dimensions) leaves
  the attribute unset.
- Classifies each row with `classifyImportRow()` (tested by `shared.classify-import-row.test.ts`):
  returns `{ action: "insert" }`, `{ action: "update"; entityId }`, or
  `{ action: "skip"; reason }`. Skips on missing Name or duplicate id/name within the file.
- Wraps writes per-entity in `db.transaction().execute(...)` (Kysely; bypasses RLS). Persists ID mappings via `upsertCsvMappings`.
- Returns `{ data: { success: true, inserted, updated, skipped, errors } }`; a throw becomes
  `{ error }` (500).

### Idempotency (`externalIntegrationMapping`)

Re-import safety uses the shared `externalIntegrationMapping` table with
`integration = "csv"` (`const EXTERNAL_ID_KEY = "csv"`):

- On import, reads existing mappings for `(entityType, integration="csv", companyId)` to build
  the externalId→entityId map used for update detection.
- Writes mappings on `upsertCsvMappings`, conflicting on
  `(integration, externalId, entityType, companyId)` (when `allowDuplicateExternalId = false`)
  and updating `entityId`. So re-importing the same CSV ids updates rather than duplicates.

See `.claude/rules/accounting-sync-handlers.md` for the full `externalIntegrationMapping` schema.

## Gotchas

- **`fixture` is orphaned** — registered in `fieldMappings`, `importPermissions` and `importCsvInput`'s
  enum, but `Fixture` was dropped from the app's item-type enum
  (`items.models.ts`) and there is no Fixtures list page, so nothing surfaces it.
- **`fixedAsset`** has models/permissions (`fieldMappings`, `importPermissions`) but is
  **confirmed absent** from `importCsvInput`'s `table` enum, so `importCsvTable`
  **rejects it** — the zod `table` enum fails to parse and it errors out (effectively
  "Table not found in the list of supported tables"). fixedAsset CSV import is not wired.
- **Item custom fields are not populated on import** — the item insert paths write
  `customFields: {}` (empty object) rather than mapping any CSV columns into custom fields.
- Client parses CSV with **PapaParse** for the mapping preview; `importCsvTable` re-parses
  the stored file independently (with a permissive fallback) — don't assume identical behavior.
- `enumMappings` crosses the route boundary as a JSON string; the service and `importCsvTable` expect
  the parsed object.
- `importCsvTable`'s transaction uses Kysely and bypasses RLS; authorization is
  `importCsvFile`'s gate alone.
- Row-level failures are returned in `errors[]` with `{ row, reason }`; only a thrown
  exception produces a 500.

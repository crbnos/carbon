---
paths:
  - "apps/erp/app/components/ImportCSVModal/**"
  - "apps/erp/app/modules/shared/imports.models.ts"
  - "apps/erp/app/routes/x+/shared+/import.$tableId.tsx"
  - "packages/database/supabase/functions/import-csv/**"
---

# CSV Import System

Bulk-import ERP entities from a user-uploaded CSV. Two-stage UI wizard (upload → map),
a thin route action, and a Deno edge function that does the actual inserts/updates inside
a transaction. Imports are idempotent via the `externalIntegrationMapping` table.

## Flow

1. **Upload** — `UploadCSV.tsx` parses the file client-side with **PapaParse** and uploads
   it to the `private` Supabase bucket at `${companyId}/imports/${nanoid()}.csv`.
2. **Map** — `FieldMappings.tsx` lets the user map CSV columns → entity fields, plus per-field
   **enum mappings** (e.g. CSV `"B"` → `"Buy"`) and creatable lookups/forms.
3. **Submit** — form POSTs to `/x/shared/import/$tableId`.
4. **Route action** validates, then calls the `importCsv` service.
5. **Edge function** downloads the CSV, maps, classifies each row, and writes in a transaction.

## Frontend (`apps/erp/app/components/ImportCSVModal/`)

- `ImportCSVModal.tsx` — modal orchestrating the wizard.
- `UploadCSV.tsx` — drag-drop upload; PapaParse; uploads to `private` bucket (see path above).
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
- `importPermissions` — table → permission module. Used by the route to gate access.
- `importSchemas` — `Record<keyof fieldMappings, z.ZodObject>` for per-table validation.

Other exports: `creatableLookups`, and types `CreatableLookup`, `CreatableForm`.

> **Every field in `fieldMappings[table]` must also be declared in `importSchemas[table]`.**
> The route builds `columnMappings` from the zod parse result, and a zod object strips
> keys it does not declare — so a field the wizard offers but the schema omits is mapped
> by the user, submitted, and silently dropped before the edge function sees it. That is
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
the one that opens its list page. The edge function writes through a service-role
Kysely connection that bypasses RLS, so `importPermissions` is the only
authorization on a bulk import — taking it from the page gate would let a user
create rows the database itself would refuse. `itemPostingGroup` is where the two
disagree: its page is parts-gated, its policies are `accounting_*`.

The edge function's own `table` enum (`import-csv/index.ts`) accepts: `consumable`,
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
(`InventoryTable.tsx`). Handled by `import-csv/stock-quantity-import.ts`; the pure
per-row decision is `classify-stock-row.ts` (tested by `classify-stock-row.test.ts`).

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
  layer at current item cost and (accounting on) a balanced `journalLine` pair with
  its `journalLineDimension` tags — posting date = company today, `documentType`
  NULL. With accounting enabled the whole file shares ONE journal, created only if
  some row carries value (post-inventory-count pattern). Accounting context is
  resolved before the transaction; the whole file writes in one transaction.
- **Bulk writes, not `bookAdjustment` per row.** `bookAdjustment` costs ~7 round
  trips per movement, which is ~7 rows/second — a 2,000-row file exceeded the edge
  runtime's wall clock and rolled back. The importer instead plans every row in
  memory and writes one statement per table per 500-row chunk (`INSERT_CHUNK_SIZE`).
  The rows are byte-for-byte what `bookAdjustment` writes because **both call the
  same pure builders** in `shared/plan-adjustment.ts` — `buildItemLedgerRow`,
  `buildCostLedgerRow`, `buildAdjustmentJournalLines`, `buildJournalLineDimensions`,
  `toJournalLineDocumentType` — and the same open-layer query (`loadOpenCostLayers`
  in `shared/post-adjustment.ts`, which takes a list of item ids and chunks its
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
  `shared/plan-adjustment.ts` takes the file's rows plus the item costs and open
  layers and returns, per row, `{ carriesValue, cost, postsJournal }` — the
  per-item grouping, the cost replay, the scatter back onto source rows and the
  journal filter. The transaction body only inserts what it returns.
  `shared/plan-adjustment.test.ts` covers mixed items, repeated rows for one item,
  a zero-cost item, accounting disabled and a Non-Inventory / zero-quantity row.
- **Cost layers are replayed, not hoisted.** `bookAdjustment` re-reads the item's
  open layers before every increase, so row n+1 sees the layer row n wrote.
  `planIncreaseUnitCosts` reproduces that in memory from one snapshot per item.
  Standard/Average ignore layers, so their unit cost is constant per item; FIFO/LIFO
  are unchanged by adding a layer at the current weighted average **in exact
  arithmetic** — but the layer is stored at `round(q × u, 5)`, so the average drifts
  by the rounding and the drift is scaled by the next row's quantity (a 1-unit row at
  ⅓ stores 0.33333, and a following 1000-unit row books 333.33, not 333.33333).
  Hoisting one unit cost per item would therefore change what is written. Pinned by
  `shared/plan-adjustment.test.ts`, which asserts the plan equals booking the rows
  one at a time for all four costing methods.
- No Unique ID column and no `externalIntegrationMapping` writes. Business rules
  (`evaluateLinesForSurface`) that the single-record adjustment route runs are NOT
  evaluated by the import. The journal description is the fixed
  "Inventory Adjustment — CSV import" (no per-row comment), and a zero-cost row
  posts no journal lines.

### Configuration-lookup imports (skip-duplicate, create-only)

`unitOfMeasure`, `itemPostingGroup`, `storageType`, `scrapReason` and `department`
are small company-scoped config tables filled in once during onboarding. They are
handled by `import-csv/config-lookup-import.ts` — one `CONFIGS` entry per table,
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
They are handled by `import-csv/material-property-import.ts` (not the item/customer
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

> The models also include `customerStatus` / `customerType` field-mapping entries (used by
> creatable lookups), but only the tables above appear in `importPermissions`.

## Route (`apps/erp/app/routes/x+/shared+/import.$tableId.tsx`)

Action only (no loader). Steps:
1. `notFound` if `tableId` missing or not a key of `importPermissions`.
2. `requirePermissions(request, { update: importPermissions[table] })`, plus `create` on the same module for tables in `importRequiresCreate` (the three stock imports, matching the single-record adjustment's `create: inventory` route gate and `update: inventory` Save button).
3. Validate form against `importSchemas[table].extend({ filePath, enumMappings })`.
   `enumMappings` arrives as a JSON **string** and is `JSON.parse`d before the service call.
4. `columnMappings` = the remaining validated form fields after destructuring `filePath`
   and `enumMappings` (`const { filePath, enumMappings, ...columnMappings } = validation.data`).
5. Call `importCsv(getCarbonServiceRole(), { table, filePath, columnMappings, enumMappings, companyId, userId })`.
6. Return `{ success, inserted, updated, skipped, errors }`.

`importCsv` lives in `apps/erp/app/modules/shared/shared.service.ts` and is a thin wrapper:
`client.functions.invoke("import-csv", { body: args })`. The route does **not** invoke the
edge function directly.

## Edge function (`packages/database/supabase/functions/import-csv/index.ts`)

Deno `serve` handler. Payload validated by `importCsvValidator` (table enum, `filePath`,
`columnMappings`, optional `enumMappings`, `companyId`, `userId`).

- Downloads CSV: `client.storage.from("private").download(filePath)`.
- Parses with Deno std `import { parse } from "https://deno.land/std@0.175.0/encoding/csv.ts"`
  (`skipFirstRow: true, lazyQuotes: true`), falling back to a custom `parsePermissiveCsv()`
  when the strict parser rejects uneven row widths.
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
- Classifies each row with `classifyImportRow()` (see `classify-import-row.ts`):
  returns `{ action: "insert" }`, `{ action: "update"; entityId }`, or
  `{ action: "skip"; reason }`. Skips on missing Name or duplicate id/name within the file.
- Wraps writes per-entity in `db.transaction().execute(...)` (Kysely; bypasses RLS — auth is
  enforced at the route). Persists ID mappings via `upsertCsvMappings`.
- Returns `{ success: true, inserted, updated, skipped, errors }`; on throw, 500 with the error.

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

- **`fixture` is orphaned** — registered in `fieldMappings`, `importPermissions` and the edge
  function's enum, but `Fixture` was dropped from the app's item-type enum
  (`items.models.ts`) and there is no Fixtures list page, so nothing surfaces it.
- **`fixedAsset`** has models/permissions (`fieldMappings`, `importPermissions`) but is
  **confirmed absent** from the edge function's `table` enum, so the edge function
  **rejects it** — the zod `table` enum fails to parse and it errors out (effectively
  "Table not found in the list of supported tables"). fixedAsset CSV import is not wired.
- **Item custom fields are not populated on import** — the item insert paths write
  `customFields: {}` (empty object) rather than mapping any CSV columns into custom fields.
- Client parses CSV with **PapaParse**; the edge function parses independently with Deno std.
  They are separate parsers — don't assume identical behavior.
- `enumMappings` crosses the route boundary as a JSON string; the service/edge function expect
  the parsed object.
- The edge function transaction uses Kysely and bypasses RLS — the route's `requirePermissions`
  is the only authorization gate.
- Row-level failures are returned in `errors[]` with `{ row, reason }`; only a thrown
  exception produces a 500.

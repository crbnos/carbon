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

Used from `apps/erp/app/components/Table/components/TableHeader.tsx` (table import button)
and `apps/erp/app/modules/items/ui/Item/BoMExplorer.tsx`.

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

### Tables & permissions

`customer`, `customerContact` → `sales`; `supplier`, `supplierContact` → `purchasing`;
`part`, `material`, `tool`, `fixture`, `consumable`, `methodMaterial`, `bom`,
`operations`, `partWithMethod`, `materialSubstance`, `materialForm`, `materialFinish`,
`materialGrade`, `materialType`, `materialDimension` → `parts`;
`workCenter`, `process` → `production`; `storageUnit` → `inventory`;
`fixedAsset` → `accounting`.

The edge function's own `table` enum (`import-csv/index.ts`) accepts: `consumable`,
`customer`, `customerContact`, `fixture`, `material`, `bom`, `operations`,
`partWithMethod`, `part`, `supplier`, `supplierContact`, `tool`, `workCenter`,
`process`, `storageUnit`, `materialSubstance`, `materialForm`, `materialFinish`,
`materialGrade`, `materialType`, `materialDimension`. Note it does **not** list
`fixedAsset` or `methodMaterial` (see Gotchas).

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
2. `requirePermissions(request, { update: importPermissions[table] })`.
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

- **`methodMaterial` is not implemented** — its edge-function case `throw new Error("Not implemented")`.
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

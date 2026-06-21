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
`part`, `material`, `tool`, `fixture`, `consumable`, `methodMaterial` → `parts`;
`workCenter`, `process` → `production`; `fixedAsset` → `accounting`.

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
- **`fixedAsset`** has models/permissions but is **NOT** in the edge function's `table` enum,
  so the edge function would reject it. <!-- UNVERIFIED: whether fixedAsset import is wired anywhere -->
- Client parses CSV with **PapaParse**; the edge function parses independently with Deno std.
  They are separate parsers — don't assume identical behavior.
- `enumMappings` crosses the route boundary as a JSON string; the service/edge function expect
  the parsed object.
- The edge function transaction uses Kysely and bypasses RLS — the route's `requirePermissions`
  is the only authorization gate.
- Row-level failures are returned in `errors[]` with `{ row, reason }`; only a thrown
  exception produces a 500.

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
- `FieldMappings.tsx` — column/enum mapping UI; `enumMatch.ts` matches enum values exactly
  after lower-casing/trimming against each option's label and `aliases` (not fuzzy);
  `useCreateLookup.ts` creates missing lookup values inline.
- `reviewSteps.ts` — per-table review steps rendered after the enum steps and inside the
  import form (`account` → `ChartOfAccountsReview.tsx`); any hidden input a step renders
  (e.g. `options`) travels with the final submit.
- `useCsvContext.tsx` — shared state (`file`, `filePath`, `fileColumns`, `firstRows`).

Column matching runs in this order per field, first hit wins and a header is never
claimed twice: `preferredAliases` (a finer column that should beat the label, e.g.
QuickBooks "Detail type" over "Type"), the label, the field name, then `aliases`. Headers
are lower-cased, trimmed and stripped of a leading `*` (Xero templates). Exact/alias
matches survive the LLM pass — the model only fills fields left unmatched.

Mounted from `apps/erp/app/components/Table/components/TableHeader.tsx` (the Bulk Import
dropdown; a list page opts in by passing `importCSV={[{ table, label }]}` to `<Table>`) and
from the Chart of Accounts toolbar (`ChartOfAccountsTableFilters.tsx` → `charts.tsx`), which
is a tree, not a `<Table>`. `ImportCSVModal` takes only `{ table, onClose }`, so any page can
mount it.

## Models (`apps/erp/app/modules/shared/imports.models.ts`)

Three exported maps, all keyed by table name:

- `fieldMappings` — field definitions per table. A field is:
  ```ts
  {
    label: string;
    required: boolean;
    type: "string" | "boolean" | "number" | "enum";
    default?: string | number;
    aliases?: string[];            // other systems' header names for this column
    preferredAliases?: string[];   // headers that beat the label when both are present
    enumData?: {
      description?: string;
      fetcher?: (client, companyId) => Promise<...>;   // dynamic options
      creatableLookup?: "supplierType" | "customerType" | "customerStatus";
      creatableForm?: "paymentTerm" | "shippingMethod";
      options?: readonly string[];                      // static options
      optionAliases?: Record<string, string[]>;         // other systems' names per option
      skipStepWhenUnmapped?: boolean;                   // no wizard step if the column is unmapped
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
`part`, `material`, `tool`, `fixture`, `consumable`, `bom`,
`operations`, `partWithMethod`, `materialSubstance`, `materialForm`, `materialFinish`,
`materialGrade`, `materialType`, `materialDimension` → `parts`;
`workCenter`, `process` → `production`; `storageUnit` → `inventory`;
`fixedAsset`, `account` → `accounting`.

The edge function's own `table` enum (`import-csv/index.ts`) accepts: `consumable`,
`customer`, `customerContact`, `fixture`, `material`, `bom`, `operations`,
`partWithMethod`, `part`, `supplier`, `supplierContact`, `tool`, `workCenter`,
`process`, `storageUnit`, `materialSubstance`, `materialForm`, `materialFinish`,
`materialGrade`, `materialType`, `materialDimension`, `account`. Note it does **not** list
`fixedAsset` (see Gotchas).

### Chart-of-accounts import (planner + review step)

`account` is the only import whose target is a tree scoped by `companyGroupId`. It is
handled by a pure planner (`import-csv/account-import.ts`, unit-tested with `deno test`)
plus a writer (`account-import-writer.ts`), and the wizard gains a review step
(`ChartOfAccountsReview.tsx`) that runs the same edge function with `dryRun: true` and
renders the returned `plan` before the real submit. Spec:
`.ai/specs/2026-09-04-chart-of-accounts-import.md`.

- **Scope / auth.** The edge function resolves `companyGroupId` from `company` and
  throws unless `company.parentCompanyId IS NULL` (RLS only lets a root company write the
  chart; the Kysely path bypasses RLS). The toolbar button is gated the same way.
- **Fields.** `number`, `name` (required), `accountType` (required enum, aliases for the
  QuickBooks / Xero / NetSuite / Sage / Business Central / Odoo / Rillet vocabularies),
  `class` (optional enum, derived from the type when absent), `parent`, `isGroup`,
  `rowKind` (Account / Group / Total / Heading / Ignore, for Begin-Total / End-Total
  exports), `indent`, `active` (inverted when the mapped header is Inactive / Hidden /
  Deprecated / Blocked / Archived), `externalId`. `incomeBalance` and `consolidatedRate`
  are derived from the class, never mapped.
- **Structure** (`options.structure`: `auto` | `file` | `carbon`). `file` builds the tree
  from, in priority order, Row Kind (a stack of open groups), the Parent column (number,
  `number name`, group name in the file or in Carbon, else a synthesized group named by the
  label), or a path in the name split on `options.pathSeparator` (`:`). A row referenced
  as a parent is promoted to a group. `carbon` ignores file groups and places each leaf
  under the shallowest active Carbon group with the same `accountType`, else the class
  group (Expense prefers the group typed like the leaf, then Operating Expenses), else the
  system root for its `incomeBalance`. A top-level file group named like a Carbon group of
  the same class links to it instead of creating one.
- **Identity**, in order: a `link` resolution, `externalId` via the csv mapping, `number`
  for leaves, `(name, isGroup)` for groups and numberless leaves. A number match updates
  (rename allowed); a name held by another account of the same kind is a conflict with a
  `PlanConflict` the review turns into skip / rename / renumber / "same as existing".
- **Refusals**, per row, never a 500: system roots (adopted as parents only), class change
  or deactivation on an account with journal lines, deactivation of an
  `accountDefault` / `fixedAssetClass` account, class disagreeing with the parent, a
  parent that is not a group, cycles, in-file duplicates. Uniques are pre-checked so the
  single transaction does not trip `account_number_key` / `account_name_key`.
- **Write.** One transaction, nodes in plan order (parents first, ids generated up front),
  then `upsertCsvMappings` for rows with a Source ID. Nothing is ever deleted.
- **Payload additions** (all importers): `dryRun?: boolean` and
  `options?: Record<string, unknown>` on `importCsvValidator`, the `importCsv` service and
  the route (`dryRun` / `options` form fields, `options` as a JSON string); the route
  returns `plan` when the edge function does.

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
- The wizard's modal widens (`xxlarge`) while a review step is showing; the wrapper div in
  `ImportCSVModal.tsx` carries `min-w-0` so a wide table scrolls inside the modal instead
  of pushing past it.

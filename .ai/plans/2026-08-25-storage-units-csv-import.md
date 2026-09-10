# Storage Units CSV Import

Add a CSV import tool for Storage Units (requested by Heaviside), mirroring the
existing `workCenter` import path, plus two sample CSVs (perfect + mixed edge cases).

## Key schema facts
- `storageUnit` cols: `id` (default), `name` (req), `locationId` (req, FK location),
  `parentId` (nullable self-FK), `storageTypeIds TEXT[]`, `workCenterId`, `active`,
  audit. UNIQUE `("name","locationId")` → names unique **per location**.
- DB interceptors enforce: parent same-location, no locationId change with children,
  no parent cycles (raise → abort). So resolve parents within same location and set
  parent as a resilient second pass.
- `storageType`: `id`, `name`, `companyId`, audit. No unique-name constraint.
- Storage-unit create/update route permission = `inventory`.

## Fields imported
`id` (Unique ID, req), `name` (req), `locationId` (Location, req, enum+fetcher),
`parentName` (optional, resolved by name within location), `storageTypeNames`
(optional, comma-separated, resolved/created), `active` (optional boolean).

## Changes
1. `apps/erp/app/modules/shared/imports.models.ts` — add `storageUnit` to
   `fieldMappings`, `importPermissions` (→ `inventory`), `importSchemas`.
2. `packages/database/supabase/functions/import-csv/index.ts` — add `storageUnit`
   to the `table` enum, `CsvEntityType`, `fetchLiveEntityIds`, and a `case
   "storageUnit"` handler:
   - match/dedup by `(locationId, lower(name))` natural key + csv external id;
   - resolve/create storage types by name;
   - insert/update inside one txn, then a second pass sets `parentId` (per-row
     try/catch, row errors instead of a full rollback).
3. `apps/erp/app/modules/inventory/ui/StorageUnits/StorageUnitsTable.tsx` — add
   `importCSV={[{ table: "storageUnit", label: "Storage Units" }]}`.
4. Docs sync: `.claude/rules/csv-import-system.md`, inventory `AGENTS.md`.
5. Deliverables: `storage-units-perfect.csv`, `storage-units-mixed.csv`.

## Verify
- `pnpm exec turbo run typecheck --filter=erp`
- Deno check of the edge function file.
- Biome lint on changed files.

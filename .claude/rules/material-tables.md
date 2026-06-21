---
paths:
  - "packages/database/supabase/migrations/*material*.sql"
  - "apps/erp/app/modules/items/items.service.ts"
  - "apps/erp/app/modules/items/items.models.ts"
---

# Material Tables Schema

Carbon's material taxonomy: a `material` row carries the structured properties (form,
substance, dimension, finish, grade, type) for a material **item**. Spread across several
timestamped migrations — **newest wins**; the generated types
(`packages/database/src/types.ts`) are the source of truth for current columns.

Key migrations (in order): `20240608114413_materials.sql` (original `material`/`materialForm`/
`materialSubstance`), `20250719100358_material-seed.sql` (adds `materialFinish`, `materialGrade`,
`materialType`, `materialDimension` + `code` cols + system seed data),
`20250721100955` / `20250721101110` (the big shape change: text→FK id columns),
`20250519122022_revisions.sql` (drops `material.itemId`), `20251122152701_materials-view-fix.sql`
(newest `materials` view), `20260208020701` (adds `ingot` form).

## `material` table (current columns)

Composite PK `("id", "companyId")`. Columns (per generated types):
`id`, `companyId`, `materialFormId`, `materialSubstanceId`, `dimensionId`, `finishId`,
`gradeId`, `materialTypeId` (all the `*Id` cols nullable, each an FK to its taxonomy table),
`approved` BOOLEAN, `approvedBy`, `customFields` JSONB, `tags` TEXT[], plus audit
(`createdBy/At`, `updatedBy/At`).

- **There is no `itemId` column** — dropped in `20250519122022_revisions.sql` (same change hit
  `part`/`tool`/`consumable`). Linkage is now positional: `material.id == item.readableId`
  (per company). See "Item linkage" below.
- **There are no `dimensions` / `finish` / `grade` TEXT columns** — those were dropped in
  `20250721101110_material-drop-text-columns.sql` and replaced by the `dimensionId` / `finishId` /
  `gradeId` FKs (added `20250721100955`). `materialTypeId` was added in the same drop migration.

## Taxonomy tables

These are **global-or-company** lookups: `companyId` is **nullable**; rows with `companyId = NULL`
are system-wide (seeded by `system`) and visible to all companies, company rows override per-company.
RLS lets authenticated users read global rows and employees read their company's rows.

| Table | Key cols | Scoped to | Uniqueness |
|---|---|---|---|
| `materialForm` | `id`, `name`, `code`, `companyId` | — (shapes: sheet, plate, roundbar, ingot…) | `(code, companyId)` |
| `materialSubstance` | `id`, `name`, `code`, `companyId` | — (steel, aluminum, stainless…) | `(code, companyId)` |
| `materialDimension` | `id`, `name`, `materialFormId`, `isMetric`, `companyId` | a **form** | `(materialFormId, name, companyId)` |
| `materialFinish` | `id`, `name`, `materialSubstanceId`, `companyId` | a **substance** | `(materialSubstanceId, name, companyId)` |
| `materialGrade` | `id`, `name`, `materialSubstanceId`, `companyId` | a **substance** | `(materialSubstanceId, name, companyId)` |
| `materialType` | `id`, `name`, `code`, `materialSubstanceId`, `materialFormId`, `companyId` | substance **+** form | `(substance,form,code,company)` and `(substance,form,name,company)` |

- `materialDimension` / `materialFinish` / `materialGrade` / `materialType` have **no audit
  columns and no `customFields`** (only `materialForm`/`materialSubstance` do). Their seed ids are
  human-readable (e.g. `steel-1018`, `sheet-1-16`, `mill-ti`), not `xid()`.
- `materialType` is keyed by **both** a form and a substance (e.g. Hot Rolled steel plate).

## Views (all `SECURITY_INVOKER=true`)

- **`materials`** (newest: `20251122152701_materials-view-fix.sql`) — the list/detail view. Joins
  `material m` to `item i` on `i."readableId" = m."id" AND i."companyId" = m."companyId"`, resolves
  the `*Id` FKs to display names (`materialForm`, `materialSubstance`, `dimensions`, `finish`,
  `grade`, `materialType`), aggregates `supplierPart` ids, and rolls up item `revisions`.
- `materialDimensions` → joins `materialForm`, exposes `formName` (+ `isMetric`).
- `materialFinishes` / `materialGrades` → join `materialSubstance`, expose `substanceName`.
- `materialTypes` → joins both, exposes `substanceName` + `formName`.

## Item linkage (important)

A material is an `item` of `type = 'Material'`. `material.id` is set to the item's `readableId`,
**not** the item's `id`. Creating a material inserts the `item` row(s) first then the `material` row
with the shared id — see `upsertMaterial` in
`apps/erp/app/modules/items/items.service.ts` (`readableId: material.id`, then
`client.from("material").upsert({ id: material.id, ... })`). Because the join is on `readableId`,
one material can have multiple item **revisions** (and per-size item rows); the `materials` view
de-dupes to the latest item per `(readableId, companyId)` and aggregates the revisions.

`getMaterial` calls the **`get_material_details(item_id)`** RPC (defined/revised in the
`20250721101110` and `20250725140205_material-details.sql` migrations). There is also
`get_material_naming_details(readable_id)` (builds the readable name/code from the taxonomy).

## Code map

- Service: `apps/erp/app/modules/items/items.service.ts` — `getMaterial`, `getMaterials`
  (queries `materials` view), `upsertMaterial`, and full CRUD for each taxonomy table
  (`get/upsert/deleteMaterialForm|Substance|Dimension|Finish|Grade|Type`, plus `*List` helpers
  that feed the cascading selects).
- Validator: `materialValidator` in `apps/erp/app/modules/items/items.models.ts` — merges
  `itemValidator` with `{ id, materialSubstanceId?, materialFormId?, materialTypeId?, finishId?,
  gradeId?, dimensionId?, sizes? }`.

## Gotchas

- **Newest migration wins.** The shape changed twice after creation: text props → `*Id` FKs
  (`20250721*`), and `itemId` dropped (`20250519122022`). Don't trust the seed migration alone.
- **`material.id` = item `readableId`**, not item `id`; there is no `itemId` FK. Join via
  `readableId` + `companyId`.
- Property/type/dimension lookups are **global (`companyId IS NULL`) or company-scoped** — filter
  accordingly; don't assume every row is company-owned.
- `20250809000000_add-material-configurator-type.sql` adds `'material'` to the
  `configurationParameterDataType` enum (configurator can reference a material) — unrelated to the
  taxonomy tables.

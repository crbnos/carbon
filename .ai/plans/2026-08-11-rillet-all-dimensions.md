# Rillet: send ALL journal/bill dimensions (auto-provision Fields)

**Goal.** Stop gating Rillet dimension sync on configured "slots". For journal
entries AND bills, send every dimension on every line, auto-provisioning the
Rillet **Field** (not just the field value) as needed. Xero/QBO keep the slot
system (they have real 2-slot caps). Rillet has no field cap.

## Current cap (why dimensions drop)
- `mapJournalEntryToRilletJournalEntry` / `mapBillToRilletBill` loop over
  `settings.dimensionSlots`, not `line.dimensions` — un-slotted dims are silently
  dropped; empty slots → zero dims sent.
- Carbon can auto-create Field **values** (`POST /fields/{id}/values`) but has no
  **Field** creation, so a dim only syncs if pre-mapped to a pre-existing Field.

## Design (Rillet only)
1. **Provider** (`rillet/provider.ts`): add `createField(name, area)` →
   `POST /fields { name, settings: { [area]: { mandatory:false, display:"STANDALONE" } } }`.
   VERIFY: payload inferred from the documented `GET /fields` shape; confirm on sandbox.
2. **Core mapping CRUD** (`core/dimension-mapping.ts`), mirroring the value ones,
   `entityType:"dimension"`: `getDimensionMappings`, `buildDimensionFieldLookup`,
   `upsertDimensionMapping`, plus `loadDimensionNames(db,{companyId,dimensionIds})`
   (dimension table is companyGroupId-scoped → resolve via `getCompanyGroupId`).
3. **Rillet syncer** (`rillet/entities/shared.ts`): new `resolveLineDimensions(lines)`
   → `{ fieldIdByDimensionId, fieldValueIdsByValue }`. Loads persistent field+value
   mappings (cached per drain); for unmapped dims: load names, reuse existing Rillet
   Field by name else `createField(name,"EXPENSES")`, persist; for unmapped values:
   resolve readable label, `upsertFieldValue`, persist. Mutates the cached maps.
   Replaces `ensureAutoCreatedDimensionValues` (slot-keyed) for Rillet.
4. **Mappers** (`journal-entry.ts`, `bill.ts`): `dimensions` arg becomes
   `{ fieldIdByDimensionId, fieldValueIdsByValue }`; iterate `line.dimensions`,
   attach `{field_id, field_value_id}` when both resolve, else drop (label-failure).
5. **mapToRemote** (both): call `resolveLineDimensions(lines)` unconditionally; drop
   the slot-gated block + bill's `collectUnmappedDimensionValues` block. Preflight is
   unchanged — its slot-based dimension check no-ops when no slots are configured.

## Not in scope (follow-up)
- Removing the Dimensions-tab slot editor for Rillet (leave it; it's now dead config
  for Rillet, still used by Xero/QBO).

## Verify
- Unit-test both mappers (iterate line.dimensions; drop unresolved) + `resolveLineDimensions`
  with a mocked provider/db (asserts createField called for unmapped dims, upsertFieldValue
  for unmapped values, persists both).
- `@carbon/ee` typecheck + test. The live `POST /fields` is sandbox-gated (flagged).

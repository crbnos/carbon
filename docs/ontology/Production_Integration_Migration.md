# Production Integration Migration Notes (v1)

## Current status

- Runtime persistence for explicit cross-system lineage is **not implemented** in this branch.
- Existing production schema (`public.job`) lacks dedicated fields for:
  - ERP source system/object/record identity
  - planning release ID
  - stable execution lineage metadata

## Recommended minimal migration (future)

1. Add nullable, backward-compatible columns on `public.job`:
   - `releaseId`
   - `releaseSourceSystem`
   - `releaseSourceObjectType`
   - `releaseSourceRecordId`
   - `lineageReleaseVersion`
2. Add constraints/indexes to enforce idempotency on repeated release handling.
3. Keep all legacy rows readable as unlinked projection until row includes lineage proof.

## Safety checks before enabling

- no destructive backfill for historical jobs
- duplicate suppression by `releaseId`
- preserve existing MES workflow behavior
- rollback plan for failed release inserts

## Current decision

For this branch: **HOLD** for migration execution. Contract and validation are implemented in `@carbon/utils`, but insertion persistence is not yet safely wired end-to-end.

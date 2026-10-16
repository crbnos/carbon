# Plan: strict backflush self-review fixes

- Date: 2026-10-16
- Spec: `.ai/specs/2026-10-14-strict-backflush.md`
- Source: the self-review of PR #1931 (branch `naveenkash/strict-backflush`), after commit `bdb26a1ab5`.
- Rule: no commit and no push until the user asks.

## Decisions

| # | Decision | Reason |
|---|----------|--------|
| D1 | The Pull From of a picked line is the source bin of its EARLIEST pick line whose destination is the line's current bin. If there is no such pick line, the Pull From is `jobMaterial.storageUnitId`. | A pick moves `jobMaterial.storageUnitId` to lineside. The pick line keeps the source, and `restoreJobMaterialSource` already treats it as the warehouse source. A later picking list takes the fullest bin, so the earliest line is the one that names the Pull From. No schema change on `jobMaterial`. |
| D2 | In SQL job completion, a picked line draws from its lineside bin first, up to its on-hand. The remainder comes from the Pull From under the strict rules. | The TypeScript path already draws picks first. The SQL path must give the same answer. |
| D3 | A short bin no longer skips its ledger row in SQL. The function raises after the loop, so the row rolls back. | Later materials on the same bin then see the refused need, and one refusal names every shortfall. |
| D4 | Both paths lock every (bin, item) key in one sorted pass before the first draw, through one SQL function. | Two completions then take locks in the same order and cannot deadlock. |
| D5 | Strict backflush applies only at a location that `getPullFromLocations` returns (an active work center and an active storage unit). | Activation exempts the other locations. Without this, a job there can never complete. |
| D6 | The dry run stops right after the strict check, before any ledger, cost or journal row. | It answers the only question it asks, and it no longer holds the journal sequence lock. |
| D7 | The jobs drawer lists only lines a backflush would refuse: stocked, not batch or serial, quantity still to issue. | The card says the next backflush will be refused. A batch or serial line, or a fully issued line, never is. |
| D8 | The card counts come from SQL counts. The drawers keep the full lists. | The parent loader re-runs on every drawer search, sort and page. |
| D9 | The materials popover follows `conventions-ui.md` "Popovers inside Drawers / Dialogs", not `modal`. | The rule is written for exactly this case and adds a visible scrollbar. |

## Tasks

### A. Picks and the Pull From (Must fix 1)
- [x] A1. Add `resolvePullFromStorageUnit` to `packages/server-functions/src/lib/strict-backflush.ts` (D1).
- [x] A2. Use it in `issueJobOperationMaterials` and in `partToOperation`.
- [x] A3. In the migration, apply D1 and D2 to `backflush_job_materials`.
- [x] A4. Add live-database tests: a partial pick at operation completion and at job completion.

### B. Locks, rounding, refused needs (risks)
- [x] B1. Add `lock_strict_backflush_bins(p_company_id, p_keys)` to the migration. Use it from SQL and TypeScript (D4).
- [x] B2. Compare and format quantities with `round(…, 5)` in SQL.
- [x] B3. Apply D3 in SQL.
- [x] B4. Scope the SQL `item` join and the storage unit name read by `companyId`.
- [x] B5. Make the missing-bin message the same in SQL and TypeScript.

### C. Exempt locations (D5)
- [x] C1. Strict applies only at a pull-from location, in TypeScript and SQL.

### D. Dry run and messages
- [x] D1. Stop the dry run after the strict check (D6).
- [x] D2. Run the inspection disposition dry run before the lot closes. Add a dry run before the scrap insert.
- [x] D3. After a production quantity is recorded, prefix a failed issue with "Units recorded, but".
- [x] D4. MES serial completion: print the label only after the server accepts.
- [x] D5. Batch phase 2: keep the refusal's 409.

### E. Activation and release gates
- [x] E1. Gate the activation in `upsertMakeMethodVersion` callers.
- [x] E2. Run the release check on every move to Ready from Draft or Planned.

### F. Settings card and drawers
- [x] F1. SQL counts for the card (D8).
- [x] F2. Jobs list semantics (D7). Use `activeJobStatuses`.
- [x] F3. A failed read shows an error, not an empty or missing row.
- [x] F4. Drawer search covers Locations and Status.
- [x] F5. Popover per D9. Fix the production `AGENTS.md` line.
- [x] F6. Minor: dead `?? true`, deep import.

### G. UI
- [x] G1. The BoM badge uses the pull-from locations from the loader, collapsed and expanded.
- [x] G2. The badge follows the item after the line's item changes.
- [x] G3. The Release dialog fails closed on a read error.
- [x] G4. Translation gaps: `BatchReleaseModal` list text, "WIP", "Default Storage Unit".

### H. Tests and docs
- [x] H1. Pure tests: `pageInMemory`, lock-key ordering.
- [x] H2. Docs: `packages/database/AGENTS.md`, `packages/server-functions/AGENTS.md`, settings and production `AGENTS.md`, `.ai/lessons.md`, the spec.
- [x] H3. Gates: Biome, typecheck (database, server-functions, erp, mes), tests, translations.

## Notes

- E1: the change-notice draft (`createChangeNoticeDraftMethod`) still freezes a Draft base as Active without the check. The freeze is a side effect of opening the notice. Release still refuses the jobs. The spec's production `AGENTS.md` section records this.
- A4: the live-database tests are written, not run. They create and delete a scratch company, and the user asks before any database write.
- Not done, by choice: one `issue` call that records production and issues materials in one transaction. It would remove the dry run and its race, but it changes 4 callers. The "Units completed, but" message covers the race for now.
- Not done, by choice: activation checks that a Pull From is set, not that its bin is active or at the right location.
- The glossary check flags 2 Hindi strings for the plural "भंडारण इकाइयाँ". The catalog's own "Storage Units" uses the same form and is flagged the same way: the checker does not know the Hindi plural.

---
paths: []
triggers: []
promoted: null
---
# A value two layers must agree on lives once, in the client-safe pure module

**Context:** The accounting enable wizard (ERP) and `activateAccounting` (`accounting.service.ts`, ported from the `activate-accounting` server function) both decide whether Migration Clearing totals zero. The wizard uses the answer to offer "Enable accounting". The server function uses it to refuse the enable. The wizard steps also pass the cutover date to each other in a search param.

**Problem:** Until 2026-10-09 each layer kept its own copy. `MigrationClearingTable.tsx` defined `MIGRATION_CLEARING_TOLERANCE = 0.01` and `isMigrationClearingZero`. `activate-accounting/index.ts` defined a second `MIGRATION_CLEARING_TOLERANCE`. `accounting.server.ts` defined `ACTIVATION_CUTOVER_PARAM`. The copies matched, but nothing kept them matched. If one copy changes, the wizard offers an enable that the server refuses, or hides one that the server accepts. Typecheck cannot see a drift between two literals.

**Rule:** Put a value that two layers must agree on in one place: the client-safe pure module that both layers already import. Export the predicate, not only the number, so every caller compares the same way. The accounting cutover keeps `MIGRATION_CLEARING_TOLERANCE`, `isMigrationClearingZero`, `MIGRATION_CLEARING_ACCOUNT_CLASS` and `ACTIVATION_CUTOVER_PARAM` in `@carbon/database/accounting-cutover` (commits 38602af774, b9f897608c, f1fe2b6c81). That module reads no database, so the browser can import it.

**Applies to:** `packages/database/src/accounting-cutover.ts`; `apps/erp/app/modules/accounting/ui/Activation/MigrationClearingTable.tsx`; `apps/erp/app/routes/x+/accounting+/activation.enable.tsx`; `apps/erp/app/modules/accounting/accounting.service.ts`; any check that a wizard previews and a posting enforces.

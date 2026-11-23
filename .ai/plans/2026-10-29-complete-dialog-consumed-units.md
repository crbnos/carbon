# Job Complete dialog: offer serial units issued before receipt

Branch `fix/complete-dialog-consumed-units`. Bug fix, no schema change.

## Problem

A finished serial unit can be issued into another job (or shipped) before its
own job is received to inventory. The unit is then `Consumed` and has a negative
`itemLedger` row. Since `20261014171619_receive-consumed-serial-units.sql`,
`complete_job_to_inventory` still receives such a unit, and takes it first,
with the shop-floor-finished (`Available`) units.

The ERP job Complete dialog (`JobCompleteModal`, `ui/Jobs/JobHeader.tsx`, logic in
`ui/Jobs/job-complete-logic.ts`) never offers a `Consumed` unit. It cannot tell an
issued unit from one that never left stock. RLS hides `itemLedger` from
production users. The receipts snapshot the dialog reads
(`getJobReceiptSnapshot`, `api+/production.job.$jobId.receipts.ts`) carries only
the units the job already received.

Example: a serial job of 3 units, SN-001 finished and then issued into a parent
job, SN-002 and SN-003 not started.

- The dialog lists "SN-002, SN-003" and caps Quantity Completed at 2 (default 2).
- The database receives SN-001 and SN-002 for a quantity of 2, marks the job
  Completed and leaves SN-003 unreceived.
- The user cannot enter 3, which the database would accept.
- With unnumbered units (mode `numberOnReceipt`) the cap is short by the issued
  units in the same way. With the quantity locked (item without a serial
  sequence) the locked quantity leaves out the issued units too.

## Change

1. `getJobReceiptSnapshot` (`production.service.ts`) also returns
   `issuedTrackedEntityIds`: the job's top-level make method units that are
   `Consumed` and have a negative `itemLedger` row, the rule
   `complete_job_to_inventory` uses. One statement with the rest of the snapshot.
   The receipts route passes it on; the `@mcp read` tool's response gains it.
2. `job-complete-logic.ts`:
   - `isUnreceived` takes the issued ids: a `Consumed` unit is receivable only when
     it was booked out of stock; a received unit never is.
   - An issued unit ranks with the `Available` units, as the SQL `ORDER BY` does,
     so the listed serials are the ones the database takes.
   - `getFinishedUnreceivedQuantity` counts issued units as finished (the default
     quantity).
   - New `getFinishedQuantity`: the locked dialog's cumulative quantity, every
     finished unit including issued ones.
3. `JobHeader.tsx` passes the issued ids for a serial job, never for a batch job
   or a completion to a fixed asset (that branch of the SQL takes no `Consumed`
   unit).
4. Tests: pure cases in `apps/erp/test/job-complete-logic.test.ts`; a database
   test (`apps/erp/test/database/job-receipt-snapshot.test.ts`) that reads the
   snapshot, builds the dialog's choice and completes with it.
5. `modules/production/AGENTS.md`: the snapshot and the dialog rule.

## Verification

- [x] Pure tests red on the old logic, green on the new.
- [x] `pnpm exec turbo run typecheck --filter=erp`
- [x] Biome on the changed files
- [x] Database test on a local stack (red on the old snapshot, green on the new)
- [x] `check:manifest` with the regenerated digest committed

## Out of scope

- Numbering timing: unchanged.
- The Make to Asset branch never takes a `Consumed` unit; unchanged.

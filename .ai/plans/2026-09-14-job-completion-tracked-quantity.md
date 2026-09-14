# Job completion: received quantity must equal completed quantity

Branch `fix/job-completion-tracked-quantity`. Bug fix, no schema change.

## Problem

Completing a job whose made item is serial-tracked, from the ERP, when no unit was
finished on the shop floor app:

- `JobCompleteModal` (`apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx`) locks
  Quantity Completed to the sum of `Available` job serials. None are `Available`, so it
  submits 0.
- `complete_job_to_inventory` (newest body: `20260805023439_company-timezone-sql-functions.sql`)
  receives one unit per unconsumed, unrejected job serial regardless of the quantity passed,
  and flips them all `Available`.
- `backflush_job_materials` prorates by `quantity / job.quantity`, so 0 consumes nothing.

Result: the finished unit is in stock, its materials never leave stock, `job.quantityComplete`
is 0. Completing again receives the same serial a second time.

The lock dates from 2025-03-12 (`bce810a17`), when job serials were one unnumbered placeholder
and got an identity only when finished on the shop floor app. Per-item serial sequences now
split and number job serials at creation (`assign-serial-numbers`), so the units exist before
any shop floor activity. The receipt code still carries the original author's TODO about which
units go into inventory.

Reproduced locally (rolled back) on the seeded serial job J000002: completing at 0 received
serial J000002-01 and issued 0 of 30 materials; completing at 1 twice received it twice.

## Change

1. **Receipt receives exactly the completed quantity (SQL, new migration).**
   Recreate `complete_job_to_inventory` verbatim from the newest body; change only the serial
   branch:
   - receivable units = job make-method serials not `Consumed`/`Rejected` and with no existing
     `Assembly Output` / `Job Receipt` ledger row for this job;
   - receive `p_quantity_complete - prior received` of them, ordering `Available` first (finished
     on the shop floor app), then by `readableId`, then `createdAt`;
   - flip only the received units to `Available`;
   - never receive the same unit twice, so re-completion is safe;
   - lock the job row first, so concurrent completions cannot compute the same delta;
   - refuse when fewer single-unit serials are left than the units being completed, and
     when the cumulative quantity would drop below what was already received.
   The auto-complete path (`sync_finish_job_operation`) calls the same function and is fixed
   with it.
2. **Refuse completion at quantity ≤ 0** in `complete_job_to_inventory` (and therefore every
   caller: ERP route, MCP tool, auto-complete) except Non-Inventory items, which keep current
   behavior. The fully-scrapped auto-complete branch never calls the function and is untouched.
3. **Dialog.** For a serial job whose serials are already split into quantity-1 units, unlock
   Quantity Completed. The quantity is cumulative, like the database: units the job already
   received are excluded, the default is what was received plus the unreceived `Available`
   units (else the rest of the job quantity), the field runs from the received quantity to
   received + receivable, and the preview lists only the units this completion adds. Keep the lock when the job
   still has an unsplit placeholder (no serial sequence) — receiving those needs serial numbers,
   which is out of scope. Complete Job is disabled at quantity ≤ 0 for stocked items; the
   validator is unchanged, since Non-Inventory completions may still submit 0.

## Out of scope

- Unsplit serial placeholders (items without a serial sequence).
- Batch-tracked made items: same lock; batch receipt already follows quantity; status handling
  not yet checked.
- Serial- or batch-tracked components: backflush skips them and only the shop floor app issues
  them.
- Repairing jobs already completed at 0 (Complete is disabled on completed jobs).
- Interaction with the parked serial-number timing work (numbers assigned at production).

## Verification

- [x] SQL, rolled back, on the seeded serial job: complete at 0 refused; complete at 1 receives
      one serial and backflushes 27 of 30 lines (the 3 tracked lines are skipped by design);
      completing again receives nothing new.
- [x] Multi-unit serial job: complete 2 of 3 receives 2, leaves 1 `Reserved`; complete 3 receives
      the third.
- [x] Mixed (SQL, unit marked `Available` directly): the finished unit is the one received first.
- [x] Mixed, through the shop floor app: 2-unit job with serial-sequence units SAT-0002/SAT-0003;
      logged SAT-0003 complete on the final operation (operation stays open at 1 of 2); ERP dialog
      defaulted to 1 listing SAT-0003; completing received SAT-0003, left SAT-0002 `Reserved`,
      backflushed for one unit.
- [x] Shop floor only: 2-unit job, both units (SAT-0004, SAT-0005) logged complete on the final
      operation; operation flipped Done, job auto-completed at 2, both units received once,
      backflushed for two units (27 of 30 lines).
- [x] Auto-complete when the last operation goes Done still receives 1 and backflushes.
- [x] Inventory-tracked completion at 1 unchanged and refused at 0; Non-Inventory at 0 allowed.
- [x] Browser: J000002 dialog unlocked at 1 with serial J000002-01, Complete disabled at 0,
      capped at 1, completed (1 received, 27 lines consumed). J000001 with an unsplit placeholder
      stays locked at 0 with Complete disabled. J000001 split into 3 numbered units: dialog
      defaults to 3, completed at 2, received -01 and -02, -03 left `Reserved`.
- [x] Whole units: `complete_job_to_inventory` refuses a fractional quantity for serial-tracked
      jobs (SQL, rolled back: 1.5 refused, 2 accepted with no double receipt, inventory item at
      1.5 still accepted). Dialog: at 0.5 shows "Serial-tracked jobs must be completed in whole
      units." and disables Complete; back at 1 lists the serial and re-enables it.
- [x] Locked tracked job with nothing finished on the shop floor: dialog shows a warning
      ("Nothing completed in MES yet") explaining how to proceed, Complete disabled.
- [x] New strings translated in all 13 erp catalogs (hand-filled using the glossary terms).
- [x] Typecheck (`erp`), lint, `pnpm db:check:datasets`, `@carbon/checks` clobbers + tests.

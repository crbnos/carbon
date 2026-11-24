# Quality hold on a serial unit

> Status: implemented
> Date: 2026-11-23

## TLDR

A company can turn on **Issues: Hold Units** (Settings → Quality, off by
default). With it on, a serial unit is on hold on the shop floor while an issue
that is not Closed is linked to it. The MES refuses work that needs the unit
open and tells the operator which issue holds it. Other units of the job keep
moving. Closing the issue releases the unit.

## Overview diagram

```mermaid
flowchart LR
    A["Operator raises an issue on a unit"] --> B["Issue links the unit\n(nonConformanceTrackedEntity)"]
    B --> C{"Setting on and\nissue not Closed?"}:::new
    C -- yes --> D["Unit is on hold:\nresolveWorkUnit refuses work"]:::new
    C -- no --> E["Unit is open"]
    D --> F["Quality closes the issue"] --> E
    classDef new stroke-dasharray:4 3
```

## Problem Statement

A quality issue raised on a serial unit recorded the problem and changed
nothing else: the unit's next operation could still be started and completed.
Shops that must stop a nonconforming unit relied on a tag and a person
checking. Holding the whole job is too coarse: the other units are good.

## Proposed Solution

**The rule.** A unit is on hold when `companySettings.holdUnitsWithOpenIssues`
is true and a `nonConformanceTrackedEntity` row links it to an issue whose
status is not `Closed`. The hold is derived on every read. No status is stored,
so there is nothing to keep in step: closing or deleting the issue releases the
unit, and reopening it holds the unit again.

**One server check.** Every MES write of a serial unit already goes through
`resolveWorkUnit` (`apps/mes/app/services/work-unit.server.ts`; the
`mes-unit-write-resolves-unit` check fails a writer that skips it). It now
reads the holds of the units still to do (`readUnitHolds`) and treats a unit on
hold as not open:

| Write | A unit on hold |
|---|---|
| complete, scrap, rework, step record, complete all steps, issue material, item scan, traveler claim | refused: "This unit is on hold for issue <number>" |
| kanban start and complete scans | skipped for the next open unit; refused when only units on hold are left |
| timer start | starts without naming the unit |
| quality issue, correction, unconsume, part scrap (`member`) | allowed |

A failed read of the holds refuses the write.

**The screens.** The operation and assembly loaders read the same holds and
pass them to `useWorkUnit` as `isOnHold`. A unit on hold is not open, so the
existing `writesBlocked` disables its work, the first operation flows past it
and a later operation asks for another unit. A picked unit that goes on hold
stays on screen with a banner listing its open issues. The picker lists units
on hold after the open ones, with the issue number, and still opens when only
units on hold are left.

## Data

One column: `companySettings.holdUnitsWithOpenIssues BOOLEAN NOT NULL DEFAULT
false`. No new table.

## Not in scope

- An override. Closing the issue is the release.
- The ERP postings, the inspection lot's writes, batch step records and
  `trigger-rework`, which do not use `resolveWorkUnit`.
- Finishing an operation by hand, which names no unit.
- Batches. A lot is one tracked entity and uses the same link table, so the
  same rule would hold the whole lot. A partial defect would first be split
  into its own lot (`subdivideBatchEntity`), and only that lot held.
- Live refresh when the issue closes. The screen shows it on its next load.

## Tests

- `apps/mes/app/services/work-unit.test.ts`: each mode with a unit on hold,
  the setting off, a closed issue, a failed read.
- `apps/mes/app/services/unit-hold.server.test.ts`: the reader.
- `apps/mes/app/utils/workUnit.test.ts`: the screen rule.

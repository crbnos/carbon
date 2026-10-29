# Strict Backflush

Last tested: 2026-10-15
Routes: `/x/settings/items`, `/x/part/<itemId>/make/<makeMethodId>`, `/x/job/<jobId>`,
`/x/production/jobs`, `/x/picking-list/schedule`, MES `/x/operation/<jobOperationId>`

## Prerequisites
- Satellite demo dataset ("Carbon Development"). Manufacturing Plant has storage units
  A1-L1 … A3-L3 and lineside floors; Headquarters has a work center but NO storage unit.
- PCB-ADCS-R1 (`item_FGQD2WDhDcoMJWVDTNdEWV`) has a 2-line BoM (PCB-BARE-REV3,
  MAT-CONFCOAT) and no open change notice. SAW-001 v2 is locked by a change notice —
  "Set as Active Version" is disabled there for an unrelated reason.
- Seeded jobs (J000003 Planned, J000004 Draft) have no `jobMaterial.storageUnitId`.

## Steps
### 1. Settings — `/x/settings/items` → "Strict Backflush" card switch.
Expect "Strict backflush is on" and "1 active method has materials with no Pull From"
with a link (SAW-001).
Below it, "Prevent negative stock" (enabled only while strict backflush is on). Off: a short
storage unit is drawn below zero and the operation completes; a missing storage unit is
still refused.
### 2. Activation — part make page → version button ("V1 Draft") → hover "Version 1 Draft"
→ "Set as Active Version" → "Make Active". With gaps: toast
"Set a Pull From storage unit before you activate this version: <part>; <part>".
### 3. Release — job page → "Release". With gaps the dialog shows "Missing Storage Units"
(one entry per part) and "Release Job" is disabled. Bulk: jobs list → row checkbox →
selection-count button → "Release Jobs" → toast "Could not release 1: J000003 (set a Pull From …)".
### 4. MES completion — operation page → "Log completed" → "Increase" → "Log Completed".
Short bin: toast "Not enough A in BIN: need n, have m; Not enough B …" and NO
`productionQuantity` row. Covered bin: "Operation finished successfully", consumption only
from the line's bin.
### 5. ERP job complete — job page → "Complete" → "Increase" → "Complete Job".
Short bin: toast lists every short material (SQL `backflush_job_materials`).
### 6. Picked stock — `/x/picking-list/schedule` → select job → "Generate Picking List 1" →
"Pick" each line → MES completion consumes from the lineside bin, no refusal.
### 7. MES manual issue — operation page → material row "Issue Material" → "Issue".

## Selector Notes
- BoM / job BoM line Storage Unit combobox does not open from an `agent-browser click`
  on its ref: read its rect with `eval` and use `mouse move/down/up` on it.
- After a BoM line saves it collapses but its form stays in the DOM (hidden). Reload
  before editing a second line, or a ref match may land in the hidden form.
- Inventory adjustment modal: wait ~1 s after opening before clicking the storage unit
  combobox (the backdrop still covers it). If the storage unit is not chosen, the
  adjustment silently goes to the UNASSIGNED bin.
- Number fields (react-aria): `fill` then `press Tab`, and check the hidden input.

## Common Failures
- Saving a BoM line resyncs `methodType` to the item's default (Buy items become
  Purchase to Order) — pre-existing behavior, not strict backflush.

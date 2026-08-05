# Picked-Material Return Timing (job vs operation)

Last tested: 2026-08-04
Routes: ERP `/x/settings/inventory`, `/x/picking-list/schedule`, `/x/picking-list/<id>/details`,
`/x/job/<id>/details`; MES `/x/operation/<opId>`

## Prerequisites
- Migration `20260804111631` applied (`returnPickedMaterialTiming`, `quantityReturned`).
- A Make item whose method has ≥1 operation on a work center, one untracked BOM
  material (per-unit 1) with warehouse stock in a bin. For an OP-scope test the
  method needs 2 operations and the jobMaterial must be assigned to op 1
  (`jobMaterial.jobOperationId` — no BOM UI for this yet; set via SQL fixture).
- MES login is separate (same DEV_BYPASS email at `MES_URL/login`; retry the
  target URL after login — first redirect can bounce).

## Steps

### 1. Policy setting (ERP Inventory settings)
- Card "Returning unused picked material" = the **4th** ChoiceSelect / 4th Save
  on the page. Hidden input `input[name=returnPickedMaterialTiming]` is truth.
- Options: "At job completion" (`job`, default) / "At operation completion"
  (`operation`). Submit that form via requestSubmit → toast "Material return
  timing updated"; persists across reload.

### 2. Stage material
- Create job (qty 2) → Release (confirm dialog "Release Job").
- `/x/picking-list/schedule` → check "Select J00000N" → button
  "Generate Picking List 1" → redirects to the list details → click **Pick**
  (line badge → 2/2, list header Completed; jobMaterial.storageUnitId → lineside).

### 3. Produce partially + finish op (MES)
- `/x/operation/<opId>`: big emerald submit button = Start (op → In Progress).
- 1st `button.bg-accent` = "Log completed" modal → fill qty 1 → "Log Completed"
  (inserts productionQuantity; auto-backflushes untracked → quantityIssued 1;
  Consumption ledger row AT the lineside bin).
- 2nd `button.bg-accent` = action sheet → "Finish" → "Finish Anyways" (1 < 2).
- CAUTION: the sidebar "Add Inventory"/"End Operations" buttons are NOT the
  completion flow (manual adjustment / end-events).

### 4. Expected outcomes
- **policy=operation, op 1 of 2 finishes (job stays In Progress):** immediate
  Transfer pair lineside→source for `picked − max(issued, owed)` where
  `owed = (estimatedQuantity ÷ job qty) × op quantityComplete`;
  `pickingListLine.quantityReturned` += returned; `quantityPicked` UNCHANGED
  (gross); list header stays Completed/Partial (no In Progress demotion);
  jobMaterial.storageUnitId restored to source when nothing staged remains.
- **policy=job, op finishes (non-last):** NO return (quantityReturned stays 0).
- **last op finishes (either policy) or ERP job Complete button:** job completes
  → backflush tops up from lineside → job-scope sweep returns the rest.
- ERP Complete dialog: quantity field prefills 0 — fill the real completed qty
  (react-aria: fill + blur before requestSubmit "Complete Job").
- ERP picking-list line shows a "Returned N" secondary badge (LuUndo2 icon).

## Verification queries
```sql
SELECT "quantityPicked","quantityReturned",status FROM "pickingListLine" WHERE id='...';
SELECT "entryType",quantity,"storageUnitId" FROM "itemLedger" ORDER BY "createdAt";
-- lineside bin should net to 0 after job completion; source bin = initial − consumed
```

## Selector Notes
- MES op controls are unlabeled: emerald submit = Start; `button.bg-accent`[0] =
  Log completed; `button.bg-accent`[1] = action sheet (Scrap/Rework/Finish/…).
- Settings ChoiceSelects have no accessible labels — target by position or the
  hidden input name.
- Job release/complete confirm dialogs: buttons "Release Job" / "Complete Job".

## Common Failures
- MES first navigation lands on /login even with ERP cookies — log in there
  once, then re-open the operation URL.
- ERP job operations table Qty-Complete cell editor would not open via
  click/dblclick in agent-browser — use the MES Log-completed flow instead.

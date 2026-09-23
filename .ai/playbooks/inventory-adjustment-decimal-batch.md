# Inventory Adjustment — decimal quantities on a batch-tracked item

Last tested: 2026-09-23
Route: `/x/inventory/quantities/<itemId>/details` → "Update Inventory" drawer

## Prerequisites
- A **batch-tracked** item with a fractional UoM (e.g. `MAT-AL7075-PLT`,
  `item_JGJDAeYjKqVoJicSCPT8bF`, UoM POUND, in Carbon Development).
- A storage unit to hold stock (e.g. `A2-L1`).
- Edge functions healthy (`post-inventory-adjustment` hot).

## Steps

### 1. Open the drawer
- Item detail page → **Update Inventory** button. A drawer form opens.
- Fields (by input `name`): `storageUnitId` (combobox), `adjustmentType`
  (combobox: Set Quantity | Positive Adjustment | Negative Adjustment | Scrap),
  `readableId` (Batch Number, **free text**), `quantity` (react-aria number),
  `scrapReasonId` (only when type=Scrap).

### 2. Positive decimal adjustment (creates a lot)
- Adjustment Type → **Positive Adjustment**.
- Storage Unit → `A2-L1` (open combobox, filter, click the option).
- Batch Number → type a NEW value, e.g. `DEC-TEST-A` (free text mints a fresh
  `trackedEntityId` → a new entity is created).
- Quantity → `2.5`, then **blur** (click another field) — the react-aria hidden
  input commits on blur; verify `input[name=quantity].value === "2.5"`.
- Submit by calling `requestSubmit` on the drawer's FORM, passing the Save
  button as the submitter — `form.requestSubmit(saveButton)` (or bare
  `form.requestSubmit()`). `requestSubmit` is a form method, not a button
  method, and a plain click on Save does nothing.
- Verify: Quantity on Hand rises by 2.5 (e.g. 60 → 62.5); storage-unit table
  shows `A2-L1 | 2.5 | <batch>`.

### 3. Negative decimal drain to zero (drain path → Consumed)
- Adjustment Type → **Negative Adjustment**, Storage Unit → `A2-L1`.
- Batch Number → the existing lot's readableId (e.g. `DEC-TEST-A`). The negative
  path resolves the entity BY `readableId`, so free text is fine here.
- Quantity → the full remaining (e.g. `2.5`). Submit.
- Verify: on-hand returns to the pre-test value; the lot disappears from the
  on-hand table; in `/x/inventory/tracked-entities?search=<batch>` the entity
  shows **quantity 0, status CONSUMED** (NOT a 0-qty Available husk).

## Selector Notes
- Comboboxes are custom: click to expand, `fill` the inner search combobox, then
  click the option. Refs shift after each selection (a "Clear" button appears) —
  re-`snapshot` before the next field.
- Read committed state via `input[name=...].value` inside `[role=dialog]`, never
  the visible text.
- Right after the drawer opens, the first combobox click can time out (open
  animation) — `sleep 2` and retry once.

## Common Failures
- **Scrap of an EXISTING batch does not post.** The batch field is free text and
  mints a NEW `trackedEntityId`; the Scrap path resolves the entity by that id,
  so it 400s "Tracked entity not found" against the new id and the real lot is
  untouched. Scrapping an existing lot must be driven from a surface that passes
  the real entity id (not this drawer's free-text batch field). This is a
  form/harness limitation, not an edge-function bug.
- A submit that does nothing → you clicked Save instead of `requestSubmit`, or a
  react-aria number field never blurred (hidden `quantity` still stale).

# Serial Tracking Properties & Unified Tracked-Entity UI — implementation plan

**Spec:** .ai/specs/2026-08-26-serial-tracking-properties-and-tracked-entity-ui.md
**Research:** N/A (UI-consistency change on an existing capability; see spec "Notes / Non-Goals")
**Branch:** serial-batch-properties-receipt-ui

## Progress
- [x] Task 1: Migration — extend `update_receipt_line_serial_tracking` with `p_properties` (forked from newest def 20260427130000; migration 20260826165616; applied + verified via running DB)
- [x] Task 2: Regenerate DB types (serial RPC now types `p_properties?: Json`)
- [x] Task 3: Extract shared tracking-property helper (reserved keys + value extractor)
- [x] Task 4: Broaden receipt loader to load properties for serial items
- [x] Task 5: Pass per-serial properties through the receipt serial tracking route
- [x] Task 6: Rework receipt `SerialForm` into per-serial groups (properties + per-serial expiry + Edit Properties)
- [x] Task 7: Relabel batch headings to "Tracking Properties" (receipt + shipment)
- [x] Task 8: Load tracking properties in the shipment loader
- [x] Task 9: Render properties read-only on shipment batch + serial forms
- [x] Task 10: Browser verification via /test (receipt serial form verified end-to-end + DB; shipment page loads clean; screenshots in .ai/scratch/e2e/)

## Dependencies
- Task 2 needs Task 1 (migration before types).
- Tasks 3 and 4 are independent of each other; both should land before the UI tasks.
- Task 5 needs Task 1 (RPC param) + Task 2 (types).
- Task 6 needs Tasks 3, 4, 5.
- Task 7 needs Task 3 (can run after 6).
- Task 9 needs Tasks 3, 8.
- Task 10 (browser) is last; needs everything.

---

## Task 1: Migration — extend the serial tracking RPC with a `p_properties` argument

> **Corrected during execution (2026-08-26):** the fork source is
> `20260427130000_shelf-life-start-on-receipt.sql`, the true NEWEST definition — NOT
> `20260420000000` (the plan's original guess). The newest def ALREADY writes
> `expirationDate` to the column, ALREADY sets the `itemId` column, and carries
> load-bearing shelf-life-start resolution (`resolve_shelf_life_start_for_receipt`).
> So this task now ONLY adds `p_properties` + its merge; it must preserve every other
> clause of the newest body verbatim.

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_serial-tracking-properties.sql`
- Fork from (NEWEST serial RPC def): `packages/database/supabase/migrations/20260427130000_shelf-life-start-on-receipt.sql` (function `update_receipt_line_serial_tracking`)

**Steps:**
1. Create the migration file:
   ```bash
   pnpm db:migrate:new serial-tracking-properties
   ```
   (Never hand-pick or backdate the timestamp; the CLI stamps it. Do not use `000000` for HHMMSS.)
2. Confirm `20260427130000` is still the newest file that CREATEs this function:
   ```bash
   for f in $(grep -l "update_receipt_line_serial_tracking" packages/database/supabase/migrations/*.sql | sort); do grep -q "CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking" "$f" && echo "$f"; done | tail -1
   ```
   Expected: `…/20260427130000_shelf-life-start-on-receipt.sql`. If a newer file appears, fork from THAT instead.
3. Write the migration: `DROP FUNCTION IF EXISTS update_receipt_line_serial_tracking;` then recreate the newest body EXACTLY, changing only two things:
   - Add a trailing nullable param `p_properties JSONB DEFAULT NULL` (after `p_expiry_date`).
   - Declare `v_properties JSONB;` and, right after the `Supplier` block, merge caller-supplied custom property values into `attributes` (stripping any `expirationDate` key — expiry stays a column).

   Full body:
   ```sql
   DROP FUNCTION IF EXISTS update_receipt_line_serial_tracking;
   CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking(
     p_receipt_line_id TEXT,
     p_receipt_id TEXT,
     p_serial_number TEXT,
     p_index INTEGER,
     p_tracked_entity_id TEXT DEFAULT NULL,
     p_expiry_date TEXT DEFAULT NULL,
     p_properties JSONB DEFAULT NULL
   ) RETURNS void AS $$
   DECLARE
     v_item_id            TEXT;
     v_item_readable_id   TEXT;
     v_company_id         TEXT;
     v_created_by         TEXT;
     v_supplier_id        TEXT;
     v_attributes         JSONB;
     v_properties         JSONB;
     v_resolved_expiry    DATE;
     v_expiration_date    DATE;
   BEGIN
     SELECT
       rl."itemId",
       i."readableIdWithRevision",
       rl."companyId",
       rl."createdBy",
       r."supplierId"
     INTO
       v_item_id,
       v_item_readable_id,
       v_company_id,
       v_created_by,
       v_supplier_id
     FROM "receiptLine" rl
     JOIN "receipt" r ON r.id = rl."receiptId"
     JOIN "item" i ON i.id = rl."itemId"
     WHERE rl.id = p_receipt_line_id;

     v_attributes := jsonb_build_object(
       'Receipt Line', p_receipt_line_id,
       'Receipt', p_receipt_id,
       'Receipt Line Index', p_index
     );

     IF v_supplier_id IS NOT NULL THEN
       v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
     END IF;

     -- NEW: merge caller-supplied custom property values (keyed by batchProperty.id).
     -- Strip any expirationDate key: expiry is a first-class column, never an attribute.
     v_properties := COALESCE(p_properties, '{}'::jsonb) - 'expirationDate';
     v_attributes := v_attributes || v_properties;

     IF p_expiry_date IS NOT NULL AND p_expiry_date <> '' THEN
       BEGIN
         v_expiration_date := p_expiry_date::DATE;
       EXCEPTION WHEN OTHERS THEN
         v_expiration_date := NULL;
       END;
     ELSE
       v_resolved_expiry := resolve_shelf_life_start_for_receipt(v_item_id, p_receipt_id);
       IF v_resolved_expiry IS NOT NULL THEN
         v_expiration_date := v_resolved_expiry;
       END IF;
     END IF;

     IF p_tracked_entity_id IS NULL THEN
       INSERT INTO "trackedEntity" (
         "quantity",
         "status",
         "sourceDocument",
         "sourceDocumentId",
         "sourceDocumentReadableId",
         "readableId",
         "attributes",
         "companyId",
         "createdBy",
         "itemId",
         "expirationDate"
       )
       VALUES (
         1,
         'On Hold',
         'Item',
         v_item_id,
         v_item_readable_id,
         p_serial_number,
         v_attributes,
         v_company_id,
         v_created_by,
         v_item_id,
         v_expiration_date
       );
     ELSE
       UPDATE "trackedEntity"
       SET
         "readableId" = p_serial_number,
         "attributes" = v_attributes,
         "sourceDocumentReadableId" = v_item_readable_id,
         "itemId" = v_item_id,
         "expirationDate" = COALESCE(v_expiration_date, "expirationDate")
       WHERE id = p_tracked_entity_id;
     END IF;
   END;
   $$ LANGUAGE plpgsql;
   ```
4. Diff your new body against the newest fork source so the ONLY changes are the new `p_properties` param, the `v_properties` DECLARE, and the two-line merge block:
   ```bash
   diff <(awk '/CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking/,/\$\$ LANGUAGE/' packages/database/supabase/migrations/20260427130000_shelf-life-start-on-receipt.sql) <(awk '/CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking/,/\$\$ LANGUAGE/' packages/database/supabase/migrations/*serial-tracking-properties.sql)
   ```
   Expected: only the intended hunks (the `p_properties` param line, the `v_properties` DECLARE line, and the two `NEW: merge…` lines). If ANY other line differs (a dropped shelf-life clause, a missing `itemId`), STOP and fix — do not re-derive the body from memory.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies cleanly, no error. If the local crbn migrate cannot apply (permission), validate the SQL by
# running it in a rolled-back psql transaction as supabase_admin (see reference_migration_rollback_validation memory).
```

**Out of scope:** Do NOT touch `update_receipt_line_batch_tracking`. Do NOT add a `trackingType` column to `batchProperty`. Do NOT change `trackedEntity` columns (none needed).

**Escape hatch:** If `pnpm db:migrate` fails because a newer migration already redefined this function differently, STOP and report — re-fork from that newest def.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts` — the `update_receipt_line_serial_tracking` RPC arg type gains `p_properties?: Json`.

**Steps:**
1. Run:
   ```bash
   pnpm run generate:types
   ```
2. Confirm the serial RPC now types `p_properties`:
   ```bash
   grep -n "p_properties" packages/database/src/types.ts | head
   ```

**Verify:**
```bash
grep -c "update_receipt_line_serial_tracking" packages/database/src/types.ts
# Expected: >= 1, and the Args for it include p_properties (check the grep in step 2 shows it under the serial function).
```

**Out of scope:** Never hand-edit `packages/database/src/types.ts` — only regenerate.

---

## Task 3: Extract a shared tracking-property helper (reserved keys + value extractor)

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/inventory/ui/Batches/tracking-properties.ts`
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx` — replace the two inline reserved-key filters in `BatchForm` (lines ~724-736 and ~757-769) with the helper.
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentLines.tsx` — replace the inline reserved-key filter in `BatchForm` (lines ~682-695) with the helper.
- Copy from (precedent — the exact reserved-key list): `ReceiptLines.tsx` lines 727-734.

**Steps:**
1. Create `tracking-properties.ts` with the reserved-key constant and a value extractor (kebab-case filename per repo convention; helper is a plain `.ts`, not a component):
   ```ts
   import type { TrackedEntityAttributes } from "@carbon/utils";

   // Structural attribute keys written by the tracking RPCs / shipment assignment —
   // never user-facing custom property values. Kept in ONE place so receipts and
   // shipments filter identically.
   export const RESERVED_TRACKING_ATTRIBUTE_KEYS = [
     "Shipment Line",
     "Shipment",
     "Shipment Line Index",
     "Receipt Line",
     "Receipt",
     "Receipt Line Index",
     "Supplier",
     "expirationDate"
   ] as const;

   // Extract only the custom property values (keyed by batchProperty.id) from a
   // tracked entity's attributes, dropping every structural key.
   export function getTrackingPropertyValues(
     attributes: TrackedEntityAttributes | Record<string, unknown> | null | undefined
   ): Record<string, string> {
     if (!attributes) return {};
     return Object.entries(attributes as Record<string, unknown>)
       .filter(
         ([key]) =>
           !(RESERVED_TRACKING_ATTRIBUTE_KEYS as readonly string[]).includes(key)
       )
       .reduce(
         (acc, [key, value]) => ({ ...acc, [key]: (value as string) || "" }),
         {} as Record<string, string>
       );
   }
   ```
   Note: this list is a SUPERSET of each current inline list (adds `"Receipt Line Index"` and `"Supplier"`, which are structural and must never render as a property). That is intentional and correct.
2. In `ReceiptLines.tsx` `BatchForm`, import `{ getTrackingPropertyValues }` from `"../Batches/tracking-properties"` and replace both `Object.entries(attributes).filter(...).reduce(...)` blocks with `getTrackingPropertyValues(attributes)`.
3. In `ShipmentLines.tsx` `BatchForm`, do the same for the initial-state `properties` block (lines ~682-695).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new type errors from these files.
```

**Out of scope:** Do NOT change `updateBatchNumber`'s `["Receipt Line"]`-only filter (lines ~789, ~791) — that is a different, deliberate filter used when copying an existing entity's attributes on rename; leave it alone.

---

## Task 4: Broaden the receipt loader to load properties for serial items too

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/x+/receipt+/$receiptId.tsx` — line 63-66 (`itemsWithBatchProperties`).

**Steps:**
1. Change `itemsWithBatchProperties` to include serial-tracked lines. Replace the filter that only checks `requiresBatchTracking` with one that also accepts `requiresSerialTracking` — i.e. reuse the same predicate `trackedItemIds` already uses. Simplest: set `itemsWithBatchProperties = trackedItemIds` after `trackedItemIds` is computed, or change the filter to:
   ```ts
   itemsWithBatchProperties = receiptLines.data
     .filter(
       (line) =>
         line &&
         line.itemId &&
         (line.requiresBatchTracking || line.requiresSerialTracking)
     )
     .map((line) => line.itemId)
     .filter((itemId) => itemId !== null);
   ```
   (Keep the variable name — it is threaded into `getBatchProperties` at line 124 and consumed as `batchProperties` route data. Renaming is out of scope.)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new type errors.
```

**Out of scope:** Do NOT rename `itemsWithBatchProperties`/`batchProperties` route-data keys (they are read in `ReceiptLines.tsx`). Do NOT change `getBatchProperties`.

---

## Task 5: Pass per-serial properties through the receipt serial tracking route

**Depends on:** Task 1, Task 2
**Files:**
- Modify: `apps/erp/app/routes/x+/receipt+/lines.tracking.tsx` — the `trackingType === "serial"` branch (lines 73-152).
- Copy from (precedent — how the batch branch parses + passes properties): the same file, lines 24, 48-53, 65.

**Steps:**
1. In the serial branch, read and parse a `properties` field the same way the batch branch does:
   ```ts
   const propertiesRaw = formData.get("properties") as string | null;
   let serialPropertiesJson = {};
   try {
     serialPropertiesJson = propertiesRaw ? JSON.parse(propertiesRaw) : {};
   } catch (error) {
     logger.error("Failed to parse serial tracking properties", { error });
   }
   ```
2. Pass it to the RPC call (add `p_properties: serialPropertiesJson` to the existing `rpc("update_receipt_line_serial_tracking", { ... })` args at lines 129-139).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: p_properties is accepted (types regenerated in Task 2); no error.
```

**Out of scope:** Do NOT change the duplicate-serial guard logic (lines 78-125). Do NOT change the batch branch.

---

## Task 6: Rework receipt `SerialForm` into per-serial groups (properties + per-serial expiry + Edit Properties)

**Depends on:** Task 3, Task 4, Task 5
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx` — `SerialForm` (lines 961-1188) and the props passed to it from `ReceiptLineItem` / the `ReceiptLines` list (pass the per-line serial tracking entities).
- Copy from (precedent — per-property field rendering, Edit Properties button, per-entity expiry): `BatchForm` in the same file (lines 689-959) and `BatchPropertiesFields` (`../Batches/BatchPropertiesFields.tsx`).

**Steps:**
1. Give `SerialForm` access to each serial unit's existing tracked entity so it can seed property values + expiry. In the `ReceiptLines` list render (around line 254-262) a per-line `trackingCandidates` array already exists; pass the FULL array to `ReceiptLineItem` (new prop `serialTracking={trackingCandidates}`) and through to `SerialForm`. Do NOT collapse it to a single `tracking` — serials need per-index matching by `attributes["Receipt Line Index"]`.
2. Rework the `SerialForm` JSX: replace the single `grid grid-cols-1 lg:grid-cols-3` of bare inputs (lines 1112-1168) and the single line-wide expiry (lines 1098-1110) with a **stacked list of per-serial groups**, one per received unit. Each group mirrors the batch group's structure:
   - A serial-number `Input` (keep the existing dup-check `validateSerialNumber`, `onChange`, `onKeyDown` next-focus, and `onBlur` → `updateSerialNumber` behavior).
   - When `showExpiryField` (item shelf-life mode is "Set on Receipt"), a per-serial `DatePicker` (move the existing DatePicker into the group; its value is this serial's expiry, not a shared one).
   - `BatchPropertiesFields` for this item's definitions (reuse exactly as `BatchForm` does at lines 919-939: `<Suspense><Await resolve={batchProperties}>` → filter `p.itemId === line.itemId`), with `values` = this serial's property values and `onChange` updating this serial's values.
   - Wrap each group so many units stay navigable: render groups inside a collapsible. Use the existing `@carbon/react` accordion/collapsible primitive — grep first:
     ```bash
     grep -rn "Accordion\|Collapsible" packages/react/src/index.tsx
     ```
     Use whichever is exported (e.g. `Accordion`/`AccordionItem` or `Collapsible`). Default to collapsed when `serialNumbers.length > 5`; expanded otherwise. The collapsed header shows the serial number (or `Serial {index+1}` placeholder) so it is scannable. If NEITHER an Accordion nor a Collapsible is exported from `@carbon/react`, STOP and report — do not hand-roll show/hide state; ask which primitive to use. (The `/ui` skill will refine the exact visual treatment afterward; this task establishes the structure.)
3. Add per-serial local state for property values + expiry, seeded from the matched serial entity (`serialTracking.find(t => t.attributes["Receipt Line Index"] === index)`): `readableId` → number (already handled), `getTrackingPropertyValues(entity.attributes)` → property values, `entity.expirationDate` → expiry. A `Record<number, { properties: Record<string,string>; expirationDate: string }>` keyed by index is sufficient.
4. Change `updateSerialNumber` to submit `properties` and this serial's `expiryDate`: append `formData.append("properties", JSON.stringify(thisSerialProperties))` (it already appends `expiryDate`). Also submit on property/expiry change (not only on serial-number blur): when a property or the expiry changes for a serial that already has a number, call `updateSerialNumber` for that index so the value persists (mirror `BatchForm.handlePropertiesChange` → `updateBatchNumber`). Guard: only submit when that serial's `number` is non-empty (the RPC keys the row by serial number/index).
5. Add the "Edit Properties" button to the `SerialForm` header (mirror `BatchForm` lines 858-866 + the `BatchPropertiesConfig` modal block 941-956). `SerialForm` already imports/uses `propertiesDisclosure` and renders `BatchPropertiesConfig` (lines 1070, 1169-1184) — surface the trigger button in the header and keep the modal.
6. Relabel the header from "Serial Numbers" to "Tracking Properties" (Task 7 covers labels; if doing this task first, use "Tracking Properties" here).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors. (Visual correctness is verified in Task 10.)
```

**Out of scope:** Do NOT change `serialNumbersByLineId`'s `{ index, number }` element shape in the parent `ReceiptLines` (dup-checking relies on it) — carry properties/expiry in `SerialForm`-local state instead. Do NOT change the serial number persistence RPC contract beyond adding `properties`.

**Escape hatch:** If seeding per-serial property values from `serialTracking` produces a render loop (the existing `useEffect` on `tracking` in `BatchForm` guards against this), mirror `BatchForm`'s guarded `setValues` effect (lines 746-772) — compare previous vs next before setting state.

---

## Task 7: Relabel batch headings to "Tracking Properties" (receipt + shipment)

**Depends on:** none (do after Task 6 to avoid churn)
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx` — `BatchForm` heading (line 836) `"Batch Properties"` → `"Tracking Properties"`.
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentLines.tsx` — `BatchForm` heading (line 873) `"Tracking Number"` → `"Tracking Properties"`; `SerialForm` heading (line 1125) stays `"Tracking Numbers"` or becomes `"Tracking Properties"` for consistency (use `"Tracking Properties"`).

**Steps:**
1. Update the three `<Heading size="h4">` strings noted above to `"Tracking Properties"`. Keep them as plain strings unless the surrounding file wraps headings in `<Trans>` — match the neighbor (these are currently bare strings, so leave bare).
2. Do NOT rename the `batchProperty` table, `getBatchProperties`, `BatchProperty` type, `BatchPropertiesFields`, or `BatchPropertiesConfig` — internal names stay.

**Verify:**
```bash
grep -rn "Batch Properties" apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx
# Expected: no matches (heading relabeled).
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors.
```

**Out of scope:** No table/service/type renames.

---

## Task 8: Load tracking properties in the shipment loader

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.tsx` — loader (lines 24-100).
- Copy from (precedent): `apps/erp/app/routes/x+/receipt+/$receiptId.tsx` lines 57-75, 123-125.

**Steps:**
1. Import `getBatchProperties` from `~/modules/inventory` (add to the existing import block, lines 8-13).
2. After `shipmentLines` is available, collect item ids for batch- OR serial-tracked lines:
   ```ts
   const trackedItemIds = (shipmentLines.data ?? [])
     .filter(
       (line) =>
         line?.itemId &&
         (line.requiresBatchTracking || line.requiresSerialTracking)
     )
     .map((line) => line.itemId)
     .filter((itemId): itemId is string => itemId !== null);
   ```
   If `ShipmentLine` does not expose `requiresBatchTracking`/`requiresSerialTracking`, STOP and check the type (`Awaited<ReturnType<typeof getShipmentLines>>`); the shipment UI already reads these flags in `ShipmentLines.tsx` (e.g. line 124), so they exist — use the same access.
3. Add `batchProperties: getBatchProperties(client, trackedItemIds, companyId)` to the returned object (defer/await consistent with the receipt loader — the receipt loader passes the promise through without awaiting; do the same so `<Await>` resolves it client-side).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors; batchProperties present in the loader return type.
```

**Out of scope:** Do NOT change `getShipmentTracking` or the shipment posting flow.

---

## Task 9: Render tracking properties read-only on shipment batch + serial forms

**Depends on:** Task 3, Task 8
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentLines.tsx` — `BatchForm` (650-949) and `SerialForm` (953-1228); thread `batchProperties` from route data through `ShipmentLineItem` to both forms.
- Copy from (precedent — read-only property rendering): `BatchPropertiesFields` usage in `ReceiptLines.tsx` `BatchForm` (lines 919-939) with `isReadOnly` forced true.

**Steps:**
1. Read `batchProperties` from route data in `ShipmentLines` (add to the `useRouteData<{...}>` generic, mirroring `ReceiptLines.tsx` line 110) and pass it down to `ShipmentLineItem` → `BatchForm`/`SerialForm`.
2. In shipment `BatchForm`, after the batch-number picker, render the picked entity's properties **read-only**. Resolve the picked entity from the already-available `batchNumbers` pool (`resolveTrackedEntity(values.number, batchNumbers?.data ?? [])`) and pass `getTrackingPropertyValues(resolvedBatch?.attributes)` as `values` into `<BatchPropertiesFields ... isReadOnly={true} onChange={() => {}} />` inside the same `<Suspense><Await resolve={batchProperties}>` wrapper used on receipts. Filter definitions with `p.itemId === line.itemId`. Only render when a valid entity is resolved.
3. In shipment `SerialForm`, render per-serial groups mirroring the reworked receipt `SerialForm` (Task 6) but **read-only**: for each serial index, resolve the entity from `serialNumbersData` (already fetched via `useSerialNumbers`) and show its property values read-only under the serial input. Use the same collapsible structure chosen in Task 6 so receipts and shipments read the same. No expiry editing, no property editing — `isReadOnly={true}`, `onChange={() => {}}`.
4. Do not add any write path — shipments must not mutate property values (they are inherited from the receipt-time entity). The existing shipment `lines.tracking.tsx` action only merges assignment attributes; leave it unchanged.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors.
```

**Out of scope:** Do NOT make shipment properties editable. Do NOT add `getBatchProperties` re-fetch inside the component (use route data). Do NOT change `shipment+/lines.tracking.tsx`.

---

## Task 10: Browser verification via /test

**Depends on:** Tasks 1-9
**Files:** none (verification only)

**Steps:**
1. Ensure the dev stack is up (`crbn up`) and migrations applied. Use `/auth` then `/test`.
2. Exercise, per the spec acceptance criteria:
   - An item with `itemTrackingType = "Serial"` that has ≥2 `batchProperty` definitions (create them via the serial form's "Edit Properties" if none exist). Receive it on a PO receipt with `receivedQuantity ≥ 2`.
   - Verify each serial unit renders its own serial-number field + both property fields (+ expiry field when the item's shelf-life mode is "Set on Receipt").
   - Enter distinct property values for two serials, reload the receipt, confirm each serial shows its own values (independent per unit).
   - Confirm the groups are collapsible and default-collapsed when unit count is high.
   - Post the receipt; confirm no error and values persist.
   - On a shipment picking those serials, confirm each picked serial shows its property values **read-only** (disabled, no editable inputs).
   - On a batch shipment, confirm the batch's properties show read-only under "Tracking Properties".
   - Confirm batch receipts still behave exactly as before (regression) apart from the "Tracking Properties" relabel.
3. Capture screenshots of the reworked serial receipt form and the shipment read-only display (per `feedback_surface_designs_with_screenshots` — net-new UI work PRs include agent-browser screenshots).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: both clean before opening the PR.
```

**Out of scope:** N/A.

---

## Notes for the executor

- After the migration + type regen, propagate types via the existing `Awaited<ReturnType<...>>` chains — do not add casts.
- This is UI work anchored to existing precedent (`BatchForm`, `BatchPropertiesFields`); do not design new visual patterns from concepts. `/ui` refines visuals after the structure lands (Task 6).
- Do not auto-commit; commit per task via `/check-and-commit` only when the user asks (per `feedback_no_auto_commit`).
- If any assumption here proves false (e.g. `@carbon/react` exposes no collapsible, or `ShipmentLine` lacks the tracking flags), STOP and report rather than improvising.
```

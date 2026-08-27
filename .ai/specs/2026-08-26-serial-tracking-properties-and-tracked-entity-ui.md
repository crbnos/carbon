# Serial Tracking Properties & Unified Tracked-Entity UI

> Status: draft
> Author: Brad Barbin (spec via spec-writing skill)
> Date: 2026-08-26

## TLDR

Custom "batch properties" (per-item, typed property definitions — heat number, test
result, supplier lot, etc.) are captured and displayed today only for **Batch**-tracked
items on **receipts**. This spec extends the same capability to **Serial**-tracked items,
reworks the serial receipt UI from a flat grid of serial-number inputs into a **per-serial
grouped layout** (serial number → its properties → next serial → its properties), and makes
the tracked-entity property UI **consistent across receipts and shipments** — with
properties shown **read-only** on shipments (inherited from the entity picked at receipt).
No schema change to the property-definition model: `batchProperty` is reused as-is, because
an item is only ever one tracking type. User-facing labels unify to **"Tracking Properties."**

## Problem Statement

- **Serial items can't carry custom properties.** A serial-tracked part (e.g. a machined
  component with a per-unit heat number, hardness reading, or CoC value) has no way to record
  those values at receipt. `batchProperty` definitions and their input fields are wired only
  into the receipt **`BatchForm`** (`ReceiptLines.tsx`), and the serial tracking RPC
  (`update_receipt_line_serial_tracking`) takes no `p_properties` argument. `SerialForm`
  renders only serial-number text inputs plus one line-wide expiration date.

- **The serial UI doesn't scale to properties.** Serials render today in one
  `grid grid-cols-1 lg:grid-cols-3` container of bare inputs
  (`ReceiptLines.tsx:1112-1168`), one cell per received unit. There is nowhere to attach
  per-unit property fields — the layout must be reworked so each serial owns a group.

- **Receipts and shipments are inconsistent and code-duplicated.** `ReceiptLines.tsx` and
  `ShipmentLines.tsx` each define their own private `BatchForm`/`SerialForm`. The receipt
  batch form renders full property fields; the shipment batch form reads the picked entity's
  properties into state, submits them, but **renders nothing** — the data is carried
  invisibly. Serial properties appear on neither. There is no shared component, so any change
  must be made twice and can drift.

- **Consistency goal (from the requester).** When we rework the serial layout, batch and
  shipment surfaces should read the same way, so the app presents one coherent
  "tracked-entity properties" concept regardless of tracking type or document.

Concrete example: a supplier delivers 10 serial-tracked valves on a PO. The receiver records
serial numbers `V-001…V-010`, and for each, a per-unit **heat number** and **pressure-test
result**. On a later shipment of 3 of those valves, the picker sees each picked serial with
its heat number and test result shown read-only, confirming the right units are going out.

## Proposed Solution

### 1. Reuse `batchProperty` as the definition model (no schema change)

`batchProperty` (per-item: `itemId`, `label`, `dataType`, `listOptions`, `sortOrder`) already
keys definitions by item, and `item.itemTrackingType` is a single enum
(`Inventory | Non-Inventory | Serial | Batch`) — an item is **exactly one** tracking type, so
a given item's `batchProperty` rows are unambiguous whether the item is Batch or Serial. We
render those definitions for Serial items too. No `trackingType` discriminator, no table
rename, no migration on a live table. (Resolved Q1.)

### 2. Store per-serial values on each serial's own tracked entity

For a Serial line there are **N** `trackedEntity` rows (one per unit, `quantity = 1`, matched
by `attributes["Receipt Line Index"]`). Each serial's property values persist in **its own**
`trackedEntity.attributes[batchProperty.id]` — exactly the batch mechanism, applied per unit.
Each serial also gets its **own** `expirationDate` column value (fully per-unit). (Resolved
Q3.) This requires extending the serial tracking RPC to accept and merge `p_properties`
(§ Data Model Changes).

### 3. Rework the serial receipt UI into per-serial groups

Replace the flat 3-column input grid with a **stacked list of per-serial sections**. Each
section is a group shaped like the batch group: a serial-number field (header) followed by
that unit's property fields (and its own expiration date when applicable). Sections are
**collapsible** and collapse by default when the unit count is large (threshold a UI detail),
so a 100-unit receipt is navigable. The `/ui` skill refines the exact visual treatment
(accordion vs. cards, collapsed summary line, focus/scan flow). (Resolved Q2.)

### 4. Extract a shared tracked-entity property component; render read-only on shipments

Extract the property-field rendering (currently `BatchPropertiesFields`, batch-only, imported
only by `ReceiptLines`) into a shared component usable by both receipt and shipment, batch and
serial, in **editable** (receipt) and **read-only** (shipment) modes. On shipments, both batch
and serial properties display **read-only**, inherited from the Available entity picked at
receipt — the shipment already reads them into state and submits them; we now surface them.
(Resolved Q4.) This directly serves the consistency goal and removes the duplicate reserved-key
filtering (`"Shipment Line" | "Shipment" | "Shipment Line Index" | "Receipt Line" | "Receipt" |
"expirationDate"`) that exists in both files.

### 5. Unify user-facing naming to "Tracking Properties"

Rename the user-facing headings/labels/config button to **"Tracking Properties"** across
receipts and shipments, for both batch and serial. The `batchProperty` **table, service
functions, and validators keep their names** (internal contract, no schema/type churn). The
serial receipt form gains the same **"Edit Properties"** button the batch form has, opening the
existing definition editor (`BatchPropertiesConfig`) for the serial item.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Serial property definitions | Reuse `batchProperty` as-is; no schema change | Item has exactly one `itemTrackingType`, so per-item defs are unambiguous; avoids a migration on a live table (Q1) |
| Per-serial value storage | Each serial's values in its own `trackedEntity.attributes[bp.id]`; per-serial `expirationDate` | Mirrors batch mechanism per unit; serial tracking exists precisely to record per-unit facts (Q3) |
| Serial layout | Per-serial collapsible groups (serial → its properties), `/ui` refines | Requester's stated model; scales to many units; mirrors batch group for consistency (Q2) |
| Shipment properties | Read-only display, batch + serial | Properties are inherited from the receipt-time entity; authoring at ship time would mutate shared descriptive data (Q4) |
| Shared component | Extract one `TrackingProperties` field component (editable/read-only), used by both receipt & shipment | Removes duplicated forms + reserved-key filtering; makes consistency structural, not conventional |
| Naming | User-facing "Tracking Properties"; keep `batchProperty` table/service/validator names | Consistent UX with zero schema/type-generation churn |
| Multi-tenancy (heuristic 1) | No new table; `batchProperty` already has `companyId` + composite PK + `id('bp')` | N/A — reuse |
| Service shape (heuristic 2) | Existing `getBatchProperties(client, itemIds, companyId)` reused; new loader wiring only | Follows `client`-first, `{data,error}` convention already |
| RLS (heuristic 3) | No new table; existing `batchProperty` RLS unchanged | N/A — reuse |
| Permission scoping (heuristic 4) | Serial property writes use the same `inventory` update path as batch (receipt line tracking) | Same document + action as existing batch writes |
| Form pattern (heuristic 5) | Receipt tracking uses the existing fetcher-to-RPC pattern (not ValidatedForm), matching `BatchForm`/`SerialForm` today | Preserve behavior; do not introduce a divergent form pattern into this screen |
| Module layout (heuristic 6) | All changes in `inventory` module + its two DB RPCs | No cross-module scatter |
| Backward compatibility (heuristic 7) | `update_receipt_line_serial_tracking` gains an optional `p_properties JSONB DEFAULT NULL`; old callers unaffected | Additive, nullable param; batch RPC already has `p_properties` |

## Data Model Changes

**No new tables. No column changes.** `batchProperty`, `trackedEntity.attributes`, and
`trackedEntity.expirationDate` already support everything needed.

**One RPC signature change** — add an optional properties argument to the serial tracking
function so it merges per-serial property values into `attributes`, exactly as the batch RPC
does. New timestamped migration (fork from the latest `update_receipt_line_serial_tracking`
definition, `DROP FUNCTION IF EXISTS` first, preserve all attributes — per the migration
function-redefinition rules):

```sql
-- Fork from the latest def (20260420000000). Add p_properties, nullable & last-but-expiry
-- so existing positional callers keep working. Merge into attributes like the batch RPC,
-- stripping expirationDate out into the DATE column.
DROP FUNCTION IF EXISTS update_receipt_line_serial_tracking;
CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_serial_number TEXT,
  p_index INTEGER,
  p_tracked_entity_id TEXT DEFAULT NULL,
  p_expiry_date TEXT DEFAULT NULL,
  p_properties JSONB DEFAULT NULL          -- NEW: per-serial custom property values, keyed by batchProperty.id
) RETURNS void AS $$
-- ... existing body: build base attributes {Receipt Line, Receipt, Receipt Line Index, Supplier},
--     then `v_attributes := v_attributes || COALESCE(p_properties, '{}'::jsonb)` (minus expirationDate),
--     readableId = p_serial_number, quantity = 1, status = 'On Hold', expirationDate from p_expiry_date.
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

Property values are read back the same way batch does — off `trackedEntity.attributes`, keyed
by `batchProperty.id`, with reserved structural keys filtered out. `readableId` remains the
serial number (never read the number from attributes).

## API / Service Changes

- **`getBatchProperties`** (`inventory.service.ts`) — reused unchanged. Callers now include
  serial itemIds.
- **Receipt loader** (`routes/x+/receipt+/$receiptId.tsx`) — broaden `itemsWithBatchProperties`
  to include lines where `requiresSerialTracking` (currently `requiresBatchTracking` only), so
  serial items' property definitions and shelf-life are deferred into route data.
- **Shipment loader** (`routes/x+/shipment+/$shipmentId.tsx`) — add `getBatchProperties` for the
  shipment lines' items (batch **and** serial) so the shipment UI can render property values
  read-only. (Currently the shipment loader loads neither `getBatchProperties` nor
  `getShelfLifeForItems`.)
- **Serial tracking route** (`routes/x+/receipt+/lines.tracking.tsx`) — pass parsed
  `properties` (per-index) through to `update_receipt_line_serial_tracking` via the new
  `p_properties` argument, mirroring the batch branch. Each serial entity is written with its
  own property values + expiry.
- **RPC** — `update_receipt_line_serial_tracking` gains `p_properties` (above).

## UI Changes

- **Extract `TrackingProperties`** (working name) from `BatchPropertiesFields.tsx` into a
  component both receipts and shipments import, supporting `isReadOnly`. Keep the typed
  per-`dataType` inputs (numeric/text/list/boolean/date). Centralize the reserved-key filter
  helper (single source, replacing the duplicate in both files).
- **Receipt `SerialForm`** (`ReceiptLines.tsx`) — reworked from the flat grid to per-serial
  collapsible groups: each serial = serial-number field + its property fields + its own
  expiration date; add an **"Edit Properties"** button (opens `BatchPropertiesConfig` for the
  item). `/ui` refines the collapsed/expanded visuals and the many-units interaction.
- **Receipt `BatchForm`** — relabel "Batch Properties" → "Tracking Properties"; otherwise the
  single-group layout is unchanged (it already is "number → properties").
- **Shipment `BatchForm` and `SerialForm`** (`ShipmentLines.tsx`) — render the picked entity's
  properties **read-only** under each batch/serial (per-serial groups mirroring the receipt),
  using the shared component in read-only mode.
- **Labels** — user-facing "Tracking Properties" everywhere; keep code/table/validator names.

## Acceptance Criteria

- [ ] On a receipt for a **Serial** item whose part has 2 `batchProperty` definitions (one
      `numeric` heat number, one `list` test result), each received unit shows its own serial
      number field plus both property fields, and an expiration date field when the item's
      shelf-life mode is "Set on Receipt".
- [ ] Entering distinct property values for two different serials on the same line persists
      **independent** values: after reload, serial 1 shows its values and serial 2 shows its
      own (values stored on each unit's `trackedEntity.attributes`, keyed by `batchProperty.id`).
- [ ] The serial receipt form is presented as per-serial groups (serial → its properties);
      with a high unit count the groups are collapsible and default collapsed. (Visual detail
      verified via `/ui`.)
- [ ] The serial receipt form has an "Edit Properties" button that opens the definition editor
      for that item, and adding a definition there makes the field appear on every serial group.
- [ ] Posting the receipt flips each serial entity to `Available` (or `On Hold` when inbound
      inspection applies) without altering the stored property values or per-serial expiration.
- [ ] On a **shipment** that picks serial-tracked units, each picked serial shows its serial
      number with its inherited property values displayed **read-only** (no editable inputs).
- [ ] On a **shipment** that picks a batch, the batch's properties display **read-only** (they
      were carried invisibly before; now visible), under the unified "Tracking Properties" label.
- [ ] Receipt and shipment tracked-entity property rendering go through **one shared
      component**; the reserved-key filter exists in exactly one place.
- [ ] Batch receipts behave exactly as before except for the "Tracking Properties" relabel
      (no regression in batch property capture, expiry, or the Edit Properties modal).
- [ ] `pnpm run generate:types` after the migration, then `pnpm exec turbo run typecheck
      --filter=erp` passes; `/test` verifies the serial receipt + shipment flows in-browser.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Serial RPC redefinition drops a load-bearing clause | Med | Fork from the newest `update_receipt_line_serial_tracking` def, `DROP IF EXISTS` first, diff body so only the `p_properties` merge is added (migration function-redefinition rule) |
| RPC positional-arg break for existing callers | Low | `p_properties` is nullable and last; batch RPC already carries the analogous arg |
| Many-units serial screen becomes unwieldy | Med | Collapsible groups, default-collapsed above a threshold; `/ui` validates the interaction |
| Shipment loader now fetches properties for every line's item (N+1 risk) | Low | Reuse `getBatchProperties(client, itemIds[], companyId)` — one `.in()` call, no per-line query (database-patterns rule) |
| Shared-component extraction changes batch behavior subtly | Med | Keep `BatchPropertiesFields` internals identical; extraction is a move + `isReadOnly` prop, verified against the batch receipt path first |
| Values written under a `batchProperty.id` that is later deleted | Low | Same behavior as batch today; orphaned attribute keys are filtered by the reserved-key + definition-join render (no new risk) |
| Reserved-key collision if a property `label`/`id` matched a structural key | Low | Values are keyed by `batchProperty.id` (`bp…`), which never collides with the human-readable structural keys; unchanged from batch |

## Open Questions

> All resolved with the user (2026-08-26) before this spec was written.

- [x] **Property definitions for serial items — reuse `batchProperty` or restructure?**
      **Answer:** Reuse `batchProperty` as-is; no schema change. An item is only ever one
      tracking type, so per-item definitions are unambiguous. Render the same fields for serial
      items.
- [x] **Reworked serial layout — how to present "serial → properties → next serial"?**
      **Answer:** Per-serial stacked sections (serial-number header + its property fields),
      collapsible/accordion when there are many units, mirroring the batch group. `/ui` refines
      the visuals.
- [x] **Per-serial values — independent or shared across the line?**
      **Answer:** Fully per-unit — each serial gets its own property values *and* its own
      expiration date.
- [x] **Shipments consistency — what scope for showing properties?**
      **Answer:** Show properties (batch + serial) **read-only** on shipments, inherited from
      the entity picked at receipt. Not editable at ship time; not deferred.
- [x] **Naming (surfaced while writing).** **Decision:** Unify user-facing label to "Tracking
      Properties" on receipts and shipments for both batch and serial; keep the `batchProperty`
      table, service, and validator names internally. Serial receipt form gains the same "Edit
      Properties" button batch has. (Recommended in the interview; folded here as the design
      choice — flag for veto if you'd rather keep separate "Batch"/"Serial Properties" labels.)

## Notes / Non-Goals

- **Research:** N/A — this is a UI-consistency change on an existing capability (per-unit
  attribute capture is standard QMS/traceability practice), not new ERP-domain logic. Design
  is anchored to existing Carbon precedent (the batch receipt form) per the "copy UI
  precedent" convention.
- **Not in scope:** editing tracked-entity properties from the shipment; a `trackingType`
  discriminator on `batchProperty`; changing the batch single-group layout; MES/job serial
  property capture (this spec is ERP receipts + shipments).
- **Print labels:** the existing `PrintButton` on serial/batch forms is untouched; whether
  properties appear on printed tracking labels is a follow-up, not part of v1.

## Changelog

- 2026-08-26: Created. All four design questions resolved with the user before writing;
  naming decision folded in and flagged for veto.

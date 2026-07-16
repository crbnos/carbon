# Shipping Serialized Jobs — Bug Investigation

## Summary

When a user completes a Make-to-Order serialized job partially (e.g., 2 of 5) and then tries to create a shipment, **no shipment lines appear**. The root cause is in the job completion route: it incorrectly writes the **full job quantity** to `job.quantityShipped` instead of 0 (or the actual completed amount). This makes the shipment creation logic think everything has already been shipped, so it creates no lines.

---

## 🔴 Root Cause: `$jobId.complete.tsx` Writes Wrong `quantityShipped`

### Location
`apps/erp/app/routes/x+/job+/$jobId.complete.tsx` — lines 60–100

### The Bug

When a Make-to-Order job is partially completed (e.g., complete 2 of 5), the completion route sets `job.quantityShipped` to the **full original job quantity** rather than the completed amount or 0:

```typescript
// $jobId.complete.tsx, line 60
const originalQuantity = job.data?.quantity ?? 0;       // 5
const leftoverQuantity = Math.max(0, quantityComplete - originalQuantity);  // max(0, 2-5) = 0
const hasLeftover = leftoverQuantity > 0;               // false

let quantityToShip = originalQuantity;                  // 5 ← BUG: should not be the full qty

// hasLeftover is false, so the switch never executes
if (hasLeftover && leftoverAction) {
  switch (leftoverAction) { /* ... */ }
}

// ... calls complete_job_to_inventory (sets quantityComplete=2) ...

if (makeToOrder) {
  await client
    .from("job")
    .update({
      quantityShipped: quantityToShip,    // writes 5 — WRONG
    })
    .eq("id", jobId);
}
```

After completion:
- `job.quantityComplete = 2` (correct — set by `complete_job_to_inventory`)
- `job.quantityShipped = 5` (**wrong** — should be 0, nothing has been shipped yet)

### How This Causes Empty Shipment Lines

In the `create` edge function (`shipmentFromSalesOrder` and `shipmentFromSalesOrderLine`), the shipped quantity for each job is calculated as:

```typescript
// create/index.ts, line 2143
const quantityToShip = Math.max(
  0,
  (job.quantityComplete ?? 0) - (job.quantityShipped ?? 0)
);
// = Math.max(0, 2 - 5) = Math.max(0, -3) = 0

if (!isSerial || (isSerial && quantityToShip > 0)) {
  // For serial items: isSerial=true, quantityToShip=0
  // true && false → false — BLOCK IS SKIPPED
  // No fulfillment or shipment line is created!
}
```

Because `quantityShipped (5) > quantityComplete (2)`, the subtraction yields a negative number, clamped to 0. For serial items, the condition `quantityToShip > 0` is false, so **no shipment line is created**. The shipment exists but is completely empty.

### Exact Reproduction

1. Create a Sales Order for 5 serial-tracked parts (Make to Order)
2. Create a Job from the sales order line
3. Do some operations on the shop floor
4. Complete the job through the ERP for 2 out of 5
5. Try to ship from the sales order ("Ship" button)
6. **Result:** Shipment is created but shipment lines are empty

### Suggested Fix

The `quantityToShip` variable should reflect **what was actually completed**, not the full job quantity. For a partial completion, nothing has been shipped yet — the shipment document hasn't even been created:

```typescript
// BEFORE (wrong):
let quantityToShip = originalQuantity;

// AFTER (correct):
let quantityToShip = quantityComplete;
```

Or, since `quantityShipped` should represent physically shipped quantities (via posted shipment documents), the completion route should not set `quantityShipped` at all for partial completions. The `post-shipment` function already updates `quantityShipped` correctly when a shipment is actually posted:

```typescript
// Alternative fix — only set quantityShipped for full completions:
if (makeToOrder) {
  const isFullCompletion = quantityComplete >= originalQuantity;
  if (isFullCompletion) {
    await client
      .from("job")
      .update({
        quantityShipped: quantityToShip,
        updatedAt: new Date().toISOString(),
        updatedBy: userId
      })
      .eq("id", jobId);
  }
}
```

**Recommendation**: The cleanest fix is to change `let quantityToShip = originalQuantity` to `let quantityToShip = quantityComplete`. This makes the leftover logic still work correctly (when `quantityComplete > originalQuantity`, the leftover switch kicks in), while fixing the partial completion case.

---

## Secondary Issues Found During Investigation

### Issue 2 (HIGH): All Tracked Entities Linked to Shipment (Including Reserved)

**Location:** `packages/database/supabase/functions/create/index.ts` (~line 2210)

During shipment creation for serialized jobs, all tracked entities from the job make method are linked to the shipment line — including `Reserved` entities still in production:

```typescript
const trackedEntities = await client
  .from("trackedEntity")
  .select("*")
  .eq("attributes->>Job Make Method", jobMakeMethod.id)
  // No status filter — includes Reserved entities!
  .order("createdAt", { ascending: true });
```

At post time (`post-shipment/index.ts` ~line 708), ALL linked entities are consumed — including Reserved ones. This over-decrements inventory and corrupts the production pipeline.

**Fix:** Add `.eq("status", "Available")` filter when linking tracked entities.

### Issue 3 (MEDIUM): Division by Zero for Non-Serial MTO Lines

**Location:** `packages/database/supabase/functions/create/index.ts` (~line 2165)

For non-serial Make-to-Order lines with `quantityToShip = 0`, the unit cost calculation divides by zero:

```typescript
const shippingAndTaxUnitCost =
  (salesOrderLine.shippingCost / quantityToShip +    // 0/0 = NaN
    (salesOrderLine.unitPrice ?? 0)) *
  (1 + salesOrderLine.taxPercent);
```

PostgreSQL rejects `NaN`/`Infinity` in `NUMERIC` columns, rolling back the entire transaction.

**Fix:** Guard: `if (quantityToShip === 0) continue;` before the fulfillment insert, or handle the divisor.

### Issue 4 (LOW): `complete_job_to_inventory` Over-Processes Serial Entities

**Location:** `packages/database/supabase/migrations/20260508120000_complete-job-to-inventory.sql` (~line 130)

For serial jobs, `complete_job_to_inventory` creates item ledger entries for ALL non-consumed tracked entities (including Reserved ones) and sets all non-consumed to `Available`:

```sql
FOR v_tracked_entity IN
  SELECT * FROM "trackedEntity"
  WHERE attributes->>'Job Make Method' = v_job_make_method.id
    AND status != 'Consumed'          -- includes Reserved!
LOOP
  INSERT INTO "itemLedger" (...) VALUES (...);
END LOOP;

UPDATE "trackedEntity"
SET status = 'Available'
WHERE attributes->>'Job Make Method' = v_job_make_method.id
  AND status != 'Consumed';           -- makes Reserved entities Available
```

For 2 of 5 complete: 2 Available + 1 Reserved entities exist. All 3 get item ledger entries and all become Available. The Reserved entity (the next serial to be produced) is incorrectly treated as produced.

**Fix:** Filter to only process `Available` entities, or count based on `p_quantity_complete`.

---

## Key File Reference

| Purpose | File |
|---------|------|
| **🔴 ROOT CAUSE** — Job completion route | `apps/erp/app/routes/x+/job+/$jobId.complete.tsx` |
| Shipment creation edge function | `packages/database/supabase/functions/create/index.ts` |
| Shipment posting edge function | `packages/database/supabase/functions/post-shipment/index.ts` |
| Job completion SQL function | `packages/database/supabase/migrations/20260508120000_complete-job-to-inventory.sql` |
| Serial operation completion | `packages/database/supabase/functions/issue/index.ts` → `jobOperationSerialComplete` |
| Shipment lines UI | `apps/erp/app/modules/inventory/ui/Shipments/ShipmentLines.tsx` |
| Post modal validation | `apps/erp/app/modules/inventory/ui/Shipments/ShipmentPostModal.tsx` |
| Serial number fetching | `apps/erp/app/modules/inventory/inventory.service.ts` → `getSerialNumbersForItem` |
| Job tracked entity seed trigger | `packages/database/supabase/migrations/20260426000000_tracked-entity-item-fk.sql` → `sync_insert_job_make_method` |
| Production quantity rollup trigger | `packages/database/supabase/migrations/20260531084723_rework-serial-flow.sql` → `sync_production_quantity` |

## Data Flow Diagram

```
Job Completion ($jobId.complete.tsx)
  ├─ complete_job_to_inventory(p_quantity_complete=2)
  │    └─ job.quantityComplete = 2 ✓
  │    └─ job.status = 'Completed'
  │    └─ tracked entities → Available (including Reserved ones)
  │
  └─ if (makeToOrder):
       └─ job.quantityShipped = originalQuantity = 5 ← BUG
  
Shipment Creation (create → shipmentFromSalesOrder)
  ├─ quantityToShip = max(0, quantityComplete - quantityShipped)
  │                  = max(0, 2 - 5) = 0
  │
  └─ if (isSerial && quantityToShip > 0) → FALSE
       └─ No shipment line created → Empty shipment ← SYMPTOM
```

# Shipping Bug Reproduction Report — Serialized Jobs

**Date:** 2026-07-01
**Repo:** `/home/openclaw/carbon`
**File under analysis:** `packages/database/supabase/functions/create/index.ts`

---

## 1. Stack Boot Status

- **Docker:** Available (v29.1.3)
- **`crbn` CLI:** In PATH, ports allocated
- **Stack state:** Not running (only Redis container up). Full stack can be booted with `crbn up` but was not started — code-level analysis is sufficient to confirm the bugs.
- **Resources:** 15 GB RAM, 8 CPUs — adequate for `crbn up`

---

## 2. Reproduction Scenario

> 1. Make a sales order for 5 serial parts
> 2. Make a job (manufacturing order) for those parts
> 3. Do a couple operations on the shop floor
> 4. Complete the job through the ERP for 2/5 (partial completion)
> 5. Try to ship it from the sales order
> 6. **Nothing shows up on the shipment lines**

---

## 3. Confirmed Bugs

### Bug A — Division by Zero in `shippingAndTaxUnitCost`

**Severity:** Medium-High (causes NaN → PostgreSQL rejects insert → transaction rollback → 500 error)

The `shippingAndTaxUnitCost` calculation divides by `quantityToShip` (or `saleQuantity`), which can be zero. JavaScript `0 / 0 = NaN`, and PostgreSQL rejects `NaN` for `NUMERIC` columns, causing the entire transaction to fail silently from the user's perspective.

**Affected locations (4 instances):**

| Path | Line | Divisor | When Zero |
|------|------|---------|-----------|
| `shipmentFromSalesOrder` MTO | **2165** | `quantityToShip` | Non-serial items with no completions, or fully-shipped jobs |
| `shipmentFromSalesOrder` non-MTO | **2242** | `salesOrderLine.saleQuantity ?? 0` | `saleQuantity` is null or 0 |
| `shipmentFromSalesOrderLine` MTO | **2469** | `quantityToShip` | Same as above |
| `shipmentFromSalesOrderLine` non-MTO | **2549** | `salesOrderLine.data.saleQuantity ?? 0` | Same as above |

**Code (line 2164–2167, `shipmentFromSalesOrder` MTO path):**
```typescript
const shippingAndTaxUnitCost =
  (salesOrderLine.shippingCost / quantityToShip +   // ← division by zero when quantityToShip = 0
    (salesOrderLine.unitPrice ?? 0)) *
  (1 + salesOrderLine.taxPercent);
```

**Why it triggers:** For serial items, the guard `isSerial && quantityToShip > 0` prevents entry when `quantityToShip = 0`. But for **non-serial** items (inventory-tracked or batch), the condition `!isSerial` is true, so the code enters the block even with `quantityToShip = 0`. The `shippingCost` column has `DEFAULT 0`, so `0 / 0 = NaN` → insert fails → transaction rollback.

**Note:** Even though `shippingCost` defaults to 0 (so the numerator is 0 too), JavaScript `0 / 0 = NaN`, not `0`. This is distinct from `n / 0 = Infinity` when `n > 0`.

---

### Bug B — Missing Status Filter on Tracked Entity Queries

**Severity:** High (assigns wrong serial numbers / WIP entities to shipments, corrupts traceability)

When building shipment lines for serialized/batch "Make to Order" items, the code queries tracked entities by `Job Make Method` attribute but does **not** filter by `status = 'Available'`. This means entities in `Reserved`, `On Hold`, `Consumed`, or `Rejected` status are all picked up and assigned to the shipment.

**Valid tracked entity statuses** (from `trackedEntityStatus` enum): `Available`, `Reserved`, `On Hold`, `Consumed`, `Rejected`

**Affected locations (2 instances):**

| Path | Lines | Description |
|------|-------|-------------|
| `shipmentFromSalesOrder` MTO | **2205–2209** | No status filter |
| `shipmentFromSalesOrderLine` MTO | **2510–2514** | No status filter |

**Code (lines 2205–2209, `shipmentFromSalesOrder`):**
```typescript
const trackedEntities = await client
  .from("trackedEntity")
  .select("*")
  .eq("attributes->>Job Make Method", jobMakeMethod.id)
  .order("createdAt", { ascending: true });
// ← MISSING: .eq("status", "Available")
```

**Impact on the reproduction scenario:**

When a job is created for 5 serial parts, tracked entities are created with status `'Reserved'`. During shop floor operations, individual serial tracked entities may be created/split. When the job is completed for 2/5 via `complete_job_to_inventory`, ALL non-consumed entities are set to `'Available'`.

The unfiltered query assigns ALL entities (including `Reserved` ones still being manufactured) to the shipment. This means:
- Entities not yet available for shipping get assigned to the shipment
- If a previous shipment consumed some entities, `Consumed` entities also get re-assigned
- The `index` counter includes wrong entities, corrupting the `"Shipment Line Index"` attribute

**Compare with `complete_job_to_inventory`** (which correctly filters):
```sql
-- In complete_job_to_inventory (migration 20260630092517):
SELECT * FROM "trackedEntity"
WHERE attributes->>'Job Make Method' = v_job_make_method.id
  AND status != 'Consumed'   -- ← At least filters out consumed
```

**Fix:** Add `.eq("status", "Available")` to both queries.

---

### Bug C — Operator Precedence Bug in `outstandingQuantity`

**Severity:** Low (latent — not triggered in normal flow but will bite if data is null)

**Location:** `shipmentFromSalesOrder` non-MTO path, **lines 2236–2238**

```typescript
const outstandingQuantity =
  (salesOrderLine.saleQuantity ?? 0) -
    previouslyShippedQuantitiesByLine[salesOrderLine.id] ?? 0;
```

**Issue:** JavaScript operator precedence: `-` binds tighter than `??`. This evaluates as:
```
((saleQuantity ?? 0) - previouslyShippedQuantitiesByLine[id]) ?? 0
```
Instead of the intended:
```
(saleQuantity ?? 0) - (previouslyShippedQuantitiesByLine[id] ?? 0)
```

If `previouslyShippedQuantitiesByLine[salesOrderLine.id]` were `undefined`, the subtraction would give `NaN`, and `NaN ?? 0` is still `NaN` (because `NaN` is not `null`/`undefined`).

**Why it's latent:** The `previouslyShippedQuantitiesByLine` map is built from the same `salesOrderLines.data` array, so every `salesOrderLine.id` will exist as a key. But the missing parentheses represent a logic error.

**Compare with `shipmentFromSalesOrderLine`** (lines 2541–2544), which avoids this by using `Math.max`:
```typescript
const outstandingQuantity = Math.max(
  0,
  (salesOrderLine.data.saleQuantity ?? 0) - previouslyShippedQuantity
);
```

---

## 4. Root Cause Analysis: "Nothing Shows Up"

Tracing through the exact scenario (5 serial parts, MTO, job completed for 2/5):

### Expected Flow
1. `quantityToShip = job.quantityComplete(2) - job.quantityShipped(0) = 2`
2. Condition: `isSerial && quantityToShip > 0` → `true`
3. Fulfillment record created ✓
4. `shippingAndTaxUnitCost = (0 / 2 + unitPrice) * (1 + 0) = unitPrice` ✓
5. Shipment line inserted with `shippedQuantity = 2` ✓
6. Tracked entities queried and assigned ✓ (but without status filter — Bug B)

### Why "Nothing Shows Up" Could Still Happen

The shipment line **should** be created for this specific scenario. Possible explanations for "nothing shows up":

1. **Job lacks `salesOrderLineId`:** If the job was created with `salesOrderId` but NOT `salesOrderLineId` (the column is `TEXT` nullable), then `jobsBySalesOrderLine[salesOrderLine.id]` would be `undefined`, and the `for await` loop iterates over `[]`. **No shipment lines created.** This is the most likely root cause of the "nothing shows up" symptom.

2. **Location mismatch:** The `salesOrderLines` query filters by `.eq("locationId", locationId)`. If the location passed to the function doesn't match the sales order line's location, no sales order lines are returned, hence no shipment lines.

3. **Tracked entity assignment failure:** If the unfiltered tracked entity query (Bug B) returns entities in incompatible states, and the attribute update fails for some reason, the transaction could roll back. The outer catch returns a 500 error.

4. **`quantityComplete` not updated:** If "Complete the job through the ERP for 2/5" doesn't actually call `complete_job_to_inventory` but instead only updates some operations, the job's `quantityComplete` might still be 0 depending on whether the operations are terminal. With `quantityToShip = 0`, serial items skip the block entirely.

---

## 5. Additional Findings

### Dead Code in `shipmentFromSalesOrder`

Lines ~2145 and ~2280: `shipmentLineItems` is declared as an empty array and checked at the end (`if (shipmentLineItems.length > 0)`), but nothing is ever pushed to it. All shipment lines are inserted directly inside the loop. The `shipmentLineItems` array and its final insert block are dead code.

### Inconsistent `quantityToShip` guard

In `shipmentFromSalesOrder` MTO path (line 2143):
```typescript
if (!isSerial || (isSerial && quantityToShip > 0)) {
```
This creates shipment lines with `shippedQuantity = 0` for non-serial items with no completed quantity. The downstream `post-shipment` function handles this safely (NaN guards exist at lines ~127–133 of `post-shipment/index.ts`), but it's unnecessary work and conceptually wrong to create a shipment line with nothing to ship.

---

## 6. Exact Code Paths (Line Numbers in `create/index.ts`)

| Concern | `shipmentFromSalesOrder` | `shipmentFromSalesOrderLine` |
|---------|--------------------------|------------------------------|
| Case start | Line 1962 | Line 2322 |
| Jobs query | Line 2013 | Line 2372 |
| Jobs grouped by SO line | Line 2047 | N/A (query filters by salesOrderLineId) |
| MTO branch | Line 2081 | Line 2437 |
| `quantityToShip` calc | Line 2085 | Line 2441 |
| Serial guard | Line 2089 | Line 2445 |
| **Division-by-zero** | **Line 2165** | **Line 2469** |
| Shipment line insert | Line 2170 | Line 2474 |
| **Missing status filter** | **Lines 2205–2209** | **Lines 2510–2514** |
| Non-MTO branch | Line 2235 | Line 2540 |
| **Operator precedence** | **Line 2237** | N/A (uses Math.max) |
| Non-MTO div-by-zero | **Line 2242** | **Line 2549** |

---

## 7. Recommended Fixes

### Fix Bug A (Division by Zero)
Guard `quantityToShip` and `saleQuantity` before dividing:
```typescript
const shippingPerUnit = quantityToShip > 0
  ? salesOrderLine.shippingCost / quantityToShip
  : 0;
const shippingAndTaxUnitCost =
  (shippingPerUnit + (salesOrderLine.unitPrice ?? 0)) *
  (1 + salesOrderLine.taxPercent);
```

### Fix Bug B (Missing Status Filter)
Add `.eq("status", "Available")` to both tracked entity queries:
```typescript
const trackedEntities = await client
  .from("trackedEntity")
  .select("*")
  .eq("attributes->>Job Make Method", jobMakeMethod.id)
  .eq("status", "Available")   // ← ADD THIS
  .order("createdAt", { ascending: true });
```

### Fix Bug C (Operator Precedence)
Add parentheses:
```typescript
const outstandingQuantity =
  (salesOrderLine.saleQuantity ?? 0) -
    (previouslyShippedQuantitiesByLine[salesOrderLine.id] ?? 0);
```
Or use `Math.max` like the `shipmentFromSalesOrderLine` path does.

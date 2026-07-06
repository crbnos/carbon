# Generation Logic: Picking Lists

## Trigger

User-initiated from the Picking Schedule view. Manager or kitter selects operations and clicks "Generate Picking List."

## Algorithm

### Step 1: Collect Job Materials

For each selected job operation:
- Query `jobMaterial` records where `jobOperationId` matches
- Include only materials where `quantityToIssue > 0` (not yet fully issued)
- Include only items with `itemTrackingType = 'Inventory'` (exclude services, non-inventory)

### Step 2: Resolve Source Storage Unit

For each job material:
1. Use `jobMaterial.storageUnitId` if set and `defaultStorageUnit = false`
2. Fall back to `pickMethod.defaultShelfId` for the item + location combination
3. If neither is set, mark as "unresolved" — warn user, exclude from picking list

### Step 3: Exclude Lineside Materials

For each resolved source storage unit:
- Walk up the storage unit parent chain (recursive)
- If any ancestor (or the unit itself) has `workCenterId` set → lineside → exclude
- Only non-lineside materials proceed to the picking list

### Step 4: Batch Determination (FIFO)

For batch-tracked items:
1. Query `trackedEntity` records for the item at the source storage unit
2. Exclude entities already allocated on other pending/in-progress picking list lines
3. Sort by `createdAt` ascending (FIFO — oldest first)
4. Allocate quantity across entities until `quantityToPick` is satisfied
5. If insufficient tracked entities available, warn user (can still proceed with partial allocation)

For serial-tracked items:
1. Same as batch but each entity has quantity = 1
2. Allocate individual entities up to `quantityToPick`

### Step 5: Create Records

1. Create `pickingList` header (status = Draft, dueDate = earliest operation start)
2. For each material:
   - Create `pickingListLine` with `jobOperationId` for kit grouping
   - Create `pickingListLineTrackedEntity` records for each allocated entity
3. Return the draft for manager review

## Picking Schedule View Query

The picking schedule shows operations with outstanding pick requirements:

```
SELECT
  jo.id,
  jo."jobId",
  jo."order",
  jo."processId",
  jo."workCenterId",
  j."jobId" as "jobReadableId",
  j."itemId",
  -- Count of materials needing picks
  COUNT(jm.id) FILTER (
    WHERE jm."quantityToIssue" > 0
    AND NOT is_lineside(jm."storageUnitId")  -- pseudo-function
  ) as "partsToPickCount"
FROM "jobOperation" jo
JOIN "job" j ON jo."jobId" = j.id
LEFT JOIN "jobMaterial" jm ON jm."jobOperationId" = jo.id
WHERE j."status" IN ('Ready', 'In Progress')
AND jo."status" IN ('Todo', 'Ready')
GROUP BY jo.id, j.id
HAVING COUNT(jm.id) FILTER (
  WHERE jm."quantityToIssue" > 0
  AND NOT is_lineside(jm."storageUnitId")
) > 0
ORDER BY jo."scheduledStartDate" ASC
```

## Edge Cases

- **Same material on multiple operations**: Each operation's need is a separate line. No cross-operation consolidation (kits must be per-operation).
- **Material with no operation assignment** (`jobOperationId IS NULL`): Group under a "Job-level" kit. These are materials not tied to a specific operation.
- **Quantity changes after generation**: If `jobMaterial.estimatedQuantity` changes after a picking list is generated, the existing picking list is not auto-updated. The picking schedule would show remaining needs, and a new picking list can be generated.
- **Multiple picking lists for same operation**: Allowed — `quantityToIssue` decreases as picks complete, so subsequent lists only cover remaining needs.

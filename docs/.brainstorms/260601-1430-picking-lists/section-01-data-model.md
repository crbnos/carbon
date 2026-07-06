# Data Model: Picking Lists

## New Tables

### pickingList

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `pickingListId` | TEXT UNIQUE | Readable ID (e.g. "PL-000001") |
| `status` | pickingListStatus enum | `Draft`, `In Progress`, `Completed`, `Cancelled` |
| `locationId` | TEXT FK → location | Facility where picking happens |
| `assignee` | TEXT FK → user | Kitter assigned |
| `dueDate` | DATE | When picks are needed (defaults to earliest operation start) |
| `notes` | TEXT | |
| `customFields` | JSONB | |
| `companyId` | TEXT FK → company | |
| `createdBy` | TEXT FK → user | |
| `updatedBy` | TEXT FK → user | |
| `createdAt` | TIMESTAMP | |
| `updatedAt` | TIMESTAMP | |

### pickingListLine

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `pickingListId` | TEXT FK → pickingList | Parent picking list |
| `jobId` | TEXT FK → job | Which job this pick serves |
| `jobMaterialId` | TEXT FK → jobMaterial | Specific job material record |
| `jobOperationId` | TEXT FK → jobOperation | For kit grouping |
| `itemId` | TEXT FK → item | What to pick |
| `quantityToPick` | NUMERIC | How much needed |
| `quantityPicked` | NUMERIC DEFAULT 0 | How much actually picked |
| `storageUnitId` | TEXT FK → storageUnit | Source storage unit (warehouse) |
| `status` | pickingListLineStatus enum | `Pending`, `Picked`, `Short`, `Cancelled` |
| `companyId` | TEXT FK → company | |

### pickingListLineTrackedEntity

| Column | Type | Notes |
|---|---|---|
| `pickingListLineId` | TEXT FK → pickingListLine | |
| `trackedEntityId` | TEXT FK → trackedEntity | Specific batch/serial |
| `quantity` | NUMERIC | Proposed quantity from this entity |
| `quantityPicked` | NUMERIC DEFAULT 0 | Actual quantity picked |

## Schema Changes

### storageUnit (add column)

| Column | Type | Notes |
|---|---|---|
| `workCenterId` | TEXT FK → workCenter (nullable) | If set, this storage unit is lineside for that work center. Children inherit via recursive lookup. |

### Inheritance Logic

```sql
-- Resolve effective workCenterId for a storage unit (recursive CTE)
WITH RECURSIVE ancestors AS (
  SELECT id, "workCenterId", "parentId"
  FROM "storageUnit"
  WHERE id = $1

  UNION ALL

  SELECT su.id, su."workCenterId", su."parentId"
  FROM "storageUnit" su
  JOIN ancestors a ON su.id = a."parentId"
)
SELECT "workCenterId"
FROM ancestors
WHERE "workCenterId" IS NOT NULL
LIMIT 1;
```

## Relationships

```
pickingList
  └── pickingListLine (1:many)
        ├── pickingListLineTrackedEntity (1:many)
        ├── jobMaterial (FK)
        ├── jobOperation (FK, for kit grouping)
        ├── job (FK)
        └── storageUnit (FK, source)

storageUnit
  └── workCenterId (FK → workCenter, nullable, inherited from parent)
```

## Indexes

- `pickingList`: (companyId), (status, companyId), (assignee, companyId), (locationId, companyId)
- `pickingListLine`: (pickingListId), (jobId), (jobOperationId), (itemId), (storageUnitId), (companyId)
- `pickingListLineTrackedEntity`: (pickingListLineId), (trackedEntityId)

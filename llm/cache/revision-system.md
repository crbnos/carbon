# Revision System

## Overview

Carbon implements a revision system for items (Parts, Materials, Tools, Consumables, Fixtures) allowing multiple revisions of the same item to coexist. The revision system was introduced in migration `20250519122022_revisions.sql` and refined in `20250620124424_revisions-fix.sql`.

## Item Revision Structure

### Item Table Columns

The `item` table has the following revision-related columns:

- `readableId`: TEXT - The base identifier for the item (e.g., "P-1001")
- `revision`: TEXT - The revision identifier (default '0')
- `readableIdWithRevision`: TEXT - Generated column that combines readableId with revision
  - Formula: `readableId || CASE WHEN revision = '0' THEN '' WHEN revision = '' THEN '' ELSE '.' || revision END`
  - Examples: "P-1001" (revision 0), "P-1001.A" (revision A)

### Unique Constraint

Items have a unique constraint on: `(readableId, revision, companyId, type)`

This means:
- Multiple items can share the same `readableId` as long as they have different revisions
- Each revision must be unique within a company and item type
- The default revision is '0'

## Revision Views and Functions

### Latest Item Pattern

All item views (parts, materials, tools, consumables) use a "latest items" CTE pattern that selects the most recent revision:

```sql
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId")
    i.*
  FROM "item" i
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
)
```

This ensures that by default, users see only the latest revision of each item.

### Revisions Array

Views and detail functions include a `revisions` JSON array containing all revisions for an item:

```sql
item_revisions AS (
  SELECT
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY i."createdAt"
    ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
```

## Item-Type Tables Relationship

The relationship between `item` and type-specific tables (part, material, tool, consumable) changed with the revision system:

### Before Revisions
- `part.itemId` → Foreign key to `item.id`
- One part record per item

### After Revisions
- `part.id` = `item.readableId` (not item.id!)
- Multiple item records can reference the same part record via `item.readableId = part.id`
- The part/material/tool/consumable table stores properties shared across all revisions
- The item table stores revision-specific properties

### Join Pattern

Views join using `readableId` and `companyId`:

```sql
FROM "part" p
INNER JOIN latest_items li ON li."readableId" = p."id" AND li."companyId" = p."companyId"
```

## Item Cost and Revisions

### ItemCost Table Structure

Created in migration `20230330024716_parts.sql`:

```sql
CREATE TABLE "itemCost" (
  "itemId" TEXT NOT NULL,  -- References item.id
  "itemPostingGroupId" TEXT,
  "costingMethod" "itemCostingMethod" NOT NULL,
  "standardCost" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "unitCost" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "costIsAdjusted" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  ...
)
```

**Key Points:**
- `itemCost.itemId` references `item.id` (the specific revision's UUID)
- Each item revision gets its own itemCost record
- Created automatically via trigger when a new item is inserted:

```sql
CREATE FUNCTION public.create_item_related_records()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."itemCost"("itemId", "costingMethod", "createdBy", "companyId")
  VALUES (new.id, 'FIFO', new."createdBy", new."companyId");

  INSERT INTO public."itemReplenishment"("itemId", "createdBy", "companyId")
  VALUES (new.id, new."createdBy", new."companyId");

  INSERT INTO public."itemUnitSalePrice"("itemId", "currencyCode", "createdBy", "companyId")
  VALUES (new.id, 'USD', new."createdBy", new."companyId");

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Costing Methods

Available costing methods (enum `itemCostingMethod`):
- Standard
- Average
- LIFO
- FIFO

### Cost Fields

- `standardCost`: The predetermined cost
- `unitCost`: The current/calculated unit cost
- `costIsAdjusted`: Whether the cost has been manually adjusted

## Tracked Entities and Revisions

### Tracked Entity System

The system evolved from serial/batch tracking to a more flexible tracked entity system:

**Migration Timeline:**
1. `20250209000952_item_tracking.sql` - Introduced `itemTracking` table with serialNumber/batchNumber
2. `20250225145619_tracked-entities.sql` - Replaced with flexible `trackedEntity` system

### TrackedEntity Table Structure

```sql
CREATE TABLE "trackedEntity" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quantity" NUMERIC NOT NULL,
  "status" "trackedEntityStatus" NOT NULL DEFAULT 'Available',
  "sourceDocument" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "sourceDocumentReadableId" TEXT,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "companyId" TEXT NOT NULL,
  ...
)
```

**Key Points:**
- `sourceDocumentId` references `item.id` (the specific revision UUID)
- `sourceDocumentReadableId` stores the item's `readableId` (without revision)
- `attributes` is a JSONB field that can store:
  - Serial Number
  - Batch Number
  - Manufacturing Date
  - Expiration Date
  - Receipt information
  - Supplier information
  - Custom properties

### Item Ledger Integration

```sql
ALTER TABLE "itemLedger" ADD COLUMN "trackedEntityId" TEXT;
ALTER TABLE "itemLedger" ADD CONSTRAINT "itemLedger_trackedEntityId_fkey"
  FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

Each inventory transaction can be linked to a specific tracked entity.

## Converting Tracked Entities Between Revisions

### Current Approach

When tracked entities need to be converted between revisions (e.g., raw material → finished part):

1. **TrackedActivity System**: Records transformation activities
2. **TrackedActivityInput**: Links input entities (consumed)
3. **TrackedActivityOutput**: Links output entities (produced)

```sql
CREATE TABLE "trackedActivity" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "type" TEXT NOT NULL,
  "sourceDocument" TEXT,
  "sourceDocumentId" TEXT,
  "sourceDocumentReadableId" TEXT,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  ...
)

CREATE TABLE "trackedActivityInput" (
  "trackedActivityId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "entityType" TEXT NOT NULL,
  ...
)

CREATE TABLE "trackedActivityOutput" (
  "trackedActivityId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  ...
)
```

### Conversion Pattern

To convert tracked entities between item revisions:

1. Create a `trackedActivity` record with:
   - `type`: Describes the transformation (e.g., "Manufacturing", "Assembly")
   - `sourceDocumentId`: References the job, operation, or process
   - `attributes`: Stores additional context

2. Create `trackedActivityInput` records:
   - Link consumed tracked entities (e.g., raw materials)
   - Specify quantity consumed

3. Create `trackedActivityOutput` records:
   - Create new tracked entities for produced items
   - `sourceDocumentId` references the new item revision's UUID
   - `sourceDocumentReadableId` stores the item's readableId
   - Inherit or derive attributes from inputs

4. Update item ledgers:
   - Deduct consumed quantities (negative ledger entries)
   - Add produced quantities (positive ledger entries)
   - Link both to appropriate `trackedEntityId`

### Example: Material to Part Conversion

When manufacturing a part from raw material:

```sql
-- 1. Create activity
INSERT INTO "trackedActivity" (type, sourceDocument, sourceDocumentId, attributes, companyId, createdBy)
VALUES ('Manufacturing', 'Job', job_id, '{"operation": "Machining"}', company_id, user_id)
RETURNING id INTO activity_id;

-- 2. Record input (material consumed)
INSERT INTO "trackedActivityInput" (trackedActivityId, trackedEntityId, quantity, entityType, companyId, createdBy)
VALUES (activity_id, material_tracked_entity_id, consumed_qty, 'Material', company_id, user_id);

-- 3. Create output tracked entity (part produced)
INSERT INTO "trackedEntity" (quantity, status, sourceDocument, sourceDocumentId, sourceDocumentReadableId, attributes, companyId, createdBy)
VALUES (
  produced_qty,
  'Available',
  'Item',
  part_item_id,  -- The specific revision UUID
  part_readable_id,  -- Base readable ID
  jsonb_build_object('Serial Number', serial_num, 'Job', job_id),
  company_id,
  user_id
)
RETURNING id INTO output_tracked_entity_id;

-- 4. Record output
INSERT INTO "trackedActivityOutput" (trackedActivityId, trackedEntityId, quantity, companyId, createdBy)
VALUES (activity_id, output_tracked_entity_id, produced_qty, company_id, user_id);

-- 5. Update ledgers
-- Deduct material
INSERT INTO "itemLedger" (itemId, quantity, trackedEntityId, documentType, locationId, companyId, createdBy)
VALUES (material_item_id, -consumed_qty, material_tracked_entity_id, 'Job Material', location_id, company_id, user_id);

-- Add part
INSERT INTO "itemLedger" (itemId, quantity, trackedEntityId, documentType, locationId, companyId, createdBy)
VALUES (part_item_id, produced_qty, output_tracked_entity_id, 'Job Production', location_id, company_id, user_id);
```

## Key Constraints and Behaviors

### On Item Deletion
- `itemCost` records CASCADE delete when item is deleted
- `trackedEntity` records SET NULL on itemLedger when deleted
- All related records (replenishment, planning, methods) CASCADE delete

### Make Method Trigger

When a Part or Tool item is created, a `makeMethod` record is automatically created:

```sql
CREATE FUNCTION public.create_make_method_related_records()
RETURNS TRIGGER AS $$
BEGIN
  IF new.type IN ('Part', 'Tool') THEN
    INSERT INTO public."makeMethod"("itemId", "createdBy", "companyId")
    VALUES (new.id, new."createdBy", new."companyId");
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

This triggers for each revision, so each part/tool revision gets its own manufacturing method.

## Common Queries

### Get All Revisions of an Item

```sql
SELECT id, revision, name, active, createdAt
FROM item
WHERE readableId = 'P-1001'
  AND companyId = 'company-id'
ORDER BY createdAt;
```

### Get Latest Revision

```sql
SELECT DISTINCT ON (readableId) *
FROM item
WHERE readableId = 'P-1001'
  AND companyId = 'company-id'
ORDER BY readableId, createdAt DESC;
```

### Get Item Cost for Specific Revision

```sql
SELECT ic.*
FROM "itemCost" ic
JOIN item i ON i.id = ic."itemId"
WHERE i."readableId" = 'P-1001'
  AND i.revision = 'A'
  AND i."companyId" = 'company-id';
```

### Get Tracked Entities for Item (All Revisions)

```sql
SELECT te.*
FROM "trackedEntity" te
JOIN item i ON i.id = te."sourceDocumentId"
WHERE te."sourceDocument" = 'Item'
  AND i."readableId" = 'P-1001'
  AND te."companyId" = 'company-id';
```

### Get Tracked Entities for Specific Revision

```sql
SELECT te.*
FROM "trackedEntity" te
WHERE te."sourceDocument" = 'Item'
  AND te."sourceDocumentId" = (
    SELECT id FROM item
    WHERE "readableId" = 'P-1001'
      AND revision = 'B'
      AND "companyId" = 'company-id'
  );
```

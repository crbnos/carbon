# Inventory System

## Overview

Carbon's inventory system tracks material and item quantities across different locations and stages of the manufacturing process.

## Key Functions

### get_inventory_quantities

The `get_inventory_quantities` function is a PostgreSQL function that returns inventory information for items at a specific location. It was last updated in migration `20250724195443_update-inventory-quantities-material-properties.sql`.

**Parameters:**
- `company_id`: TEXT - The company identifier
- `location_id`: TEXT - The location identifier

**Returns a table with the following columns:**
- `id`: TEXT - Item ID
- `readableId`: TEXT - Human-readable item ID
- `readableIdWithRevision`: TEXT - Readable ID with revision
- `name`: TEXT - Item name
- `active`: BOOLEAN - Whether the item is active
- `type`: itemType - Item type enum
- `itemTrackingType`: itemTrackingType - Tracking type enum
- `replenishmentSystem`: itemReplenishmentSystem - Replenishment system enum
- `materialSubstanceId`: TEXT - Material substance ID (e.g., steel, aluminum)
- `materialFormId`: TEXT - Material form ID (e.g., sheet, plate, round bar)
- `dimensionId`: TEXT - Material dimension ID
- `dimension`: TEXT - Dimension name
- `finishId`: TEXT - Material finish ID
- `finish`: TEXT - Finish name
- `gradeId`: TEXT - Material grade ID
- `grade`: TEXT - Grade name
- `materialType`: TEXT - Material type name
- `materialTypeId`: TEXT - Material type ID
- `thumbnailPath`: TEXT - Path to thumbnail image
- `unitOfMeasureCode`: TEXT - Unit of measure code
- `quantityOnHand`: NUMERIC - Current inventory quantity
- `quantityOnSalesOrder`: NUMERIC - Quantity committed to sales orders
- `quantityOnPurchaseOrder`: NUMERIC - Quantity on purchase orders
- `quantityOnProductionOrder`: NUMERIC - Quantity on production orders
- `quantityOnProductionDemand`: NUMERIC - Quantity demanded for production

The function aggregates quantities from:
- Item ledger entries (for on-hand inventory)
- Open sales orders (status: Confirmed, To Ship and Invoice, To Ship, To Invoice, In Progress)
- Open purchase orders (status: Planned, To Receive, To Receive and Invoice)
- Open production jobs (status: Planned, Ready, In Progress, Paused)
- Open job material requirements

The function excludes non-inventory items and includes material property information by joining with:
- `material` table for base material information
- `materialDimension` table for dimension names
- `materialFinish` table for finish names
- `materialGrade` table for grade names
- `materialType` table for material type names

## TypeScript Types

The function's TypeScript types are defined in:
- `/packages/database/src/types.ts`
- `/packages/database/supabase/functions/lib/types.ts`

Both files include the complete type definition for the function's arguments and return values in the `Database["public"]["Functions"]` interface.

## Usage

This function is primarily used by:
- Inventory module (`/apps/erp/app/modules/inventory/inventory.service.ts`)
- Items module (`/apps/erp/app/modules/items/items.service.ts`)

It provides a comprehensive view of inventory levels and commitments for materials tracking.
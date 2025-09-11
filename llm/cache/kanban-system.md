# Kanban System

## Overview

Carbon's kanban system manages replenishment cards for inventory items across different locations and shelves. It supports both "Buy" and "Make" replenishment systems for streamlined inventory management.

## Database Structure

### Table: `kanban`

Created in migration `20250909012102_kanban.sql`:

**Fields:**

- `id`: TEXT (PRIMARY KEY, default: id('kb')) - Unique kanban identifier
- `itemId`: TEXT (FOREIGN KEY to item.id) - Associated item
- `replenishmentSystem`: itemReplenishmentSystem ENUM (default: 'Buy') - "Buy", "Make", or "Buy and Make"
- `quantity`: INTEGER - Kanban quantity
- `locationId`: TEXT (FOREIGN KEY to location.id) - Storage location
- `shelfId`: TEXT (FOREIGN KEY to shelf.id, optional) - Specific shelf location
- `companyId`: TEXT (FOREIGN KEY to company.id) - Company association
- `createdAt`: TIMESTAMP WITH TIME ZONE (default: NOW())
- `createdBy`: TEXT (FOREIGN KEY to user.id) - Creator
- `updatedAt`: TIMESTAMP WITH TIME ZONE
- `updatedBy`: TEXT (FOREIGN KEY to user.id) - Last updater

**Indexes:**

- `kanban_itemId_idx` on `itemId`
- `kanban_locationId_idx` on `(companyId, locationId)`
- `kanban_companyId_idx` on `companyId`

**Row Level Security:**

- SELECT: Company employees with any role
- INSERT: Requires `inventory_create` permission
- UPDATE: Requires `inventory_update` permission
- DELETE: Requires `inventory_delete` permission

### View: `kanbans`

A security-invoker view that joins kanban data with item and location information:

```sql
SELECT
  k.*,
  i.name,
  i.readableIdWithRevision,
  l.name as locationName
FROM kanban k
JOIN item i ON k.itemId = i.id
JOIN location l ON k.locationId = l.id
```

## TypeScript Types and Validation

### Zod Validator (`kanbanValidator`)

Located in `/apps/erp/app/modules/inventory/inventory.models.ts`:

```typescript
const kanbanValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  replenishmentSystem: z.enum(replenishmentSystemTypes).default("Buy"),
  quantity: zfd.numeric(
    z.number().int().min(1, { message: "Quantity must be at least 1" })
  ),
  locationId: z.string().min(1, { message: "Location is required" }),
  shelfId: zfd.text(z.string().optional()),
});
```

### TypeScript Types

- `Kanban` type defined in `/apps/erp/app/modules/inventory/types.ts`
- Type generated from `getKanbans` service function return data

## Service Functions

### Core Functions

Located in `/apps/erp/app/modules/inventory/inventory.service.ts`:

- **`getKanbans(client, locationId, companyId, args)`** - Get paginated kanbans for location with search
- **`getKanban(client, kanbanId)`** - Get single kanban with item and location details
- **`upsertKanban(client, kanban)`** - Create or update kanban record
- **`deleteKanban(client, kanbanId)`** - Delete kanban record

### Service Features

- Search functionality across item name and readable ID with revision
- Generic query filters support (pagination, sorting, filtering)
- Joins with item and location data for enriched views

## UI Components

### KanbanForm

Located at `/apps/erp/app/modules/inventory/ui/Kanbans/KanbanForm.tsx`:

- Form for creating/editing kanbans
- Supports item selection, location/shelf assignment
- Replenishment system selection (Buy/Make/Buy and Make)
- Quantity input validation

### KanbansTable

Located at `/apps/erp/app/modules/inventory/ui/Kanbans/KanbansTable.tsx`:

- Table view of kanbans with search and filtering
- Column visibility controls
- Action buttons for edit/delete/QR code generation
- Location filtering support

## Routes and API

### Frontend Routes

- `/x/inventory/kanbans` - Main kanbans list page
- `/x/inventory/kanbans/new` - Create new kanban
- `/x/inventory/kanbans/:id` - View/edit kanban details
- `/x/inventory/kanbans/delete/:id` - Delete kanban confirmation

### API Routes

- `/api/kanban/:id` - Kanban API endpoint (handles replenishment logic)
- `/file/kanban/:id.png` - QR code generation for kanban

## QR Code Integration

### QR Code Generation

- Route: `/file/kanban/:id.png`
- Generates QR code pointing to `/api/kanban/:id`
- Uses `@carbon/documents/qr` package
- 36px size with PNG format
- Cached with max-age headers

### QR Code Usage

- Available as action in KanbansTable
- Generates scannable codes for physical kanban cards
- Links to API endpoint for replenishment processing

## Replenishment System Integration

### API Handler (`/api/kanban/:id`)

- Validates kanban access and company association
- Routes based on replenishment system:
  - **"Make"** - Production order creation logic (placeholder)
  - **"Buy"** - Purchase order creation logic (placeholder)
  - **"Buy and Make"** - Not yet supported (throws error)
- Currently redirects to authenticated root after processing

### Replenishment Types

Defined in `replenishmentSystemTypes`:

- `"Buy"` - Purchase-based replenishment
- `"Make"` - Production-based replenishment
- `"Buy and Make"` - Hybrid approach (not implemented)

## Path Configuration

Kanban-related paths defined in `/apps/erp/app/utils/path.ts`:

```typescript
api: {
  kanban: (id: string) => `/api/kanban/${id}`
}
file: {
  kanbanQrCode: (id: string) => `/file/kanban/${id}.png`
}
to: {
  kanbans: '/x/inventory/kanbans',
  kanban: (id: string) => `/x/inventory/kanbans/${id}`,
  newKanban: '/x/inventory/kanbans/new',
  deleteKanban: (id: string) => `/x/inventory/kanbans/delete/${id}`
}
```

## Integration Points

### Inventory Module

- Part of the inventory module structure
- Integrated with location and shelf management
- Connected to item management system
- Uses company-based multi-tenancy

### Permissions

- Requires inventory permissions for CRUD operations
- Uses RLS policies for data security
- Integrates with user/company permission system

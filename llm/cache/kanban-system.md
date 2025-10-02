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
- Location filtering support
- Displays columns:
  - Item (with thumbnail, name, and readable ID)
  - Job badge (shows active job if exists, with pulsing dot)
  - Action links (Create/Start/Complete based on kanbanOutput setting)
  - Reorder Qty (with unit of measure)
  - Replenishment system (Buy/Make)
  - Supplier (for Buy kanbans)
  - Shelf name
  - Auto Release checkbox (Make only)
  - Auto Start checkbox (Make only)
  - Created by/at, Updated by/at
- Context menu actions:
  - Edit kanban
  - Delete kanban
- Bulk actions:
  - Print labels for selected kanbans
- Primary actions:
  - Location selector (hard refresh on change)
  - Settings button (links to inventory settings)
  - New Kanban button

## Routes and API

### Frontend Routes

- `/x/inventory/kanbans` - Main kanbans list page
- `/x/inventory/kanbans/new` - Create new kanban
- `/x/inventory/kanbans/:id` - View/edit kanban details
- `/x/inventory/kanbans/delete/:id` - Delete kanban confirmation

### API Routes

- `/api/kanban/:id` - Main kanban API endpoint (handles replenishment logic)
- `/api/kanban/collision/:id` - Handles kanban job collision (when kanban already has active job)
- `/api/kanban/start/:id` - Starts next operation for kanban job
- `/api/kanban/complete/:id` - Completes current operation for kanban job
- `/api/kanban/link/:id` - Links kanban to job
- `/file/kanban/:id/:action.png` - QR code generation for kanban actions
- `/file/kanban/labels/:action.pdf?ids=` - PDF label generation for kanbans

## QR Code Integration

### QR Code Generation

- Route: `/file/kanban/:id/:action.png` where action is "order", "start", or "complete"
- Generates QR code pointing to corresponding API endpoints:
  - "order" -> `/api/kanban/:id` (creates job/order)
  - "start" -> `/api/kanban/start/:id` (starts operation)
  - "complete" -> `/api/kanban/complete/:id` (completes operation)
- Uses `@carbon/documents/qr` package
- 36px size with PNG format
- Cached with max-age headers

### QR Code Usage

- Available as action in KanbansTable based on kanbanOutput setting
- Three action types available:
  - **order/Create** - QR code to create a job (Make) or purchase order (Buy)
  - **start/Start** - QR code to start next operation (Make only)
  - **complete/Complete** - QR code to complete current operation (Make only)
- Generates scannable codes for physical kanban cards
- Links to API endpoint for replenishment processing
- Start and Complete actions only shown for "Make" replenishment system

### Kanban Output Types

Three kanban output types defined in settings (`kanbanOutputTypes`):

1. **label** - PDF labels with QR codes
2. **qrcode** - QR codes displayed in hover cards
3. **url** - Copyable URLs for the actions

### Label PDF Generation

Located at `/apps/erp/app/routes/file+/kanban+/labels.$action[.]pdf.tsx`

- Generates PDF labels using `@carbon/documents/pdf` KanbanLabelPDF component
- Accepts comma-separated kanban IDs via query parameter `?ids=`
- Action parameter determines which API endpoint the QR code points to ("order", "start", or "complete")
- Currently generates same label design for all actions (no color differentiation)
- Label layout:
  - 2x3 grid (6 labels per letter-size page)
  - QR code and item thumbnail
  - Item name and readable ID
  - Location/shelf name
  - Quantity with unit of measure
  - Supplier name at bottom
- Fetches item thumbnails in parallel and converts to base64
- No color coding currently implemented for different action types

## Replenishment System Integration

### API Handler (`/api/kanban/:id`)

Located at `/apps/erp/app/routes/api+/kanban.$id.tsx`

- Validates kanban access and company association
- Routes based on replenishment system:
  - **"Make"** - Creates production job with:
    - Auto-generated job ID from sequence
    - Copies quantity, location, shelf from kanban
    - Creates job method from item
    - Associates kanban with job
    - Optional auto-release (triggers MRP, scheduling)
    - Optional auto-start (redirects to MES operation start)
    - Redirects to job or MES operation page
  - **"Buy"** - Creates/adds to purchase order:
    - Finds or creates draft purchase order for supplier
    - Adds purchase order line with kanban quantity
    - Uses supplier pricing or item cost
    - Sets location/shelf from kanban or item defaults
    - Redirects to purchase order page
  - **"Buy and Make"** - Not yet supported (throws error)

### Replenishment Types

Defined in `replenishmentSystemTypes`:

- `"Buy"` - Purchase-based replenishment
- `"Make"` - Production-based replenishment
- `"Buy and Make"` - Hybrid approach (not implemented)

### Kanban Collision Handling

- When a "Make" kanban already has an active job (jobReadableId exists), scanning the "order" QR code redirects to `/api/kanban/collision/:id`
- Prevents creating duplicate jobs for the same kanban
- Allows user to navigate to existing job instead

## Path Configuration

Kanban-related paths defined in `/apps/erp/app/utils/path.ts`:

```typescript
api: {
  kanban: (id: string) => `/api/kanban/${id}`,
  kanbanCollision: (id: string) => `/api/kanban/collision/${id}`,
  kanbanComplete: (id: string) => `/api/kanban/complete/${id}`,
  kanbanJobLink: (id: string) => `/api/kanban/link/${id}`,
  kanbanStart: (id: string) => `/api/kanban/start/${id}`
}
file: {
  kanbanLabelsPdf: (ids: string | string[], action: "order" | "start" | "complete") =>
    `/file/kanban/labels/${action}.pdf?ids=${ids}`,
  kanbanQrCode: (id: string, action: "order" | "start" | "complete") =>
    `/file/kanban/${id}/${action}.png`
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

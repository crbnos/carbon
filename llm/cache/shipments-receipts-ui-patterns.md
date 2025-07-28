# Shipments, Receipts, and Warehouse Transfers UI Patterns

## Overview

Shipments, receipts, and warehouse transfers in Carbon follow a consistent pattern with a header-detail structure, where the main document has associated line items. All three use similar UI patterns for forms, line item management, and status workflows.

## Route Structure

### Shipments
- List view: `/routes/x+/inventory+/shipments.tsx`
- Detail routes: `/routes/x+/shipment+/`
  - `$shipmentId.tsx` - Main layout with header
  - `$shipmentId._index.tsx` - Redirects to details
  - `$shipmentId.details.tsx` - Form and lines view
  - `$shipmentId.post.tsx` - Posting action
  - `$shipmentId.delete.tsx` - Delete action
  - `lines.update.tsx` - Update line items
  - `lines.tracking.tsx` - Tracking management
  - `lines.split.tsx` - Split line items
  - `new.tsx` - Create new shipment

### Receipts
- List view: `/routes/x+/inventory+/receipts.tsx`
- Detail routes: `/routes/x+/receipt+/`
  - `$receiptId.tsx` - Main layout with header
  - `$receiptId._index.tsx` - Redirects to details
  - `$receiptId.details.tsx` - Form and lines view
  - `$receiptId.post.tsx` - Posting action
  - `$receiptId.delete.tsx` - Delete action
  - `lines.update.tsx` - Update line items
  - `lines.tracking.tsx` - Tracking management
  - `lines.split.tsx` - Split line items
  - `new.tsx` - Create new receipt

### Warehouse Transfers
- List view: `/routes/x+/inventory+/warehouse-transfers.tsx`
- Detail routes: `/routes/x+/warehouse-transfer+/`
  - `$transferId.tsx` - Main layout with header (current implementation)
  - `$transferId._index.tsx` - Redirects to details (new)
  - `$transferId.details.tsx` - Form and lines view (new)
  - `$transferId.lines.tsx` - Lines management (new)
  - `$transferId.status.tsx` - Status updates (new)
  - `$transferId.update.tsx` - Update transfer (new)
  - `new.tsx` - Create new transfer

## UI Components Structure

### Common Pattern
Both shipments and receipts follow this component structure:

1. **Header Component** (`ShipmentHeader`/`ReceiptHeader`)
   - Displays status badge
   - Shows key information (ID, dates, etc.)
   - Contains action buttons (Post, Delete, etc.)

2. **Form Component** (`ShipmentForm`/`ReceiptForm`)
   - Card-based layout
   - Grid layout for fields (2 columns on desktop)
   - Source document selection with dependent ID field
   - Location selection
   - Custom fields support
   - Delete functionality in dropdown menu (when not posted)

3. **Lines Component** (`ShipmentLines`/`ReceiptLines`)
   - Card with list of line items
   - Each line item shows:
     - Item thumbnail and details
     - Quantities (ordered/shipped/received/outstanding)
     - Shelf selection (context-dependent)
     - Action menu (split, delete)
   - Inline editing of quantities
   - Tracking support (batch/serial)
   - Real-time updates using fetchers

4. **Notes Component**
   - Rich text editor for internal/external notes
   - Shipments have both internal and external notes
   - Receipts only have internal notes

## Key Features

### Line Item Management
- **Inline Editing**: Quantities and shelves can be edited directly
- **Split Functionality**: Lines can be split into multiple lines
- **Tracking**: Support for batch and serial number tracking
- **Validation**: Real-time validation of quantities and tracking numbers
- **Shelf Assignment**: Automatic or manual shelf assignment

### Status Management
- Documents have status workflows (Draft → Posted)
- Posted documents become read-only
- Status affects available actions

### Source Document Integration
- Links to source documents (Sales Orders, Purchase Orders)
- Automatically populates line items from source
- Validates against source document quantities

## Refactoring Warehouse Transfers to Match

To refactor warehouse transfers to match this pattern:

1. **Route Structure**: Create similar route structure under `/routes/x+/warehouse-transfer+/`
   - Add `$transferId._index.tsx` to redirect to details
   - Add `$transferId.details.tsx` for main form/lines view
   - Add line management routes (update, split, etc.)

2. **Update Layout**: The current `$transferId.tsx` should follow the panel provider pattern

3. **Refactor Form**: `WarehouseTransferForm` should:
   - Use consistent Card layout
   - Add dropdown menu for actions
   - Support custom fields

4. **Transform Lines Component**: Replace table view with inline editable cards:
   - Show item details with thumbnails
   - Add quantity editing (transferred/shipped/received)
   - Add shelf selection for both from/to locations
   - Add split/delete functionality
   - Support tracking numbers

5. **Add Notes Component**: Include internal notes support

6. **Status Workflow**: Implement proper status management (Draft → Shipped → Received)

## Warehouse Transfer Data Models

### WarehouseTransfer Fields
**Main Transfer Document:**
- `id` - Unique identifier (auto-generated)
- `transferId` - User-friendly ID (e.g., "WT000001")
- `fromLocationId` - Source location (required)
- `toLocationId` - Destination location (required)
- `status` - Transfer status (see status types below)
- `transferDate` - Date of transfer initiation
- `expectedReceiptDate` - Expected arrival date
- `notes` - Internal notes
- `reference` - External reference number
- `customFields` - JSONB for custom data
- `tags` - Text array for categorization
- Audit fields: `companyId`, `createdBy`, `createdAt`, `updatedBy`, `updatedAt`

**Status Types:**
- `Draft` - Editable, not yet processed
- `To Ship and Receive` - Ready for both shipping and receiving
- `To Ship` - Needs to be shipped
- `To Receive` - Shipped, awaiting receipt
- `Completed` - Fully processed
- `Cancelled` - Cancelled transfer

### WarehouseTransferLine Fields
**Transfer Line Items:**
- `id` - Unique line identifier
- `transferId` - Parent transfer reference
- `itemId` - Item being transferred (required)
- `quantity` - Total quantity to transfer (required, > 0)
- `shippedQuantity` - Amount shipped (default 0)
- `receivedQuantity` - Amount received (default 0)
- `fromLocationId` - Source location (required)
- `fromShelfId` - Source shelf (optional)
- `toLocationId` - Destination location (required)
- `toShelfId` - Destination shelf (optional)
- `unitOfMeasureCode` - Unit of measure
- `notes` - Line-specific notes
- `customFields` - JSONB for custom line data
- Audit fields: `companyId`, `createdBy`, `createdAt`, `updatedBy`, `updatedAt`

### Editability Rules by Status
**Draft Status:**
- All fields editable
- Can add/remove lines
- Can change locations and shelves
- Can modify quantities

**To Ship and Receive / To Ship:**
- Transfer details (dates, reference, notes) editable
- Line quantities may be restricted
- Location changes typically not allowed
- Shelf assignments may be editable

**To Receive:**
- Most fields read-only
- Receiving quantities editable
- Destination shelf assignment editable

**Completed / Cancelled:**
- All fields read-only
- No modifications allowed

## Data Flow Patterns

### Optimistic Updates
- Uses Remix fetchers for optimistic UI updates
- Pending changes merged with server data
- Real-time feedback without full page reloads

### Validation
- Form-level validation using Zod schemas
- Inline validation for quantities and tracking
- Server-side validation on submission

### Error Handling
- Flash messages for server errors
- Inline error display for field validation
- Graceful handling of concurrent updates
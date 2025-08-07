# Purchasing Conversion Factors System

## Overview

Carbon's purchasing system includes comprehensive support for conversion factors to handle different units of measure between inventory tracking and purchasing transactions. This system allows items to be purchased in one unit of measure while being tracked in inventory in a different unit.

## Database Structure

### Core Tables with Conversion Factor Support

#### Supplier Quote Lines (`supplierQuoteLine`)
- `conversionFactor`: NUMERIC(10,5) NOT NULL DEFAULT 1
- `inventoryUnitOfMeasureCode`: Unit used for inventory tracking
- `purchaseUnitOfMeasureCode`: Unit used for purchasing from supplier
- Created in migration: `20241202192419_supplier-quotes.sql`

#### Purchase Order Lines (`purchaseOrderLine`)
- `conversionFactor`: NUMERIC(10,2) DEFAULT 1
- Added in migration: `20240402052512_purchasing-conversion-factors.sql`

#### Purchase Invoice Lines (`purchaseInvoiceLine`)
- `conversionFactor`: NUMERIC(10,2) DEFAULT 1
- Added in migration: `20240402052512_purchasing-conversion-factors.sql`

#### Receipt Lines (`receiptLine`)
- `conversionFactor`: NUMERIC(10,2) DEFAULT 1
- Added in migration: `20240402052512_purchasing-conversion-factors.sql`

## UI Implementation

### ConversionFactor Component
**Location**: `/apps/erp/app/components/Form/ConversionFactor.tsx`

**Key Features**:
- Interactive modal-based UI for setting conversion factors
- Bidirectional conversion direction switching (inventory-to-purchased / purchased-to-inventory)
- Automatic calculation and display of conversion relationships
- Visual explanation: "There are X inventory units in one purchased unit"
- Disabled when inventory and purchase units are the same (defaults to 1)

**Usage Example**:
```typescript
<ConversionFactor
  name="conversionFactor"
  purchasingCode={itemData.purchaseUom}
  inventoryCode={itemData.inventoryUom}
  value={itemData.conversionFactor}
  onChange={(value) => setConversionFactor(value)}
/>
```

## Unit Price Calculations

### Supplier Quote Line Pricing
**Location**: `/apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteLinePricing.tsx`

**Key Calculation** (Line 250):
```typescript
const inventoryUnitPrice = supplierUnitPrice * exchangeRate / conversionFactor;
```

**Explanation**:
1. **Supplier Unit Price**: Price per purchase unit (e.g., $100 per case)
2. **Exchange Rate**: Currency conversion (e.g., 1.25 USD per CAD)
3. **Conversion Factor**: Units conversion (e.g., 12 pieces per case)
4. **Result**: Price per inventory unit (e.g., $100 * 1.25 / 12 = $10.42 per piece)

### Price Display Structure
- **Supplier Unit Price**: Shows price in purchase UOM with supplier currency
- **Unit Price**: Shows converted price in inventory UOM with base currency
- **Conversion Factor**: Applied to convert between purchase and inventory pricing

## Workflow Integration

### Supplier Quote to Purchase Order Flow
1. Supplier quotes capture conversion factors during line creation
2. Conversion factors are automatically inherited when creating purchase orders from quotes
3. Unit prices are recalculated using the conversion factor for inventory costing

### Purchase Order to Receipt Flow
1. Purchase order lines maintain conversion factors for receiving
2. Receipt lines inherit conversion factors to properly convert received quantities
3. Inventory quantities are updated using converted amounts

### Purchase Invoice Processing
1. Invoice lines include conversion factors for accurate cost allocation
2. Unit costs are calculated using converted prices for inventory valuation

## Business Logic

### Automatic Conversion Factor Detection
When selecting items in purchasing forms:
1. System checks for existing supplier parts with pre-defined conversion factors
2. Loads item's default inventory unit of measure
3. Loads supplier's preferred purchase unit of measure
4. Sets conversion factor from supplier part relationship or defaults to 1

### Validation Rules
- Conversion factor must be greater than 0
- Defaults to 1 when inventory and purchase units are identical
- Required for all purchasing transactions to maintain unit consistency

## Data Models

### Supplier Quote Line Validator
```typescript
export const supplierQuoteLineValidator = z.object({
  conversionFactor: zfd.numeric(z.number().optional()),
  inventoryUnitOfMeasureCode: zfd.text(z.string().min(1)),
  purchaseUnitOfMeasureCode: zfd.text(z.string().min(1)),
  // ... other fields
});
```

### Purchase Order Line Validator
```typescript
export const purchaseOrderLineValidator = z.object({
  conversionFactor: zfd.numeric(z.number().optional()),
  inventoryUnitOfMeasureCode: zfd.text(z.string().optional()),
  purchaseUnitOfMeasureCode: zfd.text(z.string().optional()),
  // ... other fields
});
```

## Key Benefits

1. **Flexible Purchasing**: Buy in bulk units (cases, rolls, etc.) while tracking individual units
2. **Accurate Costing**: Proper unit cost calculation for inventory valuation
3. **Supplier Integration**: Support supplier-specific units of measure
4. **Audit Trail**: Complete traceability of unit conversions throughout purchase-to-pay cycle
5. **Multi-Currency Support**: Works in conjunction with exchange rates for international purchasing

## Example Scenarios

### Scenario 1: Bulk Purchase with Individual Tracking
- **Item**: Screws
- **Inventory UOM**: Each (EA)
- **Purchase UOM**: Box
- **Conversion Factor**: 100 (100 screws per box)
- **Supplier Price**: $50 per box
- **Inventory Unit Cost**: $50 ÷ 100 = $0.50 per screw

### Scenario 2: Material Purchase with Different Measurements  
- **Item**: Steel Sheet
- **Inventory UOM**: Square Feet (SF)
- **Purchase UOM**: Square Meters (SM)
- **Conversion Factor**: 10.764 (10.764 SF per SM)
- **Supplier Price**: €25 per SM
- **Inventory Unit Cost**: €25 ÷ 10.764 = €2.32 per SF
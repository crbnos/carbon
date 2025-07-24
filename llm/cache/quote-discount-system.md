# Quote Discount System

## Overview
The Carbon ERP system includes discount functionality at the quote line price level, not at the quote header or quote line level directly.

## Database Structure

### Quote Table
- No discount fields exist on the `quote` table itself
- Located in migration: `20240715024405_quotes.sql`

### Quote Line Table (`quoteLine`)
- No discount fields exist on the `quoteLine` table itself
- Contains: `additionalCharges`, `taxPercent`, but no discount fields

### Quote Line Price Table (`quoteLinePrice`)
- Contains the discount functionality
- Located in migration: `20240715134816_quote-pricing.sql`
- Key fields:
  - `discountPercent`: NUMERIC(10,5) NOT NULL DEFAULT 0
  - `unitPrice`: NUMERIC(10,5) NOT NULL DEFAULT 0
  - `quantity`: NUMERIC(10,5) NOT NULL DEFAULT 1
  - `leadTime`: NUMERIC(10,5) NOT NULL DEFAULT 0
  - `shippingCost`: NUMERIC(10,5) NOT NULL DEFAULT 0
  - `exchangeRate`: NUMERIC(10,5)

## UI Implementation

### QuoteLinePricing Component
- Location: `/apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx`
- Displays discount as a percentage field
- Calculates net unit price as: `unitPrice * (1 - discountPercent)`
- Allows editing discount percent per quantity break
- Shows the impact of discount on pricing calculations

## Service Layer

### Sales Service
- Location: `/apps/erp/app/modules/sales/sales.service.ts`
- Handles discount persistence when updating quote line prices
- Preserves existing discounts when recalculating prices
- Functions that handle discounts:
  - Quote line price updates preserve `discountPercent` and `leadTime`
  - Recalculation functions maintain existing discount values

## Key Features

1. **Per-Quantity Discounts**: Each quantity break can have its own discount percentage
2. **Net Price Calculation**: Automatically calculates net price after discount
3. **Precision Control**: Discount percent uses NUMERIC(10,5) allowing up to 5 decimal places
4. **UI Integration**: Full editing capabilities in the quote line pricing interface

## Type Definitions

The `QuotationPrice` type (from `sales.service.ts` exports) includes:
- `discountPercent`: number
- `unitPrice`: number
- `leadTime`: number
- `quantity`: number
- `shippingCost`: number
- `exchangeRate`: number | null

## Notes
- Discounts are applied at the price level per quantity, not at the quote or line level
- The system calculates net prices dynamically based on unit price and discount percent
- No global quote-level discount exists; all discounts are line-item and quantity-specific
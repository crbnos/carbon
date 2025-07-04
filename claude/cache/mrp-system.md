# MRP (Material Requirements Planning) System

## Overview

Carbon implements an MRP system for production planning and material requirements calculation. The MRP system helps manage manufacturing needs by calculating material requirements based on production orders and demand.

## Key Components

### MRP Execution

1. **API Route**: `/api/mrp` - Main API endpoint for triggering MRP calculations
   - Located at: `/apps/erp/app/routes/api+/mrp.ts`
   - Requires `update: "inventory"` permission
   - Can run for entire company or specific location

2. **Scheduled Task**: Automated MRP runs every 3 hours
   - Located at: `/apps/erp/app/trigger/mrp.ts`
   - Uses Trigger.dev for scheduling
   - Runs MRP for all companies in the system

3. **Edge Function**: The actual MRP logic is implemented as a Supabase edge function
   - Located at: `/packages/database/supabase/functions/mrp/index.ts`
   - Invoked via `client.functions.invoke("mrp", ...)`
   - Accepts parameters for type (company/location/job/salesOrder/item/purchaseOrder), id, companyId, and userId
   - Uses the userId parameter to track who created/updated the demand and supply records

### Production Planning Interface

The main production planning interface is located at `/production/planning` and includes:

1. **Production Planning Table** (`ProductionPlanningTable.tsx`):
   - Shows items that need production planning
   - Displays planning data across multiple time periods (default 48 weeks)
   - Allows manual MRP recalculation via "Recalculate" button
   - Shows tooltip: "MRP runs automatically every 3 hours, but you can run it manually here."

2. **Planning Update Route** (`planning.update.tsx`):
   - Handles creation of production orders based on planning requirements
   - Creates jobs for manufacturing items
   - Updates supply forecasts
   - Triggers job requirement recalculations

## MRP Process Flow

1. **Automatic Execution**: MRP runs automatically every 3 hours for all companies
   - Uses userId: "system" for scheduled runs
2. **Manual Execution**: Users can trigger MRP manually from the production planning interface
   - Uses the actual userId of the person triggering the MRP
3. **Scope Options**: MRP can run at different levels:
   - Company-wide
   - Specific location
   - Individual job
   - Sales order
   - Item
   - Purchase order

## MRP Edge Function Details

The MRP edge function (`/packages/database/supabase/functions/mrp/index.ts`) performs the following:

1. **Period Generation**: Creates or retrieves demand periods (default: 72 weeks)
2. **Data Collection**: Fetches open orders from views:
   - `openSalesOrderLines` - Sales demand
   - `openJobMaterialLines` - Job material demand
   - `openProductionOrders` - Production supply
   - `openPurchaseOrderLines` - Purchase order supply
3. **Demand/Supply Calculation**: Groups quantities by location, period, and item
4. **Database Updates**:
   - Clears existing `supplyForecast` records for the company
   - Upserts `demandActual` records with source types: "Sales Order", "Job Material"
   - Upserts `supplyActual` records with source types: "Production Order", "Purchase Order"
   - Tracks `createdBy` and `updatedBy` using the provided userId

**Note**: The edge function currently runs full MRP regardless of the type parameter (company, location, etc.) as indicated by the TODO comment

## Related Features

- **Item Planning**: Items have planning parameters like reorder policies
- **Supply Forecasts**: MRP creates supply forecasts based on production orders
- **Job Requirements**: MRP recalculates material requirements for jobs
- **Manufacturing Blocking**: Items can be blocked from manufacturing
- **Configuration Requirements**: Some items require configuration before manufacturing

## Permissions

- Viewing production planning requires `view: "production"` permission
- Running MRP requires `update: "inventory"` permission
- Creating production orders requires `create: "production"` permission with employee role
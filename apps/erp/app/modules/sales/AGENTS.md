# Sales Module

Quotes (with cost rollup and pricing), sales orders, sales RFQs, customer management, opportunity tracking, pricing rules/overrides, and the customer portal. Full quote-to-order-to-fulfillment lifecycle.

## Key Domain Concepts

- **Opportunity** — deal container linking RFQs, quotes, and sales orders for one customer engagement.
- **Quote** — detailed cost estimate with line items, each having a make method (BOM + routing) and quantity-break pricing. Statuses: Draft → Pending → Sent → Ordered / Lost / Cancelled.
- **Quote Line Pricing** — per-quantity-break pricing. PK is `(quoteLineId, quantity)` — no `id` column. `discountPercent` is a **fraction 0–1** (not 0–100). Generated columns compute net/converted prices.
- **Pricing Rules** — company-scoped Discount/Markup rules. Discounts are non-stacking (highest-priority wins); Markups stack and compound in priority order.
- **Price Overrides** — customer-specific or type-specific price overrides with quantity breaks via `customerItemPriceOverride` / `customerItemPriceOverrideBreak`. Precedence: customer > customer-type > all-customers > base price.
- **Sales Order** — confirmed order from a quote. Lines carry `methodType` (Make to Order, Make to Stock, etc.) that determines production handling.
- **Sales RFQ** — inbound request from a customer, convertible to a quote via the `convert` edge function.

## Safety

### Always
- MUST use `convertQuoteToOrder` / `convertSalesRfqToQuote` for lifecycle conversions — they invoke the `convert` edge function.
- MUST use `resolvePrice` + `applyPriceRules` for price calculation — never compute prices ad hoc.
- MUST store `discountPercent` as a fraction (0.10, not 10) — all downstream math assumes 0–1.
- MUST scope customer queries by `companyId` — customers are company-scoped.

### Ask First
- Closing sales orders — `closeSalesOrder` sets `closed`, `closedAt`, `closedBy` permanently.
- Deleting quotes linked to an opportunity — may orphan related orders.
- Modifying pricing rules — affects all future `resolvePrice` calls.

### Never
- Bypass the `convert` edge function for quote→order or RFQ→quote conversions.
- Delete `quoteLinePrice` rows without preserving `discountPercent`, `leadTime`, and `categoryMarkups` — use `upsertQuoteLinePrices`.
- Store `discountPercent` as a whole number (e.g., 10 instead of 0.10).

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test -- --testPathPattern=sales
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `opportunity` | Deal container linking quotes and sales orders |
| `quote` / `quoteLine` / `quoteLinePrice` | Quote with cost rollup and quantity-break pricing |
| `quoteMakeMethod` / `quoteMaterial` / `quoteOperation` | Quote-level BOM and routing |
| `salesOrder` / `salesOrderLine` | Confirmed orders with fulfillment tracking |
| `salesRfq` / `salesRfqLine` | Inbound customer RFQs |
| `customer` / `customerContact` / `customerLocation` | Customer master data |
| `customerStatus` / `customerType` | Customer categorization |
| `pricingRule` | Company-scoped discount/markup rules |
| `customerItemPriceOverride` / `customerItemPriceOverrideBreak` | Customer-specific price overrides with quantity breaks |
| `noQuoteReason` | Why a quote line was declined |

## Key Service Functions

- `convertQuoteToOrder` / `convertSalesRfqToQuote` — lifecycle conversions via edge function
- `copyQuoteLine` / `copyQuote` — duplication via `get-method` edge function
- `applyPriceRules` — applies matched discount/markup rules to a starting price
- `resolvePrice` — full price resolution: base → overrides → rules → final
- `resolvePriceList` — batch price list for a customer/type with quantity preview
- `closeSalesOrder` / `releaseSalesOrder` / `finalizeQuote` — status transitions
- `getQuote` / `getQuoteLines` / `getQuoteLinePrices` / `getQuoteMaterials` / `getQuoteOperations` — quote reads
- `getSalesOrder(s)` / `getSalesOrderLines` / `getExternalSalesOrderLines` — order reads
- `getCustomer(s)` / `getCustomerContacts` / `getCustomerLocations` — customer reads
- `getPricingRules` / `createPricingRule` / `duplicatePricingRule` — rule management
- `getOpportunity` / `getOpportunityDocuments` — deal tracking

## Key Exports

```typescript
import { resolvePrice, applyPriceRules, getCustomer } from "~/modules/sales";
```

## Related Modules

- **production** — sales order lines create jobs for Make to Order items
- **items** — quote lines reference items; methods copied from item make methods
- **purchasing** — outside operations on quotes create PO lines
- **inventory** — shipments fulfill sales order lines
- **accounting** — sales invoices tie to orders; `getCurrencyByCode` used for exchange rates
- **people** — `getEmployeeJob` used for assignee lookups

## Rules References

- `.ai/rules/quote-discount-system.md` — pricing architecture, discount vs markup, price trace
- `.ai/rules/customer-supplier-database-schema.md` — customer/supplier data model

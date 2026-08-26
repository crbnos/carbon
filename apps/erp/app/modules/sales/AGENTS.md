# Sales Module

Quotes (with cost rollup and pricing), sales orders, sales RFQs, customer management, opportunity tracking, pricing rules/overrides, and the customer portal. Full quote-to-order-to-fulfillment lifecycle.

## Key Domain Concepts

- **Opportunity** — deal container linking RFQs, quotes, and sales orders for one customer engagement.
- **Quote** — detailed cost estimate with line items, each having a make method (BOM + routing) and quantity-break pricing. Statuses: Draft → Pending → Sent → Ordered / Lost / Cancelled.
- **Quote Revision** — `quote.revisionId`. Unlike a PO (amended in place), a quote revision is a **new `quote` row** created by `copyQuote` → the `get-method` edge function (`quoteToQuote`, `asRevision: true`), keeping the same `quoteId` with `revisionId = max + 1`, sharing the source `opportunityId`. Each revision gets its **own `externalLink`** row, whose `documentId` is revision-qualified (`Q000001-1`) because `externalLink` is UNIQUE on `(documentId, documentType, companyId)` — an unqualified id collides with the original's link. `deleteQuote` does not remove the link row, so that insert uses `onConflict … doUpdateSet` to reuse the orphan a deleted revision left behind. Displayed as `Q000001-1` when > 0 via `getQuoteDisplayId` (`@carbon/documents/utils`) on the PDF, email, share page, and filenames; two-tone in-app rendering uses `<RevisionSuffix>` (`~/components`).
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
- Delete `quoteLinePrice` rows when *rewriting* a line's pricing — that must preserve `discountPercent`, `leadTime`, `shippingCost`, and `categoryMarkups` via `upsertQuoteLinePrices`. Deleting rows for a quantity break the line no longer offers is different and required: see `reconcileQuantityBreaks` (`sales.utils.ts`) and its use in `x+/quote+/$quoteId.$lineId.details.tsx`. Orphaned rows render as selectable options on the customer share page.
- Store `discountPercent` as a whole number (e.g., 10 instead of 0.10).

## Validation Commands

```bash
# The app's package name is "erp" — there is no "@carbon/erp" workspace.
pnpm exec turbo run typecheck --filter=erp
# apps/erp has no `test` script; run vitest from the app directory.
cd apps/erp && pnpm exec vitest run app/modules/sales
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
- `getOpenSalesOrderLinesForItem` — sales order lines a job can link to (open orders, matching item); `isSalesOrderClosed` / `OPEN_SALES_ORDER_STATUSES` gate eligibility
- `getCustomer(s)` / `getCustomerContacts` / `getCustomerLocations` — customer reads
- `getPricingRules` / `createPricingRule` / `duplicatePricingRule` — rule management
- `getOpportunity` / `getOpportunityDocuments` — deal tracking

## Key Exports

```typescript
import { resolvePrice, applyPriceRules, getCustomer } from "~/modules/sales";
```

## Sales Rules (sub-area)

Configurable if-condition-then-error/warn rules evaluated when an item is added to a **sales document** (quote line, sales order line, sales invoice line) — e.g. "if item type is X and the customer's ship-to country is Y → block". Lives **inside** this module: validators in `sales.models.ts`, CRUD in `sales.service.ts`, UI in `ui/SalesRules/`. There is no `modules/sales-rules` directory — a rule feature is not its own domain.

Distinct from **storage rules** (`~/modules/inventory`, warehouse/MES surfaces) and **configurator rules** (`configurationRule`, `x+/part+/$itemId.rule*.tsx`) — storage and sales rules now share ONE table, `enforcementRule`, discriminated by `family` ('storage' | 'sales'); the configurator's `configurationRule` is unrelated. Every read/write in this module MUST filter `family = 'sales'`.

- **Rule** — `enforcementRule` row (`family = 'sales'`): `conditionAst` JSONB (`{kind: all|any|none, conditions:[{field,op,value}]}`), `severity` (`error` blocks; `warn` requires acknowledgment), `message` with `{token}` interpolation, `surfaces` (`enforcementRuleSurface` enum; the sales-legal subset `quoteLine` | `salesOrderLine` | `salesInvoiceLine` is enforced by the `enforcementRule_sales_surfaces` CHECK), item scoping via `filteredItemTypes`/`filteredItemGroupIds`/`filteredItemMatchAll` (empty = all items) or explicit `enforcementRuleItemAssignment` pins (shared with the storage family — always resolve pins against a family-filtered rule set, never a PostgREST embed).
- **Shared engine** — the AST compiler/evaluator lives in `@carbon/utils` (`rules.ts` + `field-registry.ts`, with the zod AST mirror in `rules-schema.ts`): `compileSalesRuleWithCache`, `evaluateRules`, `SALES_RULE_SURFACES`, `getFieldsForSalesRuleSurfaces`, `SALES_RULE_FIELD_REGISTRY` (customer type/status/country + synthesized `customer.customFields.*`). Countries are **alpha-2** codes.
- **Evaluator** — `@carbon/ee/rules.server` `evaluateSalesRuleLines` (service-role client; plan-gated on `SALES_RULES`). Missing ship-to → the engine's required-field semantics emit "Customer location is required" at the rule's severity.
- **Fail loud, never silently permissive.** A failed rule load, item load, or ship-to resolution THROWS. Each of those returns "nothing to enforce" if swallowed, which turns a compliance control off with no signal.
- **Drop-ship ship-to** — `resolveSalesOrderShipTo` returns the shipment's `customerLocationId`, never the header's, when `dropShipment` is set. If the drop-ship location is missing it returns null rather than falling back: the header is a DIFFERENT address, so a fallback would clear a country rule that should have blocked.
- **Invoice ship-to** — a sales invoice has NO customer ship-to (`invoiceCustomerLocationId` is the bill-to; the `locationId` columns are Carbon's own warehouses). An order-derived line (`salesInvoiceLine.salesOrderId`) resolves through `resolveSalesOrderShipTo`; a standalone line passes `customerLocationId: null` and fails closed via required-field semantics. NEVER substitute the bill-to — pinned by `packages/ee/src/rules/sales/invoice-shipto.test.ts`.
- **One modal** — enforcement actions return `{ violations, ruleNames }`; forms submit via `useRuleViolations` and render the shared `RuleViolationModal` (`@carbon/ee/rules`). Do not add a second violation UI.
- **Acknowledgment log** — `enforcementRuleAcknowledgment` (append-only): one row per deduped violation on blocked attempts and acknowledged overrides.

### Sales Rules safety

- MUST evaluate with the **service role** client in route actions AFTER `requirePermissions` — the check must see full truth regardless of the acting user's read permissions.
- MUST gate write routes with `requirePlan({ feature: "SALES_RULES" })` (key in `packages/ee/src/plan.ts`).
- The shared rule-builder components (`RuleBuilder`, `SurfacesField`, `MessageWithTokens`, `SeveritySelect`, `ItemFilterSelector`) live in `~/modules/inventory/ui/StorageRules/` and are imported by **deep path**. Keep any parameterization **additive** (defaults preserve storage behavior), and never import a module *barrel* from these components — keep the dependency a one-way deep import from `sales` into the inventory UI folder to avoid a barrel cycle. The shared zod AST schema lives in `@carbon/utils` for the same reason.
- Never widen the `enforcementRule_sales_surfaces` CHECK to admit storage surfaces — that CHECK is what replaced the old per-family enum typing.
- Never duplicate `isBlocked`/`dedupeViolations`/the violation modal — import from `@carbon/ee/rules(.server)`.

| Table | Purpose |
|---|---|
| `enforcementRule` (`family='sales'`) | Rule definitions (house PK `("id","companyId")`; RLS writes `sales_*` for sales-family rows) |
| `enforcementRuleItemAssignment` | Explicit per-item pins, PK `(itemId, ruleId)` — SHARED with storage rules |
| `enforcementRuleAcknowledgment` | Append-only override/block evidence (INSERT via `sales_create`) |

Service functions: the admin CRUD is NOT in `sales.service.ts` — both families share one parametrized implementation in `~/modules/shared` (`getEnforcementRules` / `getEnforcementRule` / `upsertEnforcementRule` / `deleteEnforcementRule` / `getEnforcementRuleAssignmentCounts`), called with `"sales"` as the family. Cross-app `getActiveSalesRulesForItems` / `getSalesRuleAssignmentsForItem` / `getSalesRulesList` / `assignSalesRule` / `unassignSalesRule` are imported from `@carbon/ee/rules` DIRECTLY at the call site — this module's barrel deliberately does not re-export them. Routes: `x+/sales+/sales-rules*` (list/new/edit/delete/assign/unassign), sidebar entry in `useSalesSubmodules`, per-item "Sales rules" card on `x+/part+/$itemId.inventory.tsx`. Enforcement: the quote, sales-order, and sales-invoice line create + edit actions, plus document gates (quote finalize/convert, RFQ convert, order confirm, shipment post, invoice post — the invoice-post gate runs in `x+/sales-invoice+/$invoiceId.post.tsx` BEFORE the optimistic `Pending` write).

## Related Modules

- **production** — sales order lines create jobs for Make to Order items
- **items** — quote lines reference items; methods copied from item make methods
- **purchasing** — outside operations on quotes create PO lines
- **inventory** — shipments fulfill sales order lines
- **accounting** — sales invoices tie to orders; `getCurrencyByCode` used for exchange rates
- **people** — `getEmployeeJob` used for assignee lookups

## Rules References

- `.claude/rules/quote-discount-system.md` — pricing architecture, discount vs markup, price trace
- `.claude/rules/customer-supplier-database-schema.md` — customer/supplier data model

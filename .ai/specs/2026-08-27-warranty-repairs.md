# Warranty & Repairs — `warrantyTerm` / `warrantyRegistration` + `repairOrder`

> Status: draft
> Author: Claude (with Sid)
> Date: 2026-08-27
> Research: `.ai/research/2026-08-20-warranty-repairs.md` (BC service management, SAP B1 service, NetSuite Warranty & Repairs SuiteApp, Odoo Repairs, Epicor field service, Infor SyteLine SROs/rework, Acumatica equipment — primary-source cited)

## TLDR

Give Carbon a warranty model and a repair document, layered on the returns module. **Warranty** = a reusable `warrantyTerm` (parts/labor coverage split, duration, start basis) attached to items, plus a per-sold-unit `warrantyRegistration` stamped automatically when the sales shipment posts — keyed on `trackedEntityId` for serialized/batch goods (Carbon's tracked entity IS the install-base row) and on the shipment line + quantity for untracked goods, carrying the **supplier's** warranty expiration alongside the customer's (the Acumatica/SyteLine dual-warranty pattern), with a customer-facing **warranty certificate PDF**. Coverage checks are **advisory, never blocking**. **Repairs** = a `repairOrder` document (standalone or spawned from an RMA line's already-existing-but-unwired `'Repair'` disposition) that owns the unit end-to-end: receive it from the customer at **zero value** with the same tracked entity re-entering `On Hold` (the proven returns re-tag), optionally ship it to the OEM/supplier and receive the **same unit** back (new `'Repair Order'` shipment/receipt source branches — the round trip no surveyed ERP packages), record parts/service charges each carrying a billing code (`Warranty` / `No Charge` / `Billable`) **defaulted from the registration check and overridable per line**, quote billable work *before* it starts via a linked Carbon quote, and ship the repaired unit home. Custody ("where is the customer's unit right now — in shop / at supplier / shipped back") lives on the repair order line, not on the shared `trackedEntityStatus` enum. Warranty-absorbed part costs post to a new `accountDefault.warrantyCostAccount` (SyteLine's warranty GL routing), falling back to COGS. No new module, no new permission scopes — the returns-module extension pattern exactly.

## Problem Statement

Carbon has no warranty concept at all. The only occurrence of "warranty" in the codebase is a user-deletable seeded `returnReason` row. There is no warranty period, no start date, no coverage terms, no per-serial registration, no entitlement check at return intake, and nothing a customer can be handed as proof of coverage. When an in-warranty unit comes back, the shop cannot answer "is this covered?", and Carbon cannot answer "which units in the field are still under warranty?"

Repairs are equally unserved. The returns module authorizes and receives a customer return, but its `'Rework'` disposition only files a quality Issue and flips the entity back to `Available` — the physical repair is invisible: no parts consumption, no charges, no supplier round trip, no repair state. The `'Repair'` disposition value already exists in the DB enum (`20251114222648_supplier_id.sql`) and is commented out of every picker, waiting for behavior. For the common distributor scenario — customer sends an in-warranty unit back, we forward it to the original supplier/OEM for repair, receive the same unit back, and return it to the customer — Carbon has no road at all: `purchaseReturnOrder` ships only ("goods leave; nothing to disposition"), and nothing tracks a unit sitting at a supplier.

Every system surveyed separates a reusable warranty **term** from a per-unit **registration** stamped at the outbound event (research §Synthesis 1–3), makes the free/billable decision **per line, defaulted from coverage** (§Synthesis 6), and executes returns-with-repair on a distinct repair/service document (§Synthesis 7). Two absences the research found are opportunities: no ERP tracks a serialized unit AT the vendor during repair (§Synthesis 11), and NetSuite — the cautionary tale — loses unit identity by consuming the returned assembly into a different "repaired item" (§Divergences). Carbon's genealogy-preserving tracked entities can do better natively.

## Proposed Solution

### Warranty workflow

```
item.warrantyTermId ──(sales shipment posts)──▶ warrantyRegistration per unit
item.supplierWarrantyTermId ──(entity's PO receipt date)──▶ supplier expiration on the same row
                                                    │
                     RMA line / repair line intake ─┴─▶ advisory verdict:
                     "Parts in warranty until X · Labor expired since Y" (never blocks)
```

### Repair workflow

```
                    ┌──(RMA line, disposition 'Repair')──┐
create repairOrder ─┤                                    ├─ lines start 'Received' (custody
                    └──(standalone, walk-in)─────────────┘   transfer from RMA) or 'Pending'

Draft ──confirm──▶ Confirmed ──activity──▶ In Progress ──complete──▶ Completed
  └──cancel──▶ Cancelled (only while nothing received)      (guard: every non-closed
                                                             line Shipped or closedComplete)

per line (custody):  Pending ──receipt──▶ Received ──shipment──▶ At Supplier ──receipt──▶ Repaired
                                             │                                              │
                                             └────────(in-house: Mark Repaired)────────────┤
                                                                                            ▼
                                                                            ──shipment──▶ Shipped
```

1. **Register.** Posting a sales shipment auto-creates `warrantyRegistration` rows for lines whose item carries a `warrantyTermId`: one row per shipped tracked entity (serial/batch), or one quantity row per shipment line for untracked items (NetSuite's lot pattern). Dates resolve from the term (`startBasis`: Ship Date default, Invoice Date optional) into per-class expirations (`partsExpirationDate` / `laborExpirationDate` — BC's split). For tracked units whose genealogy reaches a purchase receipt and whose item has a `supplierWarrantyTermId`, the same row stores `supplierId` + `supplierWarrantyExpirationDate` — the data that answers "is the OEM leg free for us?" (Acumatica Company/Vendor warranty pair; SyteLine warranty Type). Registrations are editable per unit (override), creatable manually (legacy/imported units), and voided with the shipment. Each registration has a readable id (`WTY000001`) and a **warranty certificate PDF** — the "warranty card" a supplier hands the customer; no surveyed ERP ships one.
2. **Check.** Creating an RMA line or a repair order line for a registered unit surfaces the per-class verdict inline (advisory — BC/SAP B1/Epicor behavior; NetSuite's hard block is the rejected outlier, it forces workarounds for goodwill repairs).
3. **Authorize the repair.** A `repairOrder` is created standalone or from an RMA line via the newly-wired `'Repair'` disposition (mirroring how the Issue `'Return to Supplier'` disposition drafts a `purchaseReturnOrder`). RMA-spawned lines take custody at `'Received'` — the unit is already in house, `On Hold`, at zero value — and the RMA line's non-`Pending` disposition lets the RMA complete; the repair order carries on independently, exactly like Scrap/Rework hand off to an Issue today. Confirming assigns `REP000001` and produces a PDF.
4. **Receive** (standalone lines). A receipt with `sourceDocument 'Repair Order'` receives `'Pending'` lines: **always a zero-value cost layer** (the unit is the customer's property — BC's Inventory Value Zero, SyteLine's non-nettable RMA location), positive `itemLedger` (`'Repair Receipt'`), and for tracked items the same `trackedEntity` re-tags `Consumed → On Hold` with a `'Repair Receipt'` activity (blind units mint a new `On Hold` entity). Line → `'Received'`.
5. **Send to the supplier** (optional, per line). A shipment with `sourceDocument 'Repair Order'` ships `'Received'` lines to the header's supplier: negative `itemLedger` (`'Repair Shipment'`) at carried (zero) cost, entity → `Consumed` with a `'Repair Shipment'` activity, line → `'At Supplier'`. The header carries `supplierReference` (the supplier's own RMA number). **Create Repair PO** drafts a PO on the supplier for the repair fee (service line, `create: "purchasing"`), linked via `purchaseOrderId` — with an advisory banner when `supplierWarrantyExpirationDate` still covers today. A second receipt against the order receives `'At Supplier'` lines back: zero-value re-entry, same entity `→ On Hold`, line → `'Repaired'`. This is the Epicor job-subcontract round trip re-expressed on a document — and the at-supplier interval is first-class on the line, which no surveyed system offers.
6. **Repair in-house** (alternative, per line). Parts and work are recorded as `repairOrderCharge` rows: **Part** charges consume shop inventory (negative `itemLedger` `'Repair Consumption'` via an `issue` edge-function branch; GL per billing code below); **Service** charges capture work/fees as amounts (optionally referencing a Service item — labor-hour capture on production jobs is explicitly out of scope, see below). **Mark Repaired** transitions the line.
7. **Bill.** Every charge carries a `repairBillingCode` — `Warranty` / `No Charge` / `Billable` — **defaulted from the registration verdict at entry** (Part charges from parts coverage, Service charges from labor coverage; expired or unregistered → `Billable`) and overridable per line in both directions (BC Exclude Warranty; SyteLine bill codes — `Recover` is expressible as `Billable` with price = cost). **Create Quote** drafts a Carbon `quote` from the `Billable` charges *before* work starts (quote-first — BC service quotes; fixes Odoo's documented quote-after weakness), linked via `quoteId`; acceptance rides the existing `convertQuoteToOrder`. **Create Sales Order** is the direct alternative (`salesOrderId`). Invoicing stays entirely in the existing SO → invoice machinery.
8. **Return to customer.** A shipment with `sourceDocument 'Repair Order'` ships `'Repaired'` lines home: entity → `Consumed` (back "at customer"), line → `'Shipped'`. On completion, an optional **Apply Repair Warranty** action stamps a chosen term onto the unit's registration from the completion date (BC's replacement-warranty-reset precedent, generalized).
9. **GL.** Part charges post `Cr Inventory` at cost with the debit routed by billing code: `Warranty`/`No Charge` → `accountDefault.warrantyCostAccount` (new, nullable, fallback `costOfGoodsSoldAccount`; a seeded `Warranty Expense` posting account — SyteLine's warranty Revenue/COGS routing); `Billable` → COGS. The customer-owned unit itself never carries value (zero layers in, zero out), so a $50k unit in the shop never sits on the balance sheet. No warranty accrual/reserve mechanics — no surveyed ERP documents any (research §Synthesis 10).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Warranty shape | Reusable `warrantyTerm` + per-unit `warrantyRegistration` stamped at shipment posting; NOT computed on the fly, NOT a matrix | Unanimous competitor pattern (research §Synthesis 1–2); registrations enable per-unit override, supplier warranty storage, and the install-base view. Flat item-level attachment — no customer×item coverage matrix (rejected-pattern lesson `.ai/lessons.md:74`) |
| Registration key | `trackedEntityId` for serial/batch; `shipmentLineId` + quantity for untracked — **both in scope** | User decision. Tracked = BC/SAP B1 per-serial model with `trackedEntity` as the install base; untracked = NetSuite's quantity pattern, powers the advisory check (identity-preserving re-entry remains tracked-only) |
| Coverage split | `coversParts`/`coversLabor` booleans + per-class duration months (NULL duration = lifetime) resolving to per-class expiration dates | BC's separate parts/labor windows (research §BC); percentages deferred — binary covered/not is the 90% case, the per-line override handles the rest |
| Start basis | `warrantyTermStartBasis` enum: `'Ship Date'` (default) \| `'Invoice Date'` | NetSuite's preference pair; ship-date-flavored default is the consensus (§Synthesis 3). Install-date basis needs an install-base concept Carbon doesn't have — out |
| Supplier warranty | `item.supplierWarrantyTermId` + `supplierId`/`supplierWarrantyExpirationDate` on the registration, resolved from the entity's purchase-receipt date; advisory only | Acumatica's Company/Vendor warranty pair + SyteLine's warranty Type (User/Vendor/Manufacturer); two systems store the data, none automates the decision — Carbon stores + surfaces it |
| Warranty check | Advisory badge at RMA/repair intake; never a block | BC/SAP B1/Epicor behavior; NetSuite's hard block is the outlier and breaks goodwill repairs (§Synthesis 5) |
| Warranty certificate | Per-registration PDF (`packages/documents` pattern) + readable `WTY` id | User decision ("warranty card"); no surveyed ERP ships one — differentiator, cheap on existing PDF machinery |
| Repair execution | A `repairOrder` **document** owning custody + charges + supplier round trip; NOT a production job, NOT an extension of `purchaseReturnOrder` | User decision. Rides the shipments/receipts machinery the returns module just proved twice; supplier returns keep their shipped-for-credit semantics ("goods leave; nothing to disposition"). Job-based execution (Epicor disposition-to-Job, SyteLine rework orders) requires identity-preserving jobs — jobs today mint a new serial and terminally consume inputs — and is explicitly out of scope by architecture choice |
| Origination | Standalone AND RMA-spawned (`'Repair'` disposition wired); repair order owns intake and ship-back uniformly | User decision. RMA-spawned lines start `'Received'` (custody transfer — no second receipt); the RMA completes once disposition is set, like Scrap/Rework → Issue today |
| Custody / at-supplier state | `repairOrderLineStatus` enum on the line: `Pending / Received / At Supplier / Repaired / Shipped`; `trackedEntityStatus` untouched (`Consumed` out, `On Hold` in — the returns re-tag) | User decision. Answers "where are my customers' units" via a view join without auditing every status-aware reader of a shared enum; SAP B1's "In Lab" shows the demand is informational (§Synthesis 11) |
| Ownership & valuation | Repair intake **always** posts a zero-value cost layer; entity `On Hold` (planning-invisible) | BC Inventory Value Zero + SyteLine non-nettable location converge (§Synthesis 9); customer property never enters valuation. No consignment/ownership axis — deferred as its own feature |
| Charges | `repairOrderCharge`: `Part` (consumes inventory) \| `Service` (amount, optional Service item); per-charge `repairBillingCode` `Warranty`/`No Charge`/`Billable` defaulted from coverage, overridable | §Synthesis 6 consensus (BC per-line discount + Exclude Warranty; SyteLine bill codes). SyteLine's `Recover` = `Billable` at cost price, not a fourth code |
| Quote-first billing | **Create Quote** → draft Carbon `quote` from Billable charges (`quoteId`), acceptance via existing `convertQuoteToOrder`; **Create Sales Order** direct alternative (`salesOrderId`); invoicing unchanged | BC service quotes; Odoo's quote-after is the documented weakness. Reuses Carbon's native quote → order → invoice chain end-to-end |
| Warranty GL | Additive `accountDefault.warrantyCostAccount` (nullable, fallback `costOfGoodsSoldAccount`) + seeded `Warranty Expense` account; Warranty/No Charge part consumption debits it | SyteLine's Bill Code WARRANTY → warranty COGS routing (§SyteLine); account resolved via `accountDefault` by id, seeded by group name never number (lesson; `salesReturnsAccount` precedent). No accrual/reserve — no ERP documents one |
| Problem codes | Reuse `returnReason` on the repair line | The table is already shared across both return directions (BC shares reason codes); Infor's Problem-vs-Disposition split maps to reason (why) vs billing code + custody (what) |
| Repair warranty | Optional **Apply Repair Warranty** action at completion — stamps a chosen term onto the registration from the completion date | BC component-replacement reset is the only documented precedent; per-action picker, no company default column |
| Out of scope (separate features, not phases) | Loaners, advance exchange, meter/usage-based warranty, OEM-partner reimbursement claims, warranty accrual reserves, job-based repair execution (labor-hour/WIP capture), consignment ownership | Matches competitor packaging: loaners/AdvExch are discrete SyteLine/BC features, meters SyteLine-only, reimbursement SyteLine-only, accruals documented nowhere; jobs excluded by the architecture decision above |
| Module home / permissions | Sales module: code in `modules/sales/`, routes `handle.module: "sales"`, `sales_*` scopes; Create Repair PO `create: "purchasing"`; receipts/shipments stay `inventory_*` | Returns precedent verbatim: no `module` enum value, no new permission scope (FROZEN surface), lesson "Features live inside existing permission modules" |
| Multi-tenancy (heuristic 1) | Every new table: `companyId`, composite PK `("id","companyId")`, `id('prefix')`/`xid()` defaults, audit columns, `customFields` | House convention (`conventions-database.md`) |
| Service shape (heuristic 2) | All new functions in `sales.service.ts`: client first arg, return `{data, error}`, never throw, `companyId`-scoped | House convention |
| RLS (heuristic 3) | Policies named exactly `SELECT/INSERT/UPDATE/DELETE`; SELECT via `get_companies_with_employee_role()`, writes via `get_companies_with_employee_permission('sales_*')` | Post-rls-refactor convention; employee-only (no portal SELECT) |
| Permission scoping (heuristic 4) | Repair + warranty routes `{action}: "sales"`; PO action `"purchasing"`; receipt/shipment routes unchanged (`"inventory"`) | Matches the owning machinery of each step |
| Forms (heuristic 5) | `ValidatedForm` + `validator(zodSchema)` + route actions; dates via `useCompanyToday()` | House convention; date-handling rule |
| Module layout (heuristic 6) | Extends `sales.models.ts` / `sales.service.ts` / `modules/sales/ui/{Repairs,Warranties}/`; no new module folder | One service/models file per module (root AGENTS.md "Never") |
| Backward compat (heuristic 7) | Everything additive: new tables, additive enum values (own-statement migrations), nullable columns on `item` + `accountDefault`; `'Repair'` disposition merely activated in a picker. No renames, drops, or scope changes | `BACKWARD_COMPATIBILITY.md`: DB schema ADDITIVE-ONLY; permission scopes FROZEN |

## Data Model Changes

One migration (`pnpm db:migrate:new warranty-repairs`), all additive; `pnpm run generate:types` after. Enum additions in their own statements (ALTER TYPE ADD VALUE cannot share a transaction — `database-migration-patterns.md`).

### Enums

```sql
CREATE TYPE "warrantyTermStartBasis" AS ENUM ('Ship Date', 'Invoice Date');
CREATE TYPE "repairOrderStatus" AS ENUM ('Draft', 'Confirmed', 'In Progress', 'Completed', 'Cancelled');
CREATE TYPE "repairOrderLineStatus" AS ENUM ('Pending', 'Received', 'At Supplier', 'Repaired', 'Shipped');
CREATE TYPE "repairBillingCode" AS ENUM ('Warranty', 'No Charge', 'Billable');
CREATE TYPE "repairOrderChargeType" AS ENUM ('Part', 'Service');

ALTER TYPE "receiptSourceDocument" ADD VALUE 'Repair Order';
ALTER TYPE "shipmentSourceDocument" ADD VALUE 'Repair Order';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE 'Repair Receipt';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE 'Repair Shipment';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE 'Repair Consumption';
ALTER TYPE "documentSourceType" ADD VALUE 'Repair Order';
ALTER TYPE "documentSourceType" ADD VALUE 'Warranty Registration';
```

(`disposition` needs no change — `'Repair'` already exists; it is activated in the `salesReturnDispositionType` picker subset only.)

### `warrantyTerm`

```sql
CREATE TABLE "warrantyTerm" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "name" TEXT NOT NULL,
    "coversParts" BOOLEAN NOT NULL DEFAULT TRUE,
    "partsDurationMonths" INTEGER,                    -- NULL with coversParts = lifetime
    "coversLabor" BOOLEAN NOT NULL DEFAULT TRUE,
    "laborDurationMonths" INTEGER,
    "startBasis" "warrantyTermStartBasis" NOT NULL DEFAULT 'Ship Date',
    "companyId" TEXT NOT NULL,
    -- audit columns + customFields per template
    PRIMARY KEY ("id", "companyId"),
    UNIQUE ("companyId", "name")
);
```

### `warrantyRegistration`

```sql
CREATE TABLE "warrantyRegistration" (
    "id" TEXT NOT NULL DEFAULT id('wty'),
    "warrantyRegistrationId" TEXT NOT NULL,           -- readable WTY000001 via get_next_sequence
    "itemId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "trackedEntityId" TEXT,                           -- serial/batch key (NULL for untracked)
    "shipmentLineId" TEXT,                            -- source + untracked key; NULL for manual rows
    "quantity" NUMERIC NOT NULL DEFAULT 1,            -- >1 only for untracked registrations
    "warrantyTermId" TEXT,                            -- provenance; dates below are authoritative
    "startDate" DATE NOT NULL,
    "coversParts" BOOLEAN NOT NULL DEFAULT TRUE,
    "partsExpirationDate" DATE,                       -- NULL with coversParts = lifetime
    "coversLabor" BOOLEAN NOT NULL DEFAULT TRUE,
    "laborExpirationDate" DATE,
    "supplierId" TEXT,                                -- OEM warranty (resolved from purchase receipt)
    "supplierWarrantyExpirationDate" DATE,
    "companyId" TEXT NOT NULL,
    -- audit columns + customFields
    PRIMARY KEY ("id", "companyId"),
    UNIQUE ("warrantyRegistrationId", "companyId")
);
```

Indexes on `companyId`, `customerId`, `itemId`, `trackedEntityId`. Registrations auto-created by `post-shipment` are deleted when the shipment is voided (matched on `shipmentLineId`); manual rows survive.

### `repairOrder` (header)

```sql
CREATE TABLE "repairOrder" (
    "id" TEXT NOT NULL DEFAULT id('rep'),
    "repairOrderId" TEXT NOT NULL,                    -- readable REP000001
    "status" "repairOrderStatus" NOT NULL DEFAULT 'Draft',
    "customerId" TEXT NOT NULL,
    "customerLocationId" TEXT,
    "customerContactId" TEXT,
    "customerReference" TEXT,
    "locationId" TEXT,                                -- shop site
    "salesReturnOrderId" TEXT,                        -- spawned-from RMA (SET NULL)
    "supplierId" TEXT,                                -- OEM/repair vendor (one per order)
    "supplierReference" TEXT,                         -- the supplier's own RMA number
    "purchaseOrderId" TEXT,                           -- repair-fee PO (SET NULL)
    "quoteId" TEXT,                                   -- repair quote (SET NULL)
    "salesOrderId" TEXT,                              -- billing SO, direct or via quote conversion (SET NULL)
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" NUMERIC(10,5) NOT NULL DEFAULT 1,
    "orderDate" DATE NOT NULL,                        -- useCompanyToday()
    "promisedDate" DATE,
    "internalNotes" JSON,
    "externalNotes" JSON,
    "assignee" TEXT REFERENCES "user"("id"),
    "companyId" TEXT NOT NULL,
    -- audit columns + customFields
    PRIMARY KEY ("id", "companyId"),
    UNIQUE ("repairOrderId", "companyId")
);
```

### `repairOrderLine` (units under repair)

```sql
CREATE TABLE "repairOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('repl'),
    "repairOrderId" TEXT NOT NULL,                    -- CASCADE
    "lineNumber" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT NOT NULL,
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "unitOfMeasureCode" TEXT,
    "status" "repairOrderLineStatus" NOT NULL DEFAULT 'Pending',
    "warrantyRegistrationId" TEXT,                    -- SET NULL
    "underWarranty" BOOLEAN NOT NULL DEFAULT FALSE,   -- advisory snapshot at intake, editable
    "returnReasonId" TEXT,                            -- problem code (shared returnReason table)
    "salesReturnOrderLineId" TEXT,                    -- provenance + idempotency key (SET NULL)
    "closedComplete" BOOLEAN NOT NULL DEFAULT FALSE,  -- short-close
    "companyId" TEXT NOT NULL,
    -- audit columns + customFields
    PRIMARY KEY ("id", "companyId")
);
```

### `repairOrderLineTrackedEntity` (expected/held units — mirrors the returns junction)

```sql
CREATE TABLE "repairOrderLineTrackedEntity" (
    "repairOrderLineId" TEXT NOT NULL,
    "trackedEntityId" TEXT NOT NULL,
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("repairOrderLineId", "trackedEntityId", "companyId")
);
```

### `repairOrderCharge`

```sql
CREATE TABLE "repairOrderCharge" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "repairOrderId" TEXT NOT NULL,                    -- CASCADE
    "repairOrderLineId" TEXT,                         -- optional per-unit attribution (SET NULL)
    "chargeType" "repairOrderChargeType" NOT NULL,
    "itemId" TEXT,                                    -- required for Part; optional Service item
    "description" TEXT,
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "unitPrice" NUMERIC NOT NULL DEFAULT 0,           -- billing basis (Billable charges)
    "unitCost" NUMERIC NOT NULL DEFAULT 0,            -- filled at consumption for Part charges
    "billingCode" "repairBillingCode" NOT NULL DEFAULT 'Warranty',
    "issuedAt" TIMESTAMP WITH TIME ZONE,              -- set when a Part charge posts consumption
    "companyId" TEXT NOT NULL,
    -- audit columns + customFields
    PRIMARY KEY ("id", "companyId")
);
```

### Additive columns on existing tables

```sql
ALTER TABLE "item" ADD COLUMN "warrantyTermId" TEXT;           -- customer warranty we grant
ALTER TABLE "item" ADD COLUMN "supplierWarrantyTermId" TEXT;   -- warranty our supplier grants us
ALTER TABLE "accountDefault" ADD COLUMN "warrantyCostAccount" TEXT;  -- nullable; fallback costOfGoodsSoldAccount
```

Seed a `Warranty Expense` posting account for existing companies — resolve the parent group by `"isGroup" = TRUE AND name`, never by number (lesson; `salesReturnsAccount` in `20260814063415` is the precedent) — plus `seed.data.ts` / `seed-company` for new companies.

### Sequences, views, RLS

- `sequence` rows per company: `('repairOrder','Repair Order','REP',…)` and `('warrantyRegistration','Warranty Registration','WTY',…)` — migration backfill + `seed.data.ts` + `seed-company` (all three paths, per the seed lesson).
- Views (`SECURITY_INVOKER=true`): `repairOrders` (header + customer/supplier names + line counts + custody rollup) and `warrantyRegistrations` (registration + item + customer + entity + derived `Active`/`Expired` per class) — read by the list tables. A `trackedEntityCustody` helper view joins open repair order lines to entities so "where is this unit" is one query.
- RLS on all new tables: policies named exactly `SELECT/INSERT/UPDATE/DELETE`; SELECT via `(SELECT get_companies_with_employee_role())::text[]`, writes via `(SELECT get_companies_with_employee_permission('sales_<action>'))::text[]`. Junction tables derive visibility from their parents. No portal arm.

## API / Service Changes

### `sales.models.ts`
`warrantyTermValidator`, `warrantyRegistrationValidator`, `repairOrderValidator`, `repairOrderLineValidator`, `repairOrderChargeValidator`; const arrays `repairOrderStatusType`, `repairOrderLineStatusType`, `repairBillingCodeType`, `warrantyTermStartBasisType`; `salesReturnDispositionType` gains `'Repair'` (picker activation only).

### `sales.service.ts` (client-first, `{data, error}`, `companyId`-scoped)
- Warranty: `getWarrantyTerms` + CRUD; `getWarrantyRegistrations` (view + filters), `getWarrantyRegistration`, `upsertWarrantyRegistration` (manual), `getWarrantyCoverage(client, { companyId, trackedEntityId? | itemId + customerId? })` → per-class verdict `{ coversParts, partsUntil, coversLabor, laborUntil, supplierCoveredUntil }` — the one advisory-check entry point used by RMA and repair intake.
- Repairs: `getRepairOrders`, `getRepairOrder`, `getRepairOrderLines`, `getRepairOrderCharges`, `upsertRepairOrder(Line/Charge)`, `deleteRepairOrder(Line/Charge)`, `confirmRepairOrder`, `cancelRepairOrder`, `completeRepairOrder` (guard: every non-closed line `Shipped` or `closedComplete`), `markRepairOrderLineRepaired`, `createRepairOrderFromReturnLine` (idempotent on `salesReturnOrderLineId`; copies customer/entities/reason; line starts `'Received'`; sets the RMA line disposition `'Repair'`), `createRepairQuote` (draft `quote` from Billable charges; idempotent on `quoteId`), `createRepairSalesOrder` (idempotent on `salesOrderId`), `applyRepairWarranty` (stamp a term onto the registration from completion date).
- Purchasing side (`purchasing.service.ts`): `createRepairPurchaseOrder` (draft PO on the header supplier with a service fee line; idempotent on `purchaseOrderId`).

Custody transitions are transactional invariants: receipt/shipment posting re-reads the line under row lock and refuses a leg that doesn't match the line's state (e.g. shipping to the supplier a line that isn't `'Received'`) — the returns quantity-cap pattern applied to states.

### Edge functions (extensions, additive branches only)
- **`create`** — `receiptFromRepairOrder` (lines from `'Pending'` + `'At Supplier'` lines, branching on state) and `shipmentFromRepairOrder` (lines from `'Received'` → supplier when the caller passes the supplier leg, `'Repaired'` → customer otherwise); `sourceDocumentReadableId = repairOrder.repairOrderId`.
- **`post-receipt`** — Repair Order branch: **always zero-value cost layer**, positive `itemLedger` `'Repair Receipt'`; tracked entities re-tag `Consumed → On Hold` (returns pattern; blind → new `On Hold` entity) with a `'Repair Receipt'` `trackedActivity`; line `Pending → Received` or `At Supplier → Repaired`; header `Confirmed → In Progress`. Void reverses.
- **`post-shipment`** — Repair Order branch: negative `itemLedger` `'Repair Shipment'` at carried (zero) cost; entities → `Consumed` + `'Repair Shipment'` activity; line `Received → At Supplier` or `Repaired → Shipped`; the shipment-lines tracking route permits `On Hold` entities for this source (the existing Sales Return Order special-case, extended). Void reverses.
- **`post-shipment` (sales branch)** — after posting, insert `warrantyRegistration` rows for lines whose item has `warrantyTermId` (per tracked entity, else per line + quantity), resolving supplier warranty from the entity's purchase-receipt genealogy. Void deletes the rows it created.
- **`issue`** — `partsToRepairOrder` case: posts the Part charge's consumption — negative `itemLedger` `'Repair Consumption'` at current cost, journal `Cr Inventory / Dr (warrantyCostAccount ?? costOfGoodsSoldAccount)` for `Warranty`/`No Charge`, `Dr costOfGoodsSoldAccount` for `Billable` (gated on `accountingEnabled`); stamps `unitCost` + `issuedAt` on the charge.

### Routes (`path.to` additions)
- Lists under the parent module: `x+/sales+/repairs.tsx`, `x+/sales+/warranties.tsx`; warranty-terms CRUD quartet `x+/sales+/warranty-terms(.new/.$id/.delete.$id).tsx` (clone the return-reasons quartet).
- Detail tree `x+/repair-order+/`: `_layout.tsx` (`handle.module: "sales"`), `$id.tsx` (+details), `new.tsx`, POST-only `$id.confirm/cancel/complete.tsx`, `$id.lines.*`, `$id.charges.*`, `$id.quote.tsx`, `$id.order.tsx`, `$id.purchase-order.tsx` (`create: "purchasing"`), `$id.$lineId.repaired.tsx`, `$id.warranty.tsx` (apply repair warranty), `$id.delete.tsx`, PDF at `$id[.]pdf.tsx`.
- Warranty registration detail `x+/warranty-registration+/`: `$id.tsx`, `new.tsx`, certificate PDF at `$id[.]pdf.tsx`.
- RMA: `x+/sales-return-order+/$id.$lineId.repair.tsx` (create/link repair order, sets disposition).
- All repair/warranty routes `requirePermissions` with `"sales"`; receipt/shipment routes unchanged.

### Documents
Repair Order PDF (customer/supplier addresses, lines, custody, reference numbers) and Warranty Certificate PDF (registration id, item, serial, coverage table, dates) in `packages/documents`, following the return-order PDF block pattern; `documentSourceType` values added above.

## UI Changes

- **Nav**: "Repairs" and "Warranties" items in the Sales sidebar group; "Warranty Terms" alongside Return Reasons.
- **Warranty terms** CRUD (name, parts/labor coverage + durations, start basis) — the return-reasons quartet pattern.
- **Warranty registrations list** (`ui/Warranties/`): readable id, item, serial/batch chip, customer, start date, per-class expiration badges (Active/Expired), supplier-warranty badge; certificate download. Detail drawer with editable dates (per-unit override) + manual-registration form.
- **Item form** (Sales/Planning section): Warranty Term + Supplier Warranty Term selects.
- **Repairs list** (`ui/Repairs/RepairOrdersTable.tsx`): readable id, customer, status badge, custody rollup (e.g. "1 at supplier"), supplier, promised date, assignee; standard table conventions.
- **Repair order detail**: header card (status actions Confirm/Cancel/Complete, customer + supplier cards, linked RMA/quote/SO/PO chips) + **lines table** (item, entity chips, custody status badge, warranty verdict badge, reason, Mark Repaired action) + **charges table** (type, item/description, qty, price, billing-code select defaulted from coverage, issue-parts action, billable total preview) + panels for related **Receipts**, **Shipments**, **Quote/Order**, **Purchase Order**.
- **New repair order form**: customer select → optional entity picker (entities shipped to that customer, surfacing each unit's registration + verdict inline) or blind item lines; `orderDate` via `useCompanyToday()`.
- **RMA line form**: `'Repair'` appears in the disposition picker; selecting it routes to the create-repair-order action (mirrors the Scrap/Rework Issue escalation UX); RMA detail gains a linked-repair chip.
- **Receipts/Shipments UI**: add `"Repair Order"` to the active source-document lists in `inventory.models.ts`; the tracking route's On Hold allowance extends to the repair source.
- **MES**: no changes.

## Acceptance Criteria

- [ ] An item with a warranty term (parts 12 mo, labor 6 mo, Ship Date basis) shipped on a posted sales shipment auto-creates one `warrantyRegistration` per shipped serial with correct per-class expiration dates; voiding the shipment removes them; a manual registration survives unrelated voids.
- [ ] An untracked item with a warranty term registers one row per shipment line with the shipped quantity.
- [ ] A tracked unit originally received from a supplier whose item has a supplier warranty term registers `supplierId` + `supplierWarrantyExpirationDate` from the purchase-receipt date.
- [ ] The registration's certificate PDF downloads with readable id, serial, and coverage dates; registration dates are editable per unit.
- [ ] Creating an RMA line or repair line for a registered serial shows the advisory verdict (in/out per class); an expired unit can still proceed (no block).
- [ ] Setting an RMA line's disposition to `'Repair'` creates a linked repair order whose line starts `'Received'` holding the same `On Hold` entity; re-invoking links the existing order (idempotent); the RMA can then Complete while the repair stays open.
- [ ] A standalone repair order for a customer's serial receives it via a `'Repair Order'` receipt: zero-value layer, same entity re-tagged `Consumed → On Hold`, `'Repair Receipt'` activity, line `'Received'`; void restores prior state.
- [ ] Shipping a `'Received'` line to the header supplier flips it `'At Supplier'` (entity `Consumed`, `'Repair Shipment'` activity); receiving it back flips it `'Repaired'` with the SAME entity `On Hold` again — the genealogy graph shows the full customer → shop → supplier → shop chain on one entity id.
- [ ] The custody view answers "where is entity X" (in shop / at supplier / shipped back) from the open repair order line.
- [ ] Create Repair PO drafts a PO on the supplier with a service fee line, linked and idempotent; a banner appears when the unit's supplier warranty still covers today.
- [ ] A Part charge on a warranty-covered line defaults `billingCode 'Warranty'`; issuing it posts negative `itemLedger 'Repair Consumption'` and journals `Dr Warranty Expense / Cr Inventory` at cost (accounting enabled); flipping the charge to `Billable` before issue posts `Dr COGS` instead.
- [ ] With no `warrantyCostAccount` configured, warranty consumption falls back to `costOfGoodsSoldAccount`.
- [ ] Create Quote from two Billable charges drafts a Carbon quote with those lines and links it; `convertQuoteToOrder` on acceptance links the resulting SO to the repair order; Create Sales Order works directly when no quote is wanted.
- [ ] Shipping a `'Repaired'` line back to the customer flips it `'Shipped'` (entity `Consumed`); Complete is blocked while any non-closed line is not `'Shipped'`; short-closing a line unblocks it; Cancel is blocked once anything is received.
- [ ] Apply Repair Warranty at completion re-stamps the unit's registration from the completion date with the chosen term.
- [ ] A custody-mismatched posting (e.g. supplier-shipping a `'Pending'` line, double-receiving an `'At Supplier'` line via two concurrent receipts) is refused under row lock.
- [ ] Zero-value custody: a received repair unit contributes 0 to inventory valuation and does not appear as available/nettable stock.
- [ ] All new tables enforce RLS (cross-company reads return nothing); routes 403 without the corresponding `sales`/`purchasing` permission.
- [ ] `pnpm run generate:types`, scoped typecheck, lint, and existing receipt/shipment/returns tests pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `post-receipt`/`post-shipment` are load-bearing for daily receiving/shipping; two more source branches each | High | Same additive-branch discipline the returns module used twice; existing tests + repair fixtures; branches keyed strictly on `sourceDocument` |
| Registration insertion inside the sales `post-shipment` path could slow or fail high-line shipments | Med | Bulk insert once per posting; failure to register must not fail the posting (log + surface); no per-line queries (N+1 rule) |
| Zero-value custody units polluting on-hand/valuation reads | Med | `On Hold` is already excluded from available; acceptance criterion pins valuation = 0; audit `get_inventory_quantities` consumers for the repair location |
| Custody-state machine drift between document legs (double receipts, out-of-order posts) | Med | Row-locked state checks at posting (returns cap pattern); void paths restore the prior state symmetrically |
| Supplier-warranty resolution from genealogy is heuristic (multi-hop, split entities) | Med | Resolve only a direct purchase-receipt ancestor; leave supplier fields NULL when ambiguous — advisory data, never load-bearing |
| `ALTER TYPE … ADD VALUE` transaction restrictions | Med | Own-statement migrations per `database-migration-patterns.md`; follow existing enum-addition precedents |
| Warranty GL misrouting (billing code flipped after issue) | Low | `billingCode` locked once `issuedAt` is set; re-code requires a reversing re-issue |
| Users expect repair labor-hour capture (jobs) | Low | Explicitly out of scope by architecture decision; Service charges carry amounts; the jobs-based execution path is documented as a separate future feature |

## Open Questions

> All resolved with the user (Sid) before this spec was written, per the spec-writing gate.

- [x] How does the supplier round trip execute — document, job + outside processing, or extended supplier return? — **Answer (Sid):** a repair order **document** with its own ship-out/receive-back legs riding the existing shipments/receipts machinery. No production-machinery surgery; `purchaseReturnOrder` keeps its shipped-for-credit semantics; job-based execution (identity-preserving repair jobs) is a separate future feature.
- [x] Where do repair orders originate, and who owns the customer legs? — **Answer (Sid):** **standalone + RMA-spawned**. The repair order owns intake and ship-back uniformly; RMA-spawned lines take custody at `'Received'` and the RMA completes independently.
- [x] What do warranty registrations cover? — **Answer (Sid):** **tracked + untracked** — per-entity rows for serial/batch, per-shipment-line quantity rows for untracked (identity-preserving re-entry remains tracked-only).
- [x] How is "unit at the supplier" represented? — **Answer (Sid):** **repair-order line state** (`At Supplier`), not a new `trackedEntityStatus` value; entities keep the proven `Consumed`/`On Hold` semantics, a view answers the location question. An entity-level status can be added later without rework.
- [x] Billing scope? — **Answer (Sid):** the **full research-backed consensus model, no phasing** — per-charge billing codes defaulted from coverage and overridable (BC/SyteLine), quote-first via a linked Carbon quote (`convertQuoteToOrder` on acceptance), direct SO alternative, invoicing through existing machinery, warranty GL routing (SyteLine precedent).
- [x] Warranty certificate ("warranty card") PDF? — **Answer (Sid):** **include** — per-registration customer-facing certificate PDF; no surveyed ERP ships one.
- [x] Scope boundary — what is explicitly out? — **Answer (Sid, accepting recommendation):** loaners, advance exchange, meter/usage-based warranty, OEM-partner reimbursement claims, warranty accrual reserves, and jobs-based repair execution — packaged as separate features (matching competitor packaging), not deferred phases of this one.

## Changelog

- 2026-08-27: Created. Research at `.ai/research/2026-08-20-warranty-repairs.md`; internal recon (returns-module state, rework path, outside processing, tracked-entity semantics, module conventions) summarized in the spec body. All seven open questions resolved with Sid before writing, per the spec-writing gate.

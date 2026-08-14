# Returns — Customer RMAs (`salesReturnOrder`) + Supplier Returns (`purchaseReturnOrder`)

> Status: draft
> Author: Claude (with Sid)
> Date: 2026-08-07
> Research: `.ai/research/2026-08-07-rma-module.md` (BC, NetSuite, Epicor, Infor, SAP B1, Odoo, Katana — primary-source cited)

## TLDR

Add a Return Merchandise Authorization document to the Sales module: a **non-posting `salesReturnOrder` header + lines** that authorizes a customer return, receives goods through the **existing receipts system** (the unused `"Sales Return Order"` value in `receiptSourceDocument` was built for exactly this), re-enters inventory at **original outbound cost** (exact cost reversing), reactivates the **same `trackedEntity`** for serialized/batch goods (genealogy survives the round trip), routes complex dispositions through the **existing quality Issues module**, and settles money by generating the **existing AR credit `memo`** and/or a linked **replacement sales order**. No parallel receiving, costing, quality, or credit subsystem is built — the RMA document is the connective tissue between machinery Carbon already has.

The purchasing side is the mirror image (added per PR #1354 review): a **`purchaseReturnOrder`** authorizes returns TO suppliers, ships through the **existing shipments system** (`"Purchase Return Order"` was pre-plumbed there too), relieves inventory at carried cost, and settles via a **supplier credit `memo`** — same table shapes, direction flipped, with the quality Issue `'Return to Supplier'` disposition as the bridge that drafts one (Epicor's DMR→vendor-return pattern).

## Problem Statement

Carbon has no way to process a customer return. Today a shop that gets a defective part back must fake it: a manual inventory adjustment (wrong cost, no provenance), a hand-created credit memo (no linkage to what came back), no authorization number to give the customer, no reversible-quantity control (nothing stops crediting more than was sold), no inspection/disposition trail, and a broken genealogy chain for serialized goods.

The schema shows this was always intended: `receiptSourceDocument` and `shipmentSourceDocument` already contain **both** `"Sales Return Order"` and `"Purchase Return Order"` (commented out in `inventory.models.ts` pickers), `itemLedgerDocumentType` already contains `"Sales Return Receipt"` and `"Purchase Return Shipment"`, `salesInvoiceStatus` has unused `"Return"` / `"Credit Note Issued"` values, and the glossary describes shipment sources as "a sales order, an outbound transfer, or an RMA return". None of it is wired to anything.

The supplier direction is equally unserved: today the quality module's `'Return to Supplier'` disposition writes inventory out directly at issue close (`post-nonconformance`) with no authorization document, no paperwork for the supplier, no supplier-RMA-number tracking, and no linkage to the AP credit that should follow.

Every document-first ERP surveyed (Business Central, NetSuite, Epicor, Infor, SAP B1, Katana) models this the same way — a non-posting authorization document distinct from the receipt and the credit memo (research §Synthesis 1–10). Odoo, the one system without an RMA object, is the cautionary tale: nowhere to hang authorization state, reasons, dispositions, or expected-vs-received tracking.

## Proposed Solution

### Workflow

```
Draft ──confirm──▶ Confirmed ──receive──▶ Partially Received ──▶ Received ──complete──▶ Completed
  │                    │                                            (guard: no Pending
  └──cancel──▶ Cancelled (only while nothing received)               dispositions on
                                                                     received qty)
```

1. **Authorize.** CSR creates an RMA for a customer — standalone (blind return) or from a sales order / shipment / invoice, which pre-fills lines and enforces reversible quantities (can't authorize more than was shipped minus already returned). Lines carry item, quantity, unit price (credit basis), a **return reason** (why — company-defined code table), optional links to the originating `salesOrderLine` / `shipmentLine` / `salesInvoiceLine`, and for tracked items the specific `trackedEntity` rows the customer is sending back. Confirming assigns the readable `RMA000001` id's terminal state and produces a PDF to send to the customer.
2. **Receive.** Goods arrive → a **receipt** with `sourceDocument = 'Sales Return Order'` (the existing receipts UI + `create` edge function, new source branch). Partial receipts are natural. Posting the receipt (`post-receipt` extension): positive `itemLedger` rows (`entryType 'Sale'`, `documentType 'Sales Return Receipt'`), cost layer at the **original outbound cost** when linked (walk the shipment's `costLedger` consumption), current cost for blind returns, **zero** when the line's return reason has `inventoryValueZero` (BC's damaged-goods pattern); journal `Dr Inventory / Cr COGS` at the re-entry value (gated on `accountingEnabled`). Tracked goods **reactivate the same `trackedEntity`** (status `On Hold`) with a `'Return Receipt'` `trackedActivity`; blind tracked returns create a new entity, also `On Hold`.
3. **Disposition** (per line, after receipt). Lightweight outcomes execute directly on the RMA:
   - **Use As Is** → restock: tracked entity flips `Available`; untracked stock is already on hand — no GL.
   - **Return to Customer** (claim rejected) → shipment with `sourceDocument 'Sales Return Order'` ships it back; negative ledger at carried cost.
   - **Scrap / Rework / anything needing MRB** → escalate to a **quality Issue** (new `'Sales Return Order'` association). The Issue owns the disposition, approvals, and GL write-off via the existing `post-nonconformance` machinery — Epicor's Fail→DMR bridge, using Carbon's own non-conformance system (research §Epicor, §Implications 4).
4. **Settle.** From the RMA: **Issue Credit** generates an AR `memo` (direction `Credit`, existing table + `post-memo` posting) from received-not-yet-credited quantities × unit price, minus per-line restocking fee; per-line breakdown is stored in `salesReturnOrderCreditLine` (the memo itself stays header-level — schema unchanged). Multiple partial credits per RMA are allowed; application to invoices / refunds ride the existing credit-application-via-payment flow. **Create Replacement Order** spawns a draft sales order pre-filled from RMA lines (NetSuite's post-receipt pattern), linked via `replacementSalesOrderId`.
5. **Complete.** Manual action, guarded: every non-closed line fully received and no received quantity still `Pending` disposition (mirrors `closeIssue`'s guard). Lines the customer will never send can be short-closed (`closedComplete`, the PO short-close pattern).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Document model | New non-posting `salesReturnOrder` + `salesReturnOrderLine`; NOT a quality-issue flavor, NOT negative SO lines | Unanimous competitor pattern (research §Synthesis 1); Carbon's enums were pre-plumbed for exactly this document; Issues lack logistics/credit machinery. Odoo's no-document approach leaves state homeless |
| Module home / permissions | Sales module: code in `modules/sales/`, routes `handle.module: "sales"`, gated by existing `sales_*` scopes. Receiving stays `inventory_*`, credit stays `invoicing_*` | Lesson "Features live inside existing permission modules"; permission scopes are FROZEN surfaces — adding none. Epicor files RMA under Sales Management too |
| Naming | Tables `salesReturnOrder` / `salesReturnOrderLine`; UI label "RMAs"; sequence prefix `RMA` | Matches the pre-existing enum literal `"Sales Return Order"` and `salesOrder` symmetry; the mirrored `purchaseReturnOrder` is specced in the Purchasing Side section (research §Synthesis 10) |
| Line linkage | Nullable FKs to `salesOrderLine`, `shipmentLine`, `salesInvoiceLine`; blind returns fully supported | Optional-but-rich linkage is table stakes (research §Synthesis 2): link drives reversible-qty validation, credit pricing, and cost reversal |
| Status lifecycle | Enum `salesReturnOrderStatus`: `Draft`, `Confirmed`, `Partially Received`, `Received`, `Completed`, `Cancelled` — receipt-driven transitions, manual guarded Complete | Quantity-derived statuses are the NetSuite/Infor/Katana consensus (research §Synthesis 3); Carbon precedent: receipt/shipment posting already flips source-doc statuses. No approval stage in v1 (only NetSuite/Infor make it first-class) |
| Receiving | Reuse receipts end-to-end: activate `"Sales Return Order"` in `receiptSourceDocumentType`, extend `create` + `post-receipt` edge functions | No surveyed system invents a parallel receiving stack (research §Synthesis 4); inspection hook (`requiresInspection` → `On Hold`) already sits in `post-receipt` |
| Ledger identity | `itemLedger.entryType 'Sale'` (positive qty), `documentType 'Sales Return Receipt'` | Symmetric with shipments (`'Sale'` negative, `'Sales Shipment'`); the document type value already exists unused |
| Costing | Linked lines re-enter at original outbound cost (reverse the shipment's `costLedger` consumption); blind at current cost; `returnReason.inventoryValueZero` forces a 0-value layer | BC exact cost reversing + Epicor FIFO walk-back (research §Synthesis 7); zero-value is BC's per-reason damaged-goods hook |
| Disposition split | RMA line `disposition` uses the **existing `disposition` enum** (+ additive `'Return to Customer'` value); picker subset `Pending / Use As Is / Return to Customer / Scrap / Rework`; Scrap/Rework/MRB **execute** via an escalated quality Issue | Research §Implications 4: reuse the quality vocabulary, don't build a second disposition subsystem. Quality already owns MRB, non-tracked quantity rows, and scrap GL (`post-nonconformance`) |
| Reason vs disposition | Separate code sets: `returnReason` (why, set at authorization) vs `disposition` (what we did, set after receipt) | Infor's Problem Code / Disposition Code split (research §Infor, §Synthesis 9) |
| Credit | Generate existing AR `memo` (header-level, unchanged shape) + per-line `salesReturnOrderCreditLine` breakdown; `quantityCredited` **derived** from credit lines joined to Posted memos, not stored | Carbon's memo has no lines; the breakdown table gives partial credits, void-safety (voided memo drops out of the derivation), and status guards without denormalized counters |
| Restocking fee | `restockFeePercent` NUMERIC fraction 0–1 per line, default 0, applied at credit generation | Only BC documents a mechanism (per-line charge); fraction-0–1 matches Carbon's `discountPercent` convention |
| Credit GL account | New nullable `accountDefault.salesReturnsAccount` (contra-revenue), fallback `salesAccount`; passed as the memo's `reasonAccount` | Lesson: control accounts resolve via `accountDefault` by id, never by number; `post-memo` already journals off `reasonAccount` — zero posting changes |
| Replacement | `Create Replacement Order` action → draft SO from RMA lines (prices via `resolvePrice`, user adjusts, e.g. to zero for warranty); link stored as `salesReturnOrder.replacementSalesOrderId` | NetSuite post-receipt replacement SO (research §Synthesis 8); link lives on the NEW table so `salesOrder` is untouched |
| Serial/lot | Expected entities picked per line (`salesReturnOrderLineTrackedEntity`) from entities shipped to that customer; receipt **reactivates the same entity** `On Hold`; disposition flips it | BC re-applies the same tracking identity; NetSuite picks "serial sold to this customer"; same-entity re-entry preserves genealogy — a differentiator no lightweight competitor manages (research §Implications 8) |
| Multi-tenancy (heuristic 1) | Every new table: `companyId`, composite PK `("id","companyId")`, `id('prefix')`/`xid()` defaults, audit columns, `customFields` | House convention (`conventions-database.md`) |
| Service shape (heuristic 2) | All new functions in `sales.service.ts`: client first arg, return `{data, error}`, never throw, `companyId`-scoped | House convention |
| RLS (heuristic 3) | Policies named exactly `SELECT/INSERT/UPDATE/DELETE`; SELECT via `get_companies_with_employee_role()`, writes via `get_companies_with_employee_permission('sales_*')` (credit-line table: `invoicing_*` writes) | Post-rls-refactor convention; v1 is employee-only (no portal SELECT) |
| Permission scoping (heuristic 4) | RMA routes `{action}: "sales"`; receipt routes unchanged (`inventory`); credit generation `create: "invoicing"` (same as `x+/credits+/new`) | Matches the owning machinery of each step |
| Forms (heuristic 5) | `ValidatedForm` + `validator(zodSchema)` + route actions; business dates default via `useCompanyToday()` | House convention; date-handling rule |
| Module layout (heuristic 6) | Extends `sales.models.ts` / `sales.service.ts` / `modules/sales/ui/SalesReturnOrders/`; no new module folder | One service/models file per module (root AGENTS.md "Never") |
| Backward compat (heuristic 7) | Everything additive: new tables, new enum values, new nullable columns (`memo.salesReturnOrderId`, `accountDefault.salesReturnsAccount`). No renames, no drops, no scope changes | `BACKWARD_COMPATIBILITY.md`: DB schema is ADDITIVE-ONLY; permission scopes FROZEN (none added) |

## Data Model Changes

One migration (`pnpm db:migrate:new sales-return-orders`), all additive. `pnpm run generate:types` after.

### Enums

```sql
CREATE TYPE "salesReturnOrderStatus" AS ENUM (
  'Draft', 'Confirmed', 'Partially Received', 'Received', 'Completed', 'Cancelled'
);
ALTER TYPE "disposition" ADD VALUE 'Return to Customer';                -- mirrors 'Return to Supplier'
ALTER TYPE "nonConformanceAssociationType" ADD VALUE 'Sales Return Order';
```

### `returnReason` (why — company-defined, `noQuoteReason` pattern)

```sql
CREATE TABLE "returnReason" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "name" TEXT NOT NULL,
    "inventoryValueZero" BOOLEAN NOT NULL DEFAULT FALSE,  -- BC hook: item re-enters at zero value
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    UNIQUE ("companyId", "name")
);
```

Seed per company (migration backfill + `seed.data.ts` + `seed-company`): `Defective`, `Wrong Item Shipped`, `Damaged in Transit`, `No Longer Needed`, `Warranty`, `Other`.

### `salesReturnOrder` (header)

```sql
CREATE TABLE "salesReturnOrder" (
    "id" TEXT NOT NULL DEFAULT id('sro'),
    "salesReturnOrderId" TEXT NOT NULL,                   -- readable RMA000001 via get_next_sequence
    "status" "salesReturnOrderStatus" NOT NULL DEFAULT 'Draft',
    "customerId" TEXT NOT NULL,                           -- → customer
    "customerLocationId" TEXT,
    "customerContactId" TEXT,
    "customerReference" TEXT,                             -- the customer's claim / PO number
    "locationId" TEXT,                                    -- receiving site
    "salesOrderId" TEXT,                                  -- convenience header link (lines are authoritative)
    "replacementSalesOrderId" TEXT,                       -- → salesOrder, SET NULL on delete
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" NUMERIC(10,5) NOT NULL DEFAULT 1,
    "orderDate" DATE NOT NULL,                            -- company-calendar day (useCompanyToday)
    "expirationDate" DATE,                                -- informational authorization window
    "internalNotes" JSON,
    "externalNotes" JSON,
    "assignee" TEXT REFERENCES "user"("id"),
    "companyId" TEXT NOT NULL,
    -- audit columns + customFields as per template
    PRIMARY KEY ("id", "companyId"),
    UNIQUE ("salesReturnOrderId", "companyId")
);
```

FKs: `customerId` → `customer`, `locationId` → `location`, `salesOrderId`/`replacementSalesOrderId` → `salesOrder` (ON DELETE SET NULL). Indexes on `companyId`, `customerId`, `status`.

### `salesReturnOrderLine`

```sql
CREATE TABLE "salesReturnOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('srol'),
    "salesReturnOrderId" TEXT NOT NULL,                   -- → salesReturnOrder ON DELETE CASCADE
    "lineNumber" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT NOT NULL,                               -- required: receipts need an item
    "quantity" NUMERIC NOT NULL,                          -- authorized to return
    "quantityReceived" NUMERIC NOT NULL DEFAULT 0,        -- maintained by post-receipt (void-safe)
    "unitOfMeasureCode" TEXT,
    "unitPrice" NUMERIC NOT NULL DEFAULT 0,               -- credit basis (copied from linked line when present)
    "restockFeePercent" NUMERIC NOT NULL DEFAULT 0,       -- fraction 0–1, like discountPercent
    "returnReasonId" TEXT,                                -- → returnReason
    "salesOrderLineId" TEXT,                              -- all three nullable: blind returns allowed
    "shipmentLineId" TEXT,
    "salesInvoiceLineId" TEXT,
    "disposition" "disposition" NOT NULL DEFAULT 'Pending',
    "closedComplete" BOOLEAN NOT NULL DEFAULT FALSE,      -- short-close: stop expecting remainder
    "companyId" TEXT NOT NULL,
    -- audit columns + customFields
    PRIMARY KEY ("id", "companyId")
);
```

### `salesReturnOrderLineTrackedEntity` (expected serials/batches)

```sql
CREATE TABLE "salesReturnOrderLineTrackedEntity" (
    "salesReturnOrderLineId" TEXT NOT NULL,
    "trackedEntityId" TEXT NOT NULL,                      -- → trackedEntity (picked from entities shipped to this customer)
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("salesReturnOrderLineId", "trackedEntityId", "companyId")
);
```

### `salesReturnOrderCreditLine` (per-line credit breakdown; the memo stays header-level)

```sql
CREATE TABLE "salesReturnOrderCreditLine" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "memoId" TEXT NOT NULL,                               -- → memo ON DELETE CASCADE
    "salesReturnOrderLineId" TEXT NOT NULL,               -- → salesReturnOrderLine
    "quantity" NUMERIC NOT NULL,
    "unitPrice" NUMERIC NOT NULL,
    "restockFee" NUMERIC NOT NULL DEFAULT 0,              -- computed amount, stored for audit
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id", "companyId")
);
```

`quantityCredited` per RMA line = `SUM(quantity)` over credit lines whose memo is `Posted` — derived in the views, never stored. Deleting/voiding a memo automatically un-credits.

### Quality association junction (mirrors the existing 10)

```sql
CREATE TABLE "nonConformanceSalesReturnOrderLine" (
    "nonConformanceId" TEXT NOT NULL,
    "salesReturnOrderLineId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("nonConformanceId", "salesReturnOrderLineId", "companyId")
);
```

### Additive columns on existing tables

```sql
ALTER TABLE "memo" ADD COLUMN "salesReturnOrderId" TEXT;              -- nullable FK → salesReturnOrder, SET NULL
ALTER TABLE "accountDefault" ADD COLUMN "salesReturnsAccount" TEXT;   -- nullable; fallback = salesAccount
```

Seed a `Sales Returns` contra-revenue posting account under the Income group for existing companies — resolve the parent group by `"isGroup" = TRUE AND name`, **never by number** (lesson; `20260630093809_ar-ap-payments.sql` is the precedent), plus `seed.data.ts`/`seed-company` for new companies.

### Sequence + view

- `sequence` seed rows per company: `("table","name","prefix","next","size","step","companyId")` = `('salesReturnOrder','Sales Return Order','RMA',…)` — same INSERT shape as `20260630093809`.
- `salesReturnOrders` view (`SECURITY_INVOKER=true`): header + customer name + aggregate `linesCount`, `quantityReceived`, `quantityCredited` (derived as above) — the `issues` view precedent, read by the list table.

### RLS

All new tables: policies named exactly `SELECT` / `INSERT` / `UPDATE` / `DELETE`. `SELECT` via `(SELECT get_companies_with_employee_role())::text[]`; writes via `(SELECT get_companies_with_employee_permission('sales_<action>'))::text[]` — except `salesReturnOrderCreditLine` writes gated on `invoicing_<action>` (it is created by the credit flow). Junction tables derive visibility from their parents per the standard pattern. v1 has **no** customer-portal SELECT arm.

## API / Service Changes

### `sales.models.ts`
`salesReturnOrderValidator`, `salesReturnOrderLineValidator`, `returnReasonValidator`, `salesReturnOrderStatusType` const array, `salesReturnDispositionType` picker subset (`Pending`, `Use As Is`, `Return to Customer`, `Scrap`, `Rework`) — same commented-subset technique `quality.models.ts` uses on `disposition`.

### `sales.service.ts` (client-first, `{data, error}`, `companyId`-scoped)
`getSalesReturnOrders` (view + generic filters), `getSalesReturnOrder`, `getSalesReturnOrderLines`, `upsertSalesReturnOrder`, `upsertSalesReturnOrderLine`, `deleteSalesReturnOrder(Line)`, `confirmSalesReturnOrder`, `cancelSalesReturnOrder`, `completeSalesReturnOrder` (guard: all non-closed lines received; no received qty `Pending`), `getReturnReasons` + CRUD, `getReturnableLinesForCustomer` (reversible-quantity source: shipped/invoiced minus already authorized/returned — BC "Show Reversible Lines Only"), `getShippedTrackedEntitiesForCustomer` (entity picker source), `createReplacementSalesOrder`, `createSalesReturnOrderCredit`.

**Quantity caps are transactional invariants (both directions).** The reversible cap (shipped/received minus already authorized+returned) and the credit cap (received minus already credited) are enforced inside a Kysely transaction that row-locks the governing rows (`SELECT … FOR UPDATE` on the return line and its linked source line) and re-reads the aggregates before writing. Confirm, receipt/shipment posting, and credit creation/posting all pass through this check — two concurrent partial returns (or partial credits) against the same source line cannot jointly exceed the cap. Voided memos re-enter the creditable pool automatically since `quantityCredited` derives from `Posted` memos only.

### Edge functions (extensions, no new functions except disposition posting decision below)
- **`create`** — new branch in the `receipt` case: `sourceDocument: "Sales Return Order"` builds `receiptLine`s from open RMA lines (`quantity − quantityReceived`, skipping `closedComplete`), copying location/uom; `sourceDocumentReadableId = salesReturnOrder.salesReturnOrderId`.
- **`post-receipt`** — return branch: positive `itemLedger` (`'Sale'` / `'Sales Return Receipt'`); `costLedger` layer at resolved cost (linked → original outbound cost from the shipment's consumed layers; blind → current item cost; `returnReason.inventoryValueZero` → 0); journal `Dr resolveInventoryAccount / Cr accountDefault.costOfGoodsSoldAccount` at layer value when `accountingEnabled`; tracked entities: reactivate the SAME `trackedEntity` (`status 'On Hold'`) when the receipt line maps to an expected entity, else create new `On Hold`; write a `'Return Receipt'` `trackedActivity` (+output links); bump `quantityReceived` and transition header status (`Confirmed → Partially Received → Received`). Receipt **void** reverses all of it (existing void pattern).
- **Dispositions**: `Use As Is` flips entity → `Available` (service-level, no GL). `Return to Customer` creates a shipment `sourceDocument 'Sales Return Order'` (activate the value in `shipmentSourceDocumentType`; `post-shipment` branch posts the negative ledger at carried cost). `Scrap`/`Rework` are **not executed by the RMA**: the line action creates/links a quality Issue pre-associated via `nonConformanceSalesReturnOrderLine` (+ tracked entities), and the Issue's existing close flow (`post-nonconformance`) posts the write-off. The RMA line's `disposition` field records the outcome.
- **Credit**: `createSalesReturnOrderCredit` inserts one `memo` (`direction 'Credit'`, `customerId`, RMA currency/exchange, `reasonAccount = accountDefault.salesReturnsAccount ?? salesAccount`, `salesReturnOrderId`) + `salesReturnOrderCreditLine` rows; amount = Σ qty × unitPrice × (1 − restockFeePercent). Posting/voiding stays entirely in the existing `x+/credits+` routes + `post-memo` — no changes there.

### Routes (`path.to` additions)
- List `x+/sales+/rmas.tsx`; reasons CRUD quartet `x+/sales+/return-reasons(.new/.$id/.delete.$id).tsx` (clone the `no-quote-reasons` quartet).
- Detail tree `x+/sales-return-order+/`: `_layout.tsx` (`handle.module: "sales"`), `$id.tsx` (+`details`), `new.tsx`, POST-only `$id.confirm/cancel/complete.tsx`, `$id.lines.*`, `$id.credit.tsx` (`create: "invoicing"`), `$id.replacement.tsx`, `$id.delete.tsx`, PDF at `$id[.]pdf.tsx`.
- All RMA routes `requirePermissions` with `"sales"`; receipt/shipment routes unchanged.

### Documents
RMA PDF in `packages/documents` (header, customer, lines, reasons, return-to address, expiration) following the sales-order PDF pattern; wired to the `[.]pdf` route and the Confirm flow.

## UI Changes

- **Nav**: "RMAs" item in the Sales sidebar group.
- **List** (`ui/SalesReturnOrders/SalesReturnOrdersTable.tsx`): readable id, customer, status badge, order date, received/credited progress, assignee; standard table conventions (CSV export, filters, saved views).
- **Detail**: header card (status flow Confirm/Cancel/Complete actions, customer, dates, replacement-order link) + lines table (item, qty authorized/received/credited, unit price, restock fee, reason, disposition select using the picker subset, linkage chips to SO/shipment/invoice, tracked-entity chips) + panels for related **Receipts**, **Credits** (memos via `memo.salesReturnOrderId`), and **Issues** (via the association).
- **New RMA form**: customer select → optional "from document" picker (`getReturnableLinesForCustomer`) pre-filling lines with reversible quantities, prices, and links; line editor with `TrackedEntityPicker` filtered to entities shipped to that customer; `orderDate` defaults via `useCompanyToday()`.
- **Receipts UI**: uncomment `"Sales Return Order"` in `receiptSourceDocumentType` (and `shipmentSourceDocumentType` for return-to-customer) in `inventory.models.ts`; the source-document select then lists open RMAs — no other receipts UI work.
- **Credit dialog**: per-line quantity (default received − credited), fee preview, total; submits to `$id.credit`.
- **Quality**: `IssueAssociations` gains the Sales Return Order association type (render + create like the existing ten).
- **MES**: no changes.

## Purchasing Side — `purchaseReturnOrder` (Supplier Returns)

Added per review on PR #1354. A direction-flipped mirror of the customer side: the customer RMA **receives**, the supplier return **ships** (research §Synthesis 10; NetSuite Vendor RA: enter → approve → ship → credit; BC purchase return orders → posted return shipments → purchase credit memo). Everything below reuses the sales-side design verbatim unless a delta is called out — same conventions (multi-tenancy, RLS naming, service shape, additive-only) apply.

### Workflow

`Draft → Confirmed → Partially Shipped → Shipped → Completed / Cancelled` (enum `purchaseReturnOrderStatus`). Authorize lines (optionally from a PO / receipt / purchase invoice, with reversible-quantity validation against received-minus-already-returned) → confirm (assigns readable id, PDF for the supplier's RMA process; header `supplierReference` carries the **supplier's own RMA number** — NetSuite records both numbers) → ship through the existing shipments system (`shipmentSourceDocument 'Purchase Return Order'`, pre-plumbed) → generate supplier credit memo(s) → optional replacement PO → guarded Complete with `closedComplete` short-close.

There is **no disposition stage** — goods leave; the decision of *what* to send back was already made (usually by a quality Issue). There is no `inventoryValueZero` analog either: outbound relief is always at carried cost.

**Source lineage & units.** The three line links have distinct jobs: `receiptLineId` is the **physical** lineage — it anchors the reversible-quantity base, the tracked-entity pick, and the receipt posting the shipment journal reverses; `purchaseOrderLineId` / `purchaseInvoiceLineId` are **commercial** context (credit pricing). An invoice- or PO-linked line must resolve to a posted receipt allocation to claim linked lineage; when it can't (invoice-only, goods not yet received into a resolvable receipt), the line is explicitly a **blind return** — carried-cost relief with a manual entity pick, same as a link-free line. Return lines store quantities and `unitPrice` in the item's **inventory unit of measure**, always: purchase lines live in purchase UOM (`purchaseQuantity` × `conversionFactor` → inventory units), so authoring from a PO/invoice line converts quantity and price through that line's `conversionFactor` once, at authoring time — validation, shipment posting, and credit math all run in inventory units (the unit `receiptLine` and `itemLedger` already post in).

### Deltas vs the sales side

| Aspect | Sales side | Purchase side |
|--------|-----------|---------------|
| Physical flow | Receipt (`receiptSourceDocument 'Sales Return Order'`) | Shipment (`shipmentSourceDocument 'Purchase Return Order'`), `post-shipment` branch |
| Ledger identity | `entryType 'Sale'`, positive, `'Sales Return Receipt'` | `entryType 'Purchase'`, **negative**, `'Purchase Return Shipment'` (pre-existing unused value) |
| Cost | Original outbound cost / current / zero | Carried layer cost (standard consumption math — no policy choice) |
| Journal | `Dr Inventory / Cr COGS` | `Cr Inventory / Dr goodsReceivedNotInvoicedAccount` (reverses the receipt posting); credit-vs-cost delta → `purchaseVarianceAccount` |
| Tracked entities | Same entity re-enters `On Hold`; disposition flips it | Entities picked from on-hand stock received from that supplier; shipping marks them `Consumed` + `'Return Shipment'` activity (genealogy closed, not broken) |
| Money | AR memo (`customerId`, `reasonAccount = salesReturnsAccount ?? salesAccount`) | AP memo (`supplierId`, direction `Credit`, `reasonAccount = goodsReceivedNotInvoicedAccount` so `post-memo` nets GRNI against payables) |
| Replacement | `replacementSalesOrderId` → draft SO | `replacementPurchaseOrderId` → draft PO |
| Reason codes | `returnReason` | **Same table** — shared across both directions (BC precedent); `inventoryValueZero` is simply ignored outbound |
| Module home | Sales (`sales_*`) | Purchasing (`purchasing.models.ts` / `purchasing.service.ts` / `modules/purchasing/ui/PurchaseReturnOrders/`, `purchasing_*` perms); credit generation `create: "invoicing"` |
| Quality relationship | RMA escalates TO an Issue | An Issue's `'Return to Supplier'` disposition **drafts** a `purchaseReturnOrder` |

### Data model (mirror tables, all additive)

- `purchaseReturnOrder` — same shape as `salesReturnOrder` with: `id('pro')`, readable `purchaseReturnOrderId` (sequence prefix `RTS`, e.g. `RTS000001`), `supplierId` (NOT NULL), `supplierLocationId`/`supplierContactId`, **`supplierReference`** (the supplier's RMA number), `purchaseOrderId` convenience link, `replacementPurchaseOrderId`, status `purchaseReturnOrderStatus`; no reason-hook columns beyond the sales twin.
- `purchaseReturnOrderLine` — same shape as `salesReturnOrderLine` with `id('prol')`, `quantityShipped` (not `quantityReceived`), links `purchaseOrderLineId` / `receiptLineId` / `purchaseInvoiceLineId` (all nullable — blind supplier returns allowed), `unitPrice` = expected credit basis (copied from the linked PO/invoice line), `restockFeePercent` (supplier-charged fee reduces our credit), **no `disposition` column**.
- `purchaseReturnOrderLineTrackedEntity` — expected entities to send back, picked from on-hand entities whose genealogy traces to that supplier.
- `purchaseReturnOrderCreditLine` — mirror of the sales twin (`memoId`, `purchaseReturnOrderLineId`, quantity/unitPrice/fee); `quantityCredited` derived from `Posted` memos the same way.
- `nonConformancePurchaseReturnOrderLine` + `nonConformanceAssociationType` value `'Purchase Return Order'` — Issue ↔ supplier-return linkage for the bridge.
- `ALTER TABLE "memo" ADD COLUMN "purchaseReturnOrderId" TEXT` (nullable, SET NULL).
- `CREATE TYPE "purchaseReturnOrderStatus" AS ENUM ('Draft','Confirmed','Partially Shipped','Shipped','Completed','Cancelled');`
- Sequence seed rows (`'purchaseReturnOrder'`, prefix `RTS`) + a `purchaseReturnOrders` list view mirroring `salesReturnOrders`.
- RLS: identical pattern with `purchasing_*` permissions (`invoicing_*` for the credit-line table). No portal arm.

### Flows

- **Ship**: `create` edge function gains a `shipment` branch for `sourceDocument 'Purchase Return Order'` (lines from open return lines, `quantity − quantityShipped`); `post-shipment` gains the return branch — negative `itemLedger` at carried cost via the existing consumption math, journal per the deltas table, entity flips + `'Return Shipment'` `trackedActivity`, `quantityShipped` bump + status transition, void reverses.
- **Credit**: `createPurchaseReturnOrderCredit` mirrors the sales twin — one AP `memo` + credit lines; posting/voiding untouched in `x+/credits+`.
- **Replacement**: draft PO from return lines (prices from the linked PO line or `supplierPart` pricing; user adjusts for warranty).
- **Quality bridge**: on an Issue whose disposition is `'Return to Supplier'`, a **Create Supplier Return** action drafts a `purchaseReturnOrder`. *Supplier resolution:* exactly one `nonConformanceSupplier` association → that supplier; otherwise derived from the selected receipt lines' parent receipts; missing or conflicting → the dialog requires an explicit supplier and source-line selection (an Issue spanning suppliers yields one draft per supplier). Every selected line and tracked entity is validated to belong to the resolved supplier before the draft is written. *Ownership is per quantity:* each `nonConformancePurchaseReturnOrderLine` association row records the quantity it covers, and the action is **idempotent** — quantities already covered by a non-cancelled linked return are excluded from a new draft (re-invoking with nothing uncovered returns the existing draft). *Close rule (atomic):* `closeIssue` is **blocked** while a linked supplier return is open (`Draft`/`Confirmed`/`Partially Shipped`) — ship, short-close, or cancel it first; at close, `post-nonconformance` writes off only `issue quantity − Σ quantities shipped via linked returns` (covered-and-shipped relief already came from the return shipment; cancelling a return releases its unshipped covered quantities back to the write-off pool).
- **Routes/UI**: list `x+/purchasing+/supplier-returns.tsx` + nav "Supplier Returns" (Purchasing group); detail tree `x+/purchase-return-order+/` mirroring the sales twin (confirm/cancel/complete, lines, credit, replacement, PDF); shipments UI uncomment for `'Purchase Return Order'`; entity picker `getReturnableEntitiesForSupplier`.

## Acceptance Criteria

- [ ] Creating an RMA from a shipped+invoiced sales order pre-fills lines with the shipped quantities, prices, and line links; authorizing more than shipped-minus-already-returned is rejected with a validation error.
- [ ] A standalone (blind) RMA with no document links can be created, confirmed, received, and credited end-to-end.
- [ ] Confirming assigns `RMA000001`-style ids from the company sequence and produces a downloadable PDF.
- [ ] A receipt with source "Sales Return Order" against a confirmed RMA receives a partial quantity; the RMA flips to `Partially Received`, then `Received` when the remainder posts; voiding the receipt restores prior quantities and status.
- [ ] Receiving a linked line for an item shipped at cost X while current cost is Y ≠ X creates the inventory layer at **X** and journals `Dr Inventory / Cr COGS` for X × qty (accounting enabled); a blind line uses current cost; a line whose reason has `inventoryValueZero` posts a 0-value layer and no journal.
- [ ] Returning a serialized item picked on the RMA line reactivates the SAME `trackedEntity` id in `On Hold`, with a `Return Receipt` activity visible in the traceability graph connecting its original shipment history.
- [ ] `Use As Is` disposition flips the returned entity to `Available` and it appears in on-hand quantities; `Return to Customer` creates a postable shipment that removes it again.
- [ ] `Scrap` on a line opens/links a quality Issue carrying the item, quantity, and tracked entities; closing that Issue with a Scrap disposition posts the write-off through `post-nonconformance` (no GL posted by the RMA itself).
- [ ] Issuing credit for 2 of 5 received units at unit price 100 with a 10% restock fee creates a Draft memo for 180 linked to the RMA; after posting, the RMA shows `quantityCredited = 2`; voiding the memo returns it to 0.
- [ ] `Create Replacement Order` produces a draft sales order pre-filled from the RMA lines and both documents show the cross-link.
- [ ] `Complete` is blocked while any received quantity is `Pending` disposition or any non-closed line is short of authorized quantity; short-closing the line unblocks it.
- [ ] A supplier return created from a posted PO receipt pre-fills lines with reversible quantities, prices, and links; authorizing more than received-minus-already-returned is rejected.
- [ ] Shipping a partial quantity against a confirmed supplier return flips it `Confirmed → Partially Shipped → Shipped`; posting relieves inventory at carried layer cost (`Cr Inventory / Dr GRNI`), marks the shipped tracked entities `Consumed` with a `Return Shipment` activity, and voiding the shipment reverses all of it.
- [ ] Issuing supplier credit creates a Draft AP memo (`supplierId`, direction `Credit`, `reasonAccount = goodsReceivedNotInvoicedAccount`) linked via `memo.purchaseReturnOrderId`; posting updates the return's credited quantities; voiding reverts them.
- [ ] Closing a quality Issue with a `'Return to Supplier'` disposition offers **Create Supplier Return**, which drafts a `purchaseReturnOrder` pre-filled with the resolved supplier, items, and tracked entities; re-invoking it drafts nothing new for already-covered quantities; Issue close is blocked while the linked return is open; and after the return shipment posts, closing the Issue writes off only the uncovered remainder (no double relief).
- [ ] A supplier return authored from a purchase-invoice line with `conversionFactor ≠ 1` against a partially received PO stores inventory-unit quantity and price (converted once at authoring), caps authorization at received-minus-already-returned, and an invoice-only line with no resolvable posted receipt allocation is explicitly flagged as a blind return.
- [ ] Two concurrent confirms (or two concurrent credit creations) against the same source line cannot jointly exceed the reversible/creditable cap — the second transaction re-reads under row lock and fails validation.
- [ ] All new tables enforce RLS (cross-company reads return nothing); every route 403s without the corresponding `sales`/`purchasing`/`invoicing` permission.
- [ ] `pnpm run generate:types`, scoped typecheck, lint, and existing inventory/receipt/shipment tests pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Original-cost resolution from shipment cost layers is subtle (partial shipments, corrections, multi-layer consumption) | High | Reuse `calculateCOGS`'s layer math in reverse; fall back to current cost with a flagged variance note when layers can't be resolved; unit-test against multi-layer fixtures |
| `post-receipt` is load-bearing for PO receiving; a regression breaks daily receiving | High | Return branch is additive and switched on `sourceDocument`; existing PO/transfer paths untouched; run existing receipt tests + new return fixtures |
| `post-shipment` is equally load-bearing for daily sales shipping (purchase-return branch) | High | Same additive-branch discipline; existing shipment tests + supplier-return fixtures |
| Issue `'Return to Supplier'` + linked return shipment could double-relieve inventory | Med | Per-quantity ownership on the association rows; Issue close blocked while a linked return is open; write-off = issue qty − shipped-via-return qty (see Quality bridge) |
| `ALTER TYPE … ADD VALUE` cannot run inside a transaction block on older Postgres patterns | Med | Follow the existing enum-addition migrations in the repo (`database-migration-patterns.md`); keep enum additions in their own statements |
| Reactivating a `Consumed`/shipped tracked entity may collide with status assumptions elsewhere (`get_inventory_quantities`, pickers) | Med | Re-entry uses `On Hold` (already excluded from available); audit the status-aware reads before implementation; the disposition step is the only path to `Available` |
| Credit derivation joins (creditLine × memo status) on hot list views | Low | Aggregate inside the `salesReturnOrders` view; index `salesReturnOrderCreditLine(memoId)` and `(salesReturnOrderLineId)` |
| Users expect refunds, not just credits | Low | Credit-application + payment flows already exist (`credit-applications-via-payment`); the RMA stops at the posted memo by design; document the handoff |

## Open Questions

> All resolved autonomously (fully-autonomous feature run — no human was available mid-run; resolutions follow codebase precedent first, then research consensus, per spec-writing autonomous mode). **Review these at spec review — they are decisions, not facts.**

- [x] Standalone document vs quality-issue extension vs Odoo-style operation-only? — **Autonomous:** standalone non-posting `salesReturnOrder` document. Pre-plumbed enums are codebase intent; unanimous competitor pattern (research §Synthesis 1); Odoo's documentless model leaves state homeless.
- [x] Which module/permission family owns it? — **Autonomous:** Sales (`sales_*`), no new `module` enum value or permission scope. Lesson "Features live inside existing permission modules"; scopes are FROZEN.
- [x] Table naming? — **Autonomous:** `salesReturnOrder`, matching the existing enum literal and `salesOrder` symmetry; UI says "RMA".
- [x] Are original-document links required? — **Autonomous:** optional (blind returns are table stakes everywhere); when present they drive reversible-qty validation, pricing, and exact cost reversal.
- [x] Status model — explicit workflow states or quantity-derived? — **Autonomous:** small explicit enum with receipt-driven transitions and a guarded manual Complete; mirrors NetSuite's quantity-derived semantics without computed-status complexity.
- [x] Reuse receipts or build return-receiving? — **Autonomous:** reuse receipts (`sourceDocument 'Sales Return Order'`); no surveyed system builds a parallel receiving stack; the enum value and `post-receipt` inspection hook already exist.
- [x] Same `trackedEntity` re-entry or new entity per return? — **Autonomous:** same entity, `On Hold`, with a `Return Receipt` genealogy activity (new entity only for blind returns). Preserves round-trip traceability; BC re-applies the same tracking identity.
- [x] What cost do returns re-enter at? — **Autonomous:** original outbound cost when linked (BC exact cost reversing / Epicor layer walk-back); current cost blind; zero when the reason flags `inventoryValueZero`.
- [x] New disposition subsystem or reuse quality? — **Autonomous:** reuse: the line's `disposition` uses the existing enum (+ additive `Return to Customer`); Scrap/Rework/MRB execute through an escalated quality Issue (Epicor Fail→DMR pattern) so GL and approvals stay in one place.
- [x] How does credit work against a header-only memo? — **Autonomous:** keep memo header-only; add `salesReturnOrderCreditLine` breakdown + nullable `memo.salesReturnOrderId`; `quantityCredited` derived from Posted memos (void-safe), multiple partial credits allowed.
- [x] Restocking fee shape? — **Autonomous:** per-line `restockFeePercent` fraction 0–1 applied at credit generation (BC per-line charge precedent; only vendor-documented mechanism).
- [x] Credit GL account? — **Autonomous:** additive `accountDefault.salesReturnsAccount` (contra-revenue, seeded account, fallback `salesAccount`) passed as the memo `reasonAccount` — the `accountDefault` lesson pattern; `post-memo` unchanged.
- [x] Replacement mechanics? — **Autonomous:** action spawns a draft SO from RMA lines with `resolvePrice` pricing (user zeroes for warranty); link on `salesReturnOrder.replacementSalesOrderId`; BC's negative-line dance rejected.
- [x] v1 scope boundaries? — **Autonomous:** OUT: customer-portal-initiated returns, approval workflow stage, formal repair/rework job linkage (quality Issue covers it), refunds beyond the posted memo, MES surfaces. IN: PDF, return reasons, partial everything. (Supplier-side `purchaseReturnOrder` was originally deferred; pulled into scope per review — next question.)
- [x] Supplier-side shape? — **Review (PR #1354, changes requested: "Let's do the purchasing side as part of the spec too"):** included as a direction-flipped mirror — authorize → **ship** → credit (NetSuite Vendor RA order of operations), shared `returnReason` table (BC shares the reason codes across sales and purchase returns), no disposition stage (goods leave; nothing to disposition), the supplier's own RMA number on the header (`supplierReference`), and a "Create Supplier Return" bridge on the quality Issue `'Return to Supplier'` disposition. See the Purchasing Side section.

## Changelog

- 2026-08-11 (b): Review hardening from the automated review on PR #1354, all four findings verified against schema: (1) supplier-return source-lineage contract — `receiptLineId` = physical lineage, PO/invoice links = commercial, explicit blind-return fallback; canonical inventory-unit quantities with one-time `conversionFactor` conversion (verified: `purchaseOrderLine.purchaseQuantity`/`conversionFactor`/`inventoryUnitOfMeasureCode` are real dual-unit columns); (2) quantity caps stated as row-locked transactional invariants for concurrent returns/credits; (3) quality bridge: supplier resolution rules (multiple `nonConformanceSupplier` rows are possible — no unique constraint), per-quantity ownership, idempotent Create Supplier Return, close blocked while a linked return is open. Acceptance criteria + risks updated.
- 2026-08-11: Purchasing side added — `purchaseReturnOrder` supplier-returns mirror (authorize → ship → credit, shared `returnReason`, Issue `'Return to Supplier'` bridge, double-relief close guard) per review on PR #1354 ("Let's do the purchasing side as part of the spec too"). Title, TLDR, problem statement, scope resolution, acceptance criteria, and risks updated to match.
- 2026-08-07: Created. Research at `.ai/research/2026-08-07-rma-module.md`; internal recon + run record at `.ai/runs/2026-08-07-rma-module.md`. All 14 open questions resolved autonomously (fully-autonomous run) — flagged for human review at spec review, especially: additive enum values (`disposition`, `nonConformanceAssociationType`), additive columns on `memo` + `accountDefault` (+ seeded contra-revenue account), and the decision to route Scrap/Rework GL through quality Issues rather than RMA-native posting.

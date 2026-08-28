# Warranty & Repairs — implementation plan

**Spec:** .ai/specs/2026-08-27-warranty-repairs.md (PR #1496)
**Research:** .ai/research/2026-08-20-warranty-repairs.md
**Branch:** `feat/warranty-repairs` (create off `main`)

> **PREREQUISITE — do not start until both are true:**
> 1. PR #1392 (`feat: Returns module`) is **merged to main**. Every precedent path below comes from that branch; if a cited precedent file is missing on your `main`, #1392 has not merged — STOP and report.
> 2. Spec PR #1496 is merged (the spec + research files exist at the paths above).
>
> The local stack must be provisioned (`crbn up` run once). **Never rebuild the database**; apply migrations with `pnpm db:migrate` only.

## Progress

- [ ] Task 1: Create the warranty-repairs migration
- [ ] Task 2: Apply migration + regenerate DB types
- [ ] Task 3: Seed new-company data (sequences + warranty account)
- [ ] Task 4: Zod models + enum picker activations
- [ ] Task 5: Warranty service functions
- [ ] Task 6: Repair order service functions
- [ ] Task 7: Registration stamping in post-shipment (Ship Date basis)
- [ ] Task 8: Registration stamping in post-sales-invoice (Invoice Date basis)
- [ ] Task 9: `create` edge function — repair receipt/shipment builders
- [ ] Task 10: post-receipt — Repair Order branch
- [ ] Task 11: post-shipment — Repair Order branch + tracking allowance
- [ ] Task 12: `issue` edge function — repair part consumption
- [ ] Task 13: Path helpers + Sales nav entries
- [ ] Task 14: Warranty Terms CRUD (routes + UI)
- [ ] Task 15: Warranty registrations list/detail/manual form + certificate PDF
- [ ] Task 16: Item form — warranty term selects
- [ ] Task 17: Repair order route tree
- [ ] Task 18: Repairs UI components
- [ ] Task 19: RMA 'Repair' disposition integration
- [ ] Task 20: Repair Order PDF + document wiring
- [ ] Task 21: i18n — extract + fill translations
- [ ] Task 22: Browser verification against acceptance criteria

## Dependencies

- Task 2 needs Task 1. Task 3 needs Task 1 (same seed shapes). Everything after needs Task 2 (types).
- Task 4 before Tasks 5–19 (validators/const arrays).
- Tasks 5 and 6 are sequential (same file: `sales.service.ts`).
- Tasks 7, 8, 9, 12 are independent of each other (different edge functions) — parallelizable after Task 4.
- Tasks 10 and 11 depend on Task 9 (the legs they post are built there).
- Task 13 before Tasks 14, 15, 17 (paths). Tasks 14, 15, 16 independent of each other.
- Task 17 before Tasks 18, 19. Task 20 independent after Task 13. Task 21 after all UI. Task 22 last.

---

## Task 1: Create the warranty-repairs migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_warranty-repairs.sql` (via `pnpm db:migrate:new warranty-repairs` — never hand-pick the timestamp; HHMMSS must not be `000000`)
- Copy from (precedent): `packages/database/supabase/migrations/20260814063415_sales-return-orders.sql` (structure: enums → tables → indexes → RLS → account/sequence backfills → view) and `packages/database/supabase/migrations/20260814063919_purchase-return-orders.sql`

**Steps:**
1. `pnpm db:migrate:new warranty-repairs`.
2. Write the SQL in this order, following the spec's **Data Model Changes** section exactly (spec is authoritative for columns; this task lists the deltas that are easy to get wrong):
   - **New enums:** `warrantyTermStartBasis` (`'Ship Date'`, `'Invoice Date'`), `repairOrderStatus` (`'Draft'`,`'Confirmed'`,`'In Progress'`,`'Completed'`,`'Cancelled'`), `repairOrderLineStatus` (`'Pending'`,`'Received'`,`'At Supplier'`,`'Repaired'`,`'Shipped'`,`'Scrapped'`), `repairBillingCode` (`'Warranty'`,`'No Charge'`,`'Billable'`), `repairOrderChargeType` (`'Part'`,`'Service'`).
   - **Additive enum values**, each its own statement with `IF NOT EXISTS` (precedent: `20260421130001_item-ledger-nc-doctype.sql`): `receiptSourceDocument` + `'Repair Order'`; `shipmentSourceDocument` + `'Repair Order'`; `itemLedgerDocumentType` + `'Repair Receipt'`, `'Repair Shipment'`, `'Repair Consumption'`; `documentSourceType` + `'Repair Order'`, `'Warranty Registration'`. Do NOT touch the `disposition` enum — `'Repair'` already exists.
   - **Tables** `warrantyTerm`, `warrantyRegistration`, `repairOrder`, `repairOrderLine`, `repairOrderLineTrackedEntity`, `repairOrderCharge` per the spec sketches, with these house corrections applied to the sketches: **bare `NUMERIC`** everywhere (no `NUMERIC(10,5)` — precision specs are banned; the returns migration's `exchangeRate` is the precedent), no `itemReadableId` column anywhere, audit `*By` columns referencing `"user"("id")` inline, `customFields JSONB` on the four main tables (not the junction).
   - **Composite company-scoped FKs** for every business relationship (`("x","companyId") REFERENCES parent("id","companyId")`), delete actions per spec (CASCADE for line→header, `ON DELETE SET NULL ("x")` column-list form for optional links — precedent for the column-list form: the composite-FK lesson in `.ai/lessons.md`). User references stay plain `REFERENCES "user"("id")` — documented exception. If a referenced parent lacks a `(id, companyId)` unique key, add `CREATE UNIQUE INDEX IF NOT EXISTS` for it in this migration.
   - **Partial unique indexes** exactly as in the spec: 4 on `warrantyRegistration` (ship/invoice × tracked/untracked), 3 on `repairOrder` (`quoteId`, `salesOrderId`, `purchaseOrderId`, each `WHERE ... IS NOT NULL`, scoped with `companyId`), 1 on `repairOrderLine` (`salesReturnOrderLineId`), 1 on `repairOrderLineTrackedEntity` (`("repairOrderLineId","companyId")` — one entity per line).
   - **Additive columns:** `item.warrantyTermId TEXT`, `item.supplierWarrantyTermId TEXT` (both nullable, composite FK to `warrantyTerm`), `accountDefault.warrantyCostAccount TEXT` (nullable). `warrantyRegistration` includes `salesInvoiceLineId TEXT` (invoice stamping key) and `repairOrderLineId TEXT` (repair-warranty provenance, `ON DELETE SET NULL ("repairOrderLineId")`) per the spec sketch.
   - **Known parent-key gap:** `salesInvoiceLine` has a bare `PRIMARY KEY ("id")` — add `CREATE UNIQUE INDEX IF NOT EXISTS "salesInvoiceLine_id_companyId_idx" ON "salesInvoiceLine"("id","companyId")` before declaring the composite FK from `warrantyRegistration.salesInvoiceLineId`.
   - **Warranty Expense account backfill** for existing companies: clone the `Sales Returns` account backfill block from `20260814063415_sales-return-orders.sql` — resolve the parent group by `"isGroup" = TRUE AND name` (**never by account number**), insert a posting account named `Warranty Expense` under the expense/COGS group the precedent uses for contra/cost accounts, idempotent (`ON CONFLICT` / `WHERE NOT EXISTS`).
   - **Sequence backfill** for existing companies, same INSERT shape as the returns migration's sequence block: `('repairOrder','Repair Order','REP',...)` and `('warrantyRegistration','Warranty Registration','WTY',...)`.
   - **Indexes** on `companyId` and every FK column of the new tables.
   - **RLS:** enable on all six tables; exactly four policies named `SELECT`/`INSERT`/`UPDATE`/`DELETE`, schema-qualified, `SELECT` via `(SELECT get_companies_with_employee_role())::text[]`, writes via `(SELECT get_companies_with_employee_permission('sales_<action>'))::text[]`. Junction table derives like the returns junction. Never `has_role`/`has_company_permission`.
   - **Views** with `WITH(SECURITY_INVOKER=true)`: `repairOrders` (header + customer/supplier names + line count + custody rollup — clone the `salesReturnOrders` view shape from the returns migration), `warrantyRegistrations` (registration + item readableId/name + customer name + tracked entity + per-class derived `Active`/`Expired`), `trackedEntityCustody` (open `repairOrderLine` joined through `repairOrderLineTrackedEntity` → entity id, custody status, repair readable id).
3. Do not edit any already-applied migration file; everything goes in this one new file.

**Verify:**
```bash
pnpm db:migrate
# Expected: output lists "warranty-repairs" as applied with no error, then regenerates types/swagger
```

**Out of scope:** `disposition` enum (value exists), any change to `purchaseReturnOrder`/`salesReturnOrder` tables, any data migration of existing returns.

## Task 2: Apply migration + regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts` — regenerated, never hand-edited

**Steps:**
1. If Task 1's `pnpm db:migrate` already regenerated types, this is a check; otherwise run `pnpm run generate:types`.

**Verify:**
```bash
git diff --stat packages/database/src/types.ts | tail -1 && grep -c "warrantyRegistration\|repairOrderCharge" packages/database/src/types.ts
# Expected: non-zero diff; grep count > 0 (new tables present in generated types)
```

**Out of scope:** hand-editing anything under `packages/database/src/`.

## Task 3: Seed new-company data (sequences + warranty account)

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — add `('repairOrder','Repair Order','REP',...)` and `('warrantyRegistration','Warranty Registration','WTY',...)` to the sequences array (precedent: the `RMA`/`RTS` rows added by returns), and the `Warranty Expense` account row to the seeded chart entries alongside where `Sales Returns` was added
- Modify: `packages/database/supabase/functions/seed-company/index.ts` — only if the returns precedent shows this function enumerates these rows separately (returns touched it at ~lines 261–272 for `returnReasons`); sequences/accounts may flow from `seed.data.ts` automatically — match whatever the returns diff did for ITS sequences and account

**Steps:**
1. Open the returns-module versions of both files, find every place `RMA`, `RTS`, or `Sales Returns` was added for NEW companies, and add the exact parallel entries for `REP`, `WTY`, and `Warranty Expense`.
2. If `seed-company` turns out not to reference sequences or accounts at all (they come only from `seed.data.ts`), change only `seed.data.ts` — do not invent a new seeding path.

**Verify:**
```bash
grep -n "repairOrder\|warrantyRegistration\|Warranty Expense" packages/database/supabase/functions/lib/seed.data.ts
# Expected: at least 3 matching lines (two sequence rows + one account row)
```

**Out of scope:** the migration backfill (Task 1 owns existing companies), demo datasets under `packages/database/src/datasets/`.

## Task 4: Zod models + enum picker activations

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — add `warrantyTermValidator`, `warrantyRegistrationValidator`, `repairOrderValidator`, `repairOrderLineValidator`, `repairOrderChargeValidator`; const arrays `warrantyTermStartBasisType`, `repairOrderStatusType`, `repairOrderLineStatusType`, `repairBillingCodeType`, `repairOrderChargeTypeType`; add `"Repair"` to the `salesReturnDispositionType` picker array (currently a commented subset around line 1000 on the returns branch)
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — uncomment/add `"Repair Order"` in `receiptSourceDocumentType` (~line 72–82) and `shipmentSourceDocumentType` (~line 293–302)
- Modify: `apps/erp/app/modules/documents/documents.models.ts` — add `"Repair Order"` and `"Warranty Registration"` to `documentSourceTypes` (precedent: the returns values at lines 21–22)
- Copy from (precedent): `salesReturnOrderValidator` / `salesReturnOrderLineValidator` in the same `sales.models.ts` (shape, `zfd` usage, id-optional create-vs-edit pattern)

**Steps:**
1. Validators: plain zod + `zfd` (`import { z } from "zod"; import { zfd } from "zod-form-data"`), mirroring the returns validators field-for-field where the spec's tables mirror returns. `repairOrderChargeValidator.billingCode` is `z.enum(repairBillingCodeType)` and **required** (no default — spec decision).
2. Const arrays must match the DB enums exactly, including `'Scrapped'` in `repairOrderLineStatusType`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (models compile against the regenerated types)
```

**Out of scope:** the quality module's disposition picker (Issues keep their own subset), MES models.

## Task 5: Warranty service functions

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — append warranty functions
- Modify: `apps/erp/app/modules/sales/index.ts` — barrel exports if the module re-exports named service functions (match how returns functions are exported)
- Copy from (precedent): `getReturnReasons`/`upsertReturnReason`/`deleteReturnReason` and `getSalesReturnOrders` (view + `setGenericQueryFilters`) in the same file

**Steps:**
1. Add, all client-first returning raw `{ data, error }`, all `companyId`-scoped:
   - `getWarrantyTerms(client, companyId, args)` (list, generic filters), `getWarrantyTermsList(client, companyId)` (id/name for selects), `getWarrantyTerm`, `upsertWarrantyTerm`, `deleteWarrantyTerm`.
   - `getWarrantyRegistrations(client, companyId, args)` reading the `warrantyRegistrations` view; `getWarrantyRegistration(client, id, companyId)`; `upsertWarrantyRegistration` (manual rows: both stamping keys NULL); `deleteWarrantyRegistration`.
   - `getWarrantyCoverage(client, args)` with the three input forms from the spec: `{ trackedEntityId }` → resolve ALL registrations for the entity, pick latest `startDate` (ties: latest `createdAt`, then highest `id` — must be a total order), return one verdict `{ registrationId, coversParts, partsUntil, coversLabor, laborUntil, supplierCoveredUntil }`; `{ warrantyRegistrationId }` → verdict for that row; `{ itemId, customerId }` → return the candidate registration array (no picking). Date comparisons are `YYYY-MM-DD` string comparisons against today in the company timezone — use the existing company-today helper the returns services use (grep `getCompanyToday|companyToday` in `sales.service.ts` / `shared`); **never `new Date()` arithmetic** (date-handling rule).
2. No throws, no unwrapping; `.maybeSingle()` for zero-or-one lookups.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** stamping logic (edge functions own it — Tasks 7–8), any UI.

## Task 6: Repair order service functions

**Depends on:** Task 5 (same file — run after to avoid merge churn)
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — repair functions
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — `createRepairPurchaseOrder`
- Copy from (precedent): `insertSalesReturnOrder`/`upsertSalesReturnOrderLine`/`confirmSalesReturnOrder`/`cancelSalesReturnOrder`/`completeSalesReturnOrder` (lifecycle + row-locked caps), `createReplacementSalesOrder` (sales.service.ts ~line 7325 on the returns branch — one-shot idempotent link), `createReplacementPurchaseOrder` (purchasing.service.ts ~line 4164), and the Issue→supplier-return bridge action `apps/erp/app/routes/x+/issue+/$id.supplier-return.tsx` (idempotent spawn shape)

**Steps:**
1. CRUD + reads: `getRepairOrders` (view), `getRepairOrder`, `getRepairOrderLines`, `getRepairOrderCharges`, `insertRepairOrder` (allocates readable id via `get_next_sequence('repairOrder', ...)` exactly as `insertSalesReturnOrder` does), `upsertRepairOrder(Line/Charge)`, `deleteRepairOrder(Line/Charge)`, `setRepairOrderLineTrackedEntity` (single row, junction unique).
2. Lifecycle, each in a Kysely transaction with `SELECT ... FOR UPDATE` on the header (clone the returns row-lock pattern):
   - `confirmRepairOrder` (Draft→Confirmed; readable id already assigned at insert — match returns' split of id-at-insert vs confirm side effects).
   - `cancelRepairOrder` — refused once any line left `'Pending'`.
   - `completeRepairOrder` — guard: **at least one line exists**, and every line `'Shipped'` or `'Scrapped'`, or `closedComplete = true`; and `closedComplete` may only be set while the line is `'Pending'` (enforce in `upsertRepairOrderLine` too).
   - `upsertRepairOrderLine` — when `warrantyRegistrationId` is set, validate the registration matches the line (`itemId`, the order's `customerId`, and the junction entity when tracked) and, for an untracked registration, enforce the quantity cap under `SELECT ... FOR UPDATE` on the registration: Σ quantity of open repair lines referencing it (this line included) ≤ `warrantyRegistration.quantity`. Refuse on mismatch or overflow.
   - `markRepairOrderLineRepaired` — `'Received'` → `'Repaired'` only.
   - `scrapRepairOrderLine` — line must be `'Received'` or `'Repaired'`; always the full line quantity. Tracked lines: flip the held entity to `'Scrapped'` using the SAME mechanism the ERP scrap flow uses (grep `"Scrapped"` writers in `apps/erp/app/modules/inventory` on the returns branch and reuse its service/edge call). Untracked lines: post the quantity-scrap path — negative `itemLedger` with `documentType 'Scrap'` for the full quantity at carried (zero) value. Either way no GL (the intake layer was zero-value); set custody `'Scrapped'`. If the existing scrap flow cannot be invoked from a service without a quality Issue, STOP and report — do not write a parallel scrap.
   - Charge guards: `billingCode` immutable and charge undeletable once `issuedAt` is set.
3. One-shot links, each row-locked check-then-create in ONE transaction per the spec (lock header, re-read link, return existing if set, else create child + set link before commit):
   - `createRepairOrderFromReturnLine` (also sets the RMA line's disposition to `'Repair'` via the existing disposition service; line starts `'Received'`; copies customer, item, tracked entity, reason; idempotency key = `repairOrderLine.salesReturnOrderLineId` unique index).
   - `createRepairQuote` — draft `quote` from `Billable` charges; on conversion the existing `convertQuoteToOrder` (sales.service.ts:203) applies; store `quoteId`.
   - `createRepairSalesOrder` — direct draft SO from `Billable` charges; store `salesOrderId`.
   - `createRepairPurchaseOrder` (purchasing.service.ts) — draft PO on `repairOrder.supplierId` with one service/fee line; store `purchaseOrderId`; permission scoping happens at the route (Task 17).
   - `applyRepairWarranty` — given a `warrantyTermId`, INSERT a **new** manual-class registration (both stamping keys NULL, `repairOrderLineId` = this line, same item/customer/entity, `startDate` = completion date, dates from the term, readable id from the sequence). Never mutate the source registration — it is owned by its stamping document's void path.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** posting/ledger writes (edge functions), routes (Task 17), any change to `convertQuoteToOrder` itself.

## Task 7: Registration stamping in post-shipment (Ship Date basis)

**Depends on:** Task 2 (independent of Tasks 5–6)
**Files:**
- Modify: `packages/database/supabase/functions/post-shipment/index.ts` — sales-shipment branch + void branch
- Copy from (precedent): the returns branch's own additive edits to this file (sales branch entity handling ~line 770/1884; void handling ~line 3597) for where post/void logic lives

**Steps:**
1. Inside the existing posting transaction of the **sales shipment** branch (`sourceDocument` = sales order), after ledger/entity writes: collect shipped lines whose `item.warrantyTermId` resolves to a term with `startBasis = 'Ship Date'` (one query for all items — no per-line queries), and build registration rows: per shipped tracked entity (from the shipment's tracking rows) else one per line with quantity; `startDate` = posting date in company timezone; per-class expirations from the term (`coversParts/laborDurationMonths`, NULL duration = lifetime → NULL expiration with the covers flag true); `shipmentLineId` always set; readable ids via `get_next_sequence('warrantyRegistration', ...)`; supplier warranty: walk the entity's genealogy to a direct purchase-receipt ancestor (one batched query over `trackedActivity`/inputs); when found and `item.supplierWarrantyTermId` set, fill `supplierId` + `supplierWarrantyExpirationDate`; ambiguity → leave NULL. One bulk insert. A failure throws → the posting rolls back (do NOT catch-and-log).
2. **Void branch:** delete `warrantyRegistration` rows whose `shipmentLineId` is among the voided shipment's lines AND `salesInvoiceLineId IS NULL` (ship-stamped rows only).
3. Do not add registration logic to any non-sales branch (PO/outside-processing/transfer/returns branches post no registrations — the "flip must not add rows to a branch that posted none" lesson).

**Verify:**
```bash
cd packages/database && npx tsc --noEmit -p supabase/functions 2>/dev/null || deno check supabase/functions/post-shipment/index.ts
# Expected: no type errors reported for post-shipment (use whichever check the repo's edge functions support; if neither works, `pnpm run lint` must pass and Task 22 covers behavior)
```

**Out of scope:** Invoice Date terms (Task 8), repair-order shipment branch (Task 11).

## Task 8: Registration stamping in post-sales-invoice (Invoice Date basis)

**Depends on:** Task 2 (independent of Task 7)
**Files:**
- Modify: `packages/database/supabase/functions/post-sales-invoice/index.ts` — post + void paths
- Copy from (precedent): Task 7's insertion shape (same helper if you extract one into `packages/database/supabase/functions/shared/` — acceptable; both functions may import it)

**Steps:**
1. On posting: same row-building as Task 7 but for terms with `startBasis = 'Invoice Date'`; `startDate` = invoice date; **every row keyed on `salesInvoiceLineId`**, with `shipmentLineId` filled as lineage when the invoice line resolves to a shipment line. The invoice-line-only fallback (no resolvable shipment line) applies to **untracked items only**; a tracked line that cannot resolve its shipment line is **skipped** — never register a tracked item with a null entity. Inside the posting transaction; failure rolls back.
2. On void: delete rows matched on the voided invoice's `salesInvoiceLineId`s.

**Verify:**
```bash
grep -n "warrantyRegistration" packages/database/supabase/functions/post-sales-invoice/index.ts | head -5
# Expected: matches in both the posting path and the void path
```

**Out of scope:** Ship Date terms, purchase invoices.

## Task 9: `create` edge function — repair receipt/shipment builders

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/supabase/functions/create/index.ts` — two new cases in the discriminated union + builders
- Copy from (precedent): the `receiptFromSalesReturnOrder` and `shipmentFromSalesReturnOrder` cases in the same file (payload shape, line building, `sourceDocumentReadableId` handling)

**Steps:**
1. `receiptFromRepairOrder`: builds receipt lines from repair lines in `'Pending'` (intake) or `'At Supplier'` (return leg) — the caller passes which leg; **full open line quantity only**; skip `closedComplete` lines; `sourceDocument: "Repair Order"`, `sourceDocumentReadableId = repairOrder.repairOrderId`; location from the repair order.
2. `shipmentFromRepairOrder`: lines from `'Received'` (supplier leg — requires `repairOrder.supplierId`, error if NULL) or `'Repaired'` (customer leg); full quantity; same readable-id wiring.
3. Extend the payload zod union with the two new type literals, `companyId` + `userId` as all cases have; permissions mirror the returns cases (`create: "inventory"`).

**Verify:**
```bash
grep -n "FromRepairOrder" packages/database/supabase/functions/create/index.ts | head
# Expected: both case names appear in the union and in the switch
```

**Out of scope:** posting logic (Tasks 10–11), UI buttons (Task 18).

## Task 10: post-receipt — Repair Order branch

**Depends on:** Task 9
**Files:**
- Modify: `packages/database/supabase/functions/post-receipt/index.ts` — new `sourceDocument === "Repair Order"` branch + void handling
- Copy from (precedent): the Sales Return Order branch in the same file — zero-value reason hook ~line 2371, same-entity re-tag `Consumed → On Hold` ~lines 2444–2485, `'Return Receipt'` activity write ~lines 2668–2690

**Steps:**
1. Post: **always** a zero-value cost layer (no reason-code lookup — repair custody is unconditionally customer-owned); positive `itemLedger` rows with `documentType 'Repair Receipt'`; tracked lines re-tag the line's junction entity `Consumed → On Hold` (blind/untracked: new `On Hold` entity for tracked items without a declared entity; plain quantity for untracked items); `trackedActivity` `type: "Repair Receipt"` with attributes `{ "Repair Order": <readable id>, Receipt, Employee }`.
2. Custody transitions inside the same transaction, header row-locked: lines in `'Pending'` → `'Received'`; lines in `'At Supplier'` → `'Repaired'`; any other state → refuse the posting. Header `Confirmed → 'In Progress'` on first movement.
3. Void: allowed only while the line's custody still matches this leg's outcome (`'Received'` for intake, `'Repaired'` for the return leg) — i.e. newest-first; restore the prior state (`'Pending'` / `'At Supplier'`), reverse ledger + entity status.

**Verify:**
```bash
grep -n "Repair Order" packages/database/supabase/functions/post-receipt/index.ts | head
# Expected: matches in branch dispatch, posting body, and void body
```

**Out of scope:** the Sales Return Order and Purchase Order branches (untouched), GL journals (zero-value layers post no journal — match the returns zero-value path).

## Task 11: post-shipment — Repair Order branch + tracking allowance

**Depends on:** Task 9
**Files:**
- Modify: `packages/database/supabase/functions/post-shipment/index.ts` — new `sourceDocument === "Repair Order"` branch + void
- Modify: `apps/erp/app/routes/x+/shipment+/lines.tracking.tsx` — extend the On Hold allowance (currently special-cases `"Sales Return Order"` at ~lines 61–65) to also allow `"Repair Order"`
- Copy from (precedent): the Purchase Return Order branch (entity → `Consumed`, negative ledger ~line 2205) and the Sales Return Order ship-back branch (~line 2018, `'Return Shipment'` activity)

**Steps:**
1. Post: negative `itemLedger` `'Repair Shipment'` at carried cost (zero — the intake layer was zero-value); entities → `'Consumed'` with `trackedActivity` `type: "Repair Shipment"`; custody `'Received'` → `'At Supplier'` (supplier leg) or `'Repaired'` → `'Shipped'` (customer leg), refusing mismatches under row lock; no journal (zero value — do not add ledger rows this branch's precedents don't post).
2. Void: newest-first only (line custody must still be `'At Supplier'` / `'Shipped'`); restore `'Received'` / `'Repaired'`, entity back to `On Hold`.

**Verify:**
```bash
grep -n "Repair Order" packages/database/supabase/functions/post-shipment/index.ts apps/erp/app/routes/x+/shipment+/lines.tracking.tsx | head
# Expected: matches in both files
```

**Out of scope:** every existing branch's ledger/journal behavior; Task 7's registration stamping (separate concern in the sales branch).

## Task 12: `issue` edge function — repair part consumption

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/supabase/functions/issue/index.ts` — new case `partsToRepairOrder`
- Copy from (precedent): the existing consumption cases in the same file for ledger row shape; the GL write-off journal pattern in `packages/database/supabase/functions/post-nonconformance/index.ts` for the two-sided journal

**Steps:**
1. Payload: `{ type: "partsToRepairOrder", chargeId, companyId, userId }`, permission `update: "sales"`.
2. In one transaction: load the charge (`chargeType 'Part'`, `issuedAt IS NULL`, else refuse); for a `'Warranty'`/`'No Charge'` code, re-validate the owning line's registration identity (item/customer/entity match — same check as `upsertRepairOrderLine`) and refuse on mismatch; post negative `itemLedger` `'Repair Consumption'` for the charge quantity at current cost (resolve the bin per the tracked-bin lesson: net on-hand per bin, not `.find()`); when `accountingEnabled`, journal `Cr Inventory` / `Dr accountDefault.warrantyCostAccount ?? costOfGoodsSoldAccount` for `'Warranty'`/`'No Charge'` charges, `Dr costOfGoodsSoldAccount` for `'Billable'`; stamp `unitCost` + `issuedAt` on the charge.
3. If the `issue` function's payload union or transaction helpers resist a non-job case cleanly, STOP and report — do not force job-shaped fields.

**Verify:**
```bash
grep -n "partsToRepairOrder" packages/database/supabase/functions/issue/index.ts | head
# Expected: case present in union + switch
```

**Out of scope:** labor/time capture (no jobs in this design), Service-type charges (no inventory movement — no edge call).

## Task 13: Path helpers + Sales nav entries

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add: list paths `repairs: ${x}/sales/repairs`, `warrantyRegistrations: ${x}/sales/warranties`, `warrantyTerms: ${x}/sales/warranty-terms` (+ new/edit/delete variants); detail trees `repairOrder(id)`, `repairOrderLine(id, lineId)`, action paths (confirm/cancel/complete/quote/order/purchase-order/warranty/repaired/scrap), `warrantyRegistration(id)`, PDFs `file.repairOrder(id)` + `file.warrantyRegistration(id)` (precedent: the returns entries at ~lines 1036, 1816, 1939, 1999 on the returns branch)
- Modify: `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` — three entries: `t\`Repairs\`` → `path.to.repairs` (`table: "repairOrder"`), `t\`Warranties\`` → `path.to.warrantyRegistrations` (`table: "warrantyRegistration"`), `t\`Warranty Terms\`` → `path.to.warrantyTerms` (precedent: the `RMAs` entry at line 55 and `Return Reasons` at line 90)

**Steps:**
1. Match the returns naming style exactly (list URLs under `${x}/sales/...`, document tree under its own segment `x+/repair-order+/`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** purchasing nav (the repair PO appears in normal PO lists; no new purchasing nav entry).

## Task 14: Warranty Terms CRUD (routes + UI)

**Depends on:** Task 13
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/warranty-terms.tsx`, `warranty-terms.new.tsx`, `warranty-terms.$id.tsx`, `warranty-terms.delete.$id.tsx`
- Create: `apps/erp/app/modules/sales/ui/WarrantyTerms/WarrantyTermForm.tsx`, `WarrantyTermsTable.tsx`, `index.ts`
- Copy from (precedent): the return-reasons quartet `apps/erp/app/routes/x+/sales+/return-reasons{,.new,.$id,.delete.$id}.tsx` and its form/table components (follow the returns branch's imports to find them under `modules/sales/ui/`)

**Steps:**
1. Clone the quartet: loader `requirePermissions { view: "sales" }`, actions `{ create/update/delete: "sales" }`, `assertIsPost`, `validator(warrantyTermValidator).validate(formData)`, redirect + `flash` per the precedent.
2. Form fields: name (text), coversParts (`zfd.checkbox` → Boolean field), partsDurationMonths (Number, optional — helper text "empty = lifetime"), coversLabor, laborDurationMonths, startBasis (Select over `warrantyTermStartBasisType`). Import fields from `~/components/Form`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** item attachment (Task 16), registrations.

## Task 15: Warranty registrations list/detail/manual form + certificate PDF

**Depends on:** Task 13
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/warranties.tsx` (list, loader `getWarrantyRegistrations`)
- Create: `apps/erp/app/routes/x+/warranty-registration+/_layout.tsx` (`handle.module: "sales"`), `new.tsx`, `$id.tsx`
- Create: `apps/erp/app/routes/file+/warranty-registration+/$id[.]pdf.tsx`
- Create: `apps/erp/app/modules/sales/ui/Warranties/WarrantyRegistrationsTable.tsx`, `WarrantyRegistrationForm.tsx`, `index.ts`
- Create: `packages/documents/src/pdf/WarrantyCertificatePDF.tsx`
- Copy from (precedent): list = `apps/erp/app/routes/x+/sales+/rmas.tsx` + `modules/sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx` (columns, filters, CSV export conventions); PDF route = `apps/erp/app/routes/file+/sales-return-order+/$id[.]pdf.tsx`; PDF component = `packages/documents/src/pdf/SalesReturnOrderPDF.tsx` (structure only — the certificate is a single-page document, no line table needed beyond the coverage rows)

**Steps:**
1. Table columns: readable id, item, serial/batch chip (`trackedEntityId`), customer, start date, parts/labor expiration badges (Active green / Expired gray — derive client-side from the view's dates), supplier-warranty badge, certificate download link to the PDF route.
2. Detail `$id.tsx`: editable dates + covers flags (per-unit override) via `ValidatedForm`; manual `new.tsx` requires item + customer, optional entity.
3. Certificate PDF: company header, registration readable id, item + serial, customer, coverage table (class / covered / until), start date. Export from `packages/documents/src/pdf` index like the returns PDFs.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: both exit 0
```

**Out of scope:** stamping (edge functions), repair linkage UI (Task 18).

## Task 16: Item form — warranty term selects

**Depends on:** Task 13 (independent of 14–15)
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/ItemForm.tsx` — two optional Select fields: "Warranty Term" (`warrantyTermId`) and "Supplier Warranty Term" (`supplierWarrantyTermId`), options from `getWarrantyTermsList`
- Modify: `apps/erp/app/modules/items/items.models.ts` — add both optional fields to the item validator(s) that back `ItemForm`
- Modify: the service that persists that form (follow `ItemForm`'s action to its `upsertItem`-style function in `items.service.ts`) so both columns are written
- Copy from (precedent): an existing optional Select in `ItemForm.tsx` (e.g. the unit-of-measure select) for the field wiring; a list-options loader pattern from how that form loads its select data

**Steps:**
1. Both fields optional, clearable; no behavior beyond persistence (stamping reads them in Tasks 7–8).
2. If `ItemForm.tsx` turns out not to write `item` columns directly (its action writes a different table), STOP and report with the actual write target — do not scatter the fields across per-type forms.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** per-type forms (PartForm/ServiceForm etc.), supplierPart-level warranty (spec keeps it item-level).

## Task 17: Repair order route tree

**Depends on:** Tasks 6, 13
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/repairs.tsx` (list)
- Create under `apps/erp/app/routes/x+/repair-order+/`: `_layout.tsx`, `new.tsx`, `update.tsx`, `$id.tsx`, `$id._index.tsx`, `$id.details.tsx`, `$id.confirm.tsx`, `$id.status.tsx` (cancel), `$id.complete.tsx`, `$id.quote.tsx`, `$id.order.tsx`, `$id.purchase-order.tsx`, `$id.warranty.tsx`, `$id.delete.tsx`, `$id.$lineId.details.tsx`, `$id.$lineId.delete.tsx`, `$id.$lineId.repaired.tsx`, `$id.$lineId.scrap.tsx`, `$id.charge.new.tsx`, `$id.charge.$chargeId.tsx`, `$id.charge.$chargeId.issue.tsx`, `$id.charge.$chargeId.delete.tsx`
- Copy from (precedent): the whole `apps/erp/app/routes/x+/sales-return-order+/` tree — `_layout.tsx` (module handle), `$id.tsx` (detail loader composition), `new.tsx`/`update.tsx`, `$id.confirm.tsx` (POST-only lifecycle), `$id.credit.tsx` (for the action-that-creates-a-linked-document shape), `$id.$lineId.disposition.tsx` (line action shape)

**Steps:**
1. All loaders/actions `requirePermissions` with `"sales"` except `$id.purchase-order.tsx` → `{ create: "purchasing" }` (the returns credit route's `create: "invoicing"` is the scoping precedent). `assertIsPost` on every action; `validator(...)` on every form post; `flash` + redirect per precedent.
2. `$id.charge.$chargeId.issue.tsx` invokes the `issue` edge function with `type: "partsToRepairOrder"`.
3. `$id.quote.tsx` / `$id.order.tsx` / `$id.purchase-order.tsx` / `$id.warranty.tsx` call the Task 6 one-shot services and redirect to the created document (precedent: `$id.replacement.tsx` on returns).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** shipment/receipt routes (existing ones serve the legs), MES.

## Task 18: Repairs UI components

**Depends on:** Task 17
**Files:**
- Create under `apps/erp/app/modules/sales/ui/Repairs/`: `RepairOrdersTable.tsx`, `RepairOrderForm.tsx`, `RepairOrderHeader.tsx`, `RepairOrderStatus.tsx`, `RepairOrderLineForm.tsx`, `RepairOrderExplorer.tsx`, `RepairOrderProperties.tsx`, `RepairChargesTable.tsx`, `types.ts`, `index.ts`
- Copy from (precedent): the sibling files in `apps/erp/app/modules/sales/ui/SalesReturnOrders/` one-for-one (`SalesReturnOrdersTable` → `RepairOrdersTable`, `SalesReturnOrderHeader` → `RepairOrderHeader`, etc.)

**Steps:**
1. `RepairOrderHeader`: status actions (Confirm/Cancel/Complete) + three leg buttons — "Receive" (visible while any line `'Pending'` or `'At Supplier'`), "Ship to Supplier" (any `'Received'`, requires supplier set), "Ship to Customer" (any `'Repaired'`) — each POSTing `sourceDocument: "Repair Order"` to the existing new-shipment/new-receipt routes exactly as `SalesReturnOrderHeader.tsx` lines ~69–79 do for Ship Back (dedupe-to-open-draft behavior comes free from those routes); link chips for RMA/quote/SO/PO.
2. `RepairOrderLineForm`: item + entity picker (entities shipped to the customer — reuse the returns' shipped-entity picker source), registration picker for untracked (candidates from `getWarrantyCoverage` item+customer form), coverage verdict badge, reason select (`returnReason`), custody status badge, Mark Repaired + Scrap Unit actions (POST to Task 17 routes).
3. `RepairChargesTable`: rows with type, item/description, qty, price, billing-code Select (locked once `issuedAt`), Issue action for Part charges, billable-total footer.
4. Custody rollup on `RepairOrdersTable` (e.g. "1 at supplier") from the view's rollup column.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: both exit 0
```

**Out of scope:** new generic components in `packages/react` (use existing ones — grep before writing), MES surfaces.

## Task 19: RMA 'Repair' disposition integration

**Depends on:** Task 17
**Files:**
- Create: `apps/erp/app/routes/x+/sales-return-order+/$id.$lineId.repair.tsx` — action-only: calls `createRepairOrderFromReturnLine`, redirects to `path.to.repairOrder(id)`
- Modify: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderLineForm.tsx` — the disposition submit routing (~lines 182–195) gains a `'Repair'` case posting to the new route (exactly how `'Scrap'`/`'Rework'` route to `$id.$lineId.issue.tsx`)
- Modify: the RMA detail panels — add a linked-repair chip/panel where the Issues association panel renders (precedent: the Issues panel wiring in the returns detail route/components)
- Copy from (precedent): `apps/erp/app/routes/x+/sales-return-order+/$id.$lineId.issue.tsx` (the escalate-and-link action shape)

**Steps:**
1. The action requires `quantityReceived > 0` on the line (same guard the disposition service enforces) and is idempotent — re-invoking redirects to the already-linked repair order.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** quality Issue flavors of Scrap/Rework (unchanged), the RMA Complete guard (already treats non-Pending dispositions as settled).

## Task 20: Repair Order PDF + document wiring

**Depends on:** Task 13 (independent of 17–19)
**Files:**
- Create: `packages/documents/src/pdf/RepairOrderPDF.tsx`, `packages/documents/src/pdf/blocks/repairOrder/{HeaderBlock,LineItemsBlock,NotesBlock,PartiesBlock,TermsBlock,index,registry,types,vars}.tsx|ts`, `packages/documents/src/pdf/repairOrder.samples.ts`
- Modify: `packages/documents/src/template/defaults.ts`, `packages/documents/src/template/merge.ts`, `packages/documents/src/template/schema.ts`, `packages/documents/src/pdf/preview-documents.tsx` — register the new document type (precedent: the exact returns-module diffs to these four files)
- Create: `apps/erp/app/routes/file+/repair-order+/$id[.]pdf.tsx`
- Copy from (precedent): `packages/documents/src/pdf/blocks/salesReturnOrder/` (whole directory, one-for-one) and `apps/erp/app/routes/file+/sales-return-order+/$id[.]pdf.tsx`

**Steps:**
1. PDF shows: header (readable id, dates, references — including `supplierReference`), customer + supplier parties, unit lines (item, serial, custody), notes. Wire Confirm to offer the PDF exactly as returns does.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents && pnpm --filter @carbon/documents test
# Expected: exit 0; existing document tests still pass
```

**Out of scope:** the warranty certificate (Task 15 created it), template customizer docs.

## Task 21: i18n — extract + fill translations

**Depends on:** Tasks 14–20
**Files:**
- Modify (generated): `packages/locale/locales/*/erp.po`

**Steps:**
1. Run the lingui extraction the locale package defines (see `packages/locale/package.json` scripts; returns used the same flow), then invoke the `/translate` skill to fill every empty `msgstr` for the new strings.

**Verify:**
```bash
grep -c 'msgstr ""' packages/locale/locales/de/erp.po
# Expected: 0 (no unfilled strings remain)
```

**Out of scope:** editing catalog strings by hand, adding locales.

## Task 22: Browser verification against acceptance criteria

**Depends on:** all previous
**Files:** none (verification only; run via the `/auth` + `/test` skills against the local dev stack)

**Steps:**
1. Walk the spec's Acceptance Criteria section end-to-end in the browser; the core script: create a warranty term (parts 12mo / labor 6mo, Ship Date) → attach to a serialized item (+ supplier warranty term) → ship a sales order and confirm the registration row + dates + certificate PDF → create an RMA for that serial, see the coverage badge, receive it, set disposition `Repair` → repair order exists with the line `'Received'` holding the same entity → Ship to Supplier (custody `'At Supplier'`, entity Consumed) → Receive back (custody `'Repaired'`, same entity On Hold) → add a Part charge (defaults `Warranty`), flip one charge `Billable`, Create Quote → Ship to Customer → Complete → apply repair warranty. Negative checks: over-legs refused, short-close refused past `'Pending'`, void ordering, charge without billing code rejected.
2. Verify inventory valuation contribution of the repair unit is zero while in custody (item ledger at zero value) via the inventory screens.
3. Record pass/fail per acceptance criterion; failures loop back to the owning task.

**Verify:**
```bash
echo "Manual/agent browser run — record results in the PR description"
# Expected: every acceptance criterion checked off, with screenshots for the PR per house convention
```

**Out of scope:** load testing, MES.

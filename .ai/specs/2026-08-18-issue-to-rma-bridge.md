# Quality Issue → Customer RMA Bridge (Create RMAs from NCRs)

> Status: draft
> Author: Claude (with Sid)
> Date: 2026-08-18
> Research: `.ai/research/2026-08-18-issue-to-rma-bridge.md` (NetSuite Case SuiteApp + Warranty Claims, SAP QM→Advanced Returns Management, Infor QCS/CCR, Epicor, BC, Odoo, ISO 9001 — primary-source cited)
> Follows: `.ai/specs/2026-08-07-rma-module.md` (the returns module; PR #1354 spec, PR #1392 implementation) — this is the follow-on it defers in `.ai/plans/2026-08-14-rma-module.md:27`

## TLDR

Close the second half of the quality↔returns bridge. Carbon already runs **returns → quality** in both directions of trade (an RMA line escalates to an Issue; an Issue's `'Return to Supplier'` disposition drafts a supplier return). What's missing is **quality → customer returns**: a `Create RMA` action on an Issue that drafts a `salesReturnOrder` for the affected quantities, pre-filled from the customer's returnable shipment lines, with per-quantity coverage so re-invoking never double-authorizes, and a `closeIssue` guard so the Issue cannot close while the goods it describes are still in transit.

The trigger is **customer lineage, not a disposition value** — goods at a customer are not stock we hold, and Carbon's `disposition` enum exists to move stock we do hold. And because a complaint, the recovery of the goods, and the corrective action are one causal chain (ISO 9001 §10.2), the existing RMA-line escalation is amended: when an RMA carries an origin Issue, dispositioning a received line attaches to **that** Issue instead of spawning a second one.

Everything is additive: two nullable columns, one new POST-only route, one new card on the Issue detail page, one new blocker in `closeIssue`, and one behavioral amendment to an existing route. No new tables, no new enum values, no new permission scopes.

## Problem Statement

A customer calls: the bracket you shipped last month is cracking in the field. The CSR registers an Issue — `source: External`, the customer associated, the shipment line associated, item and quantity recorded. Quality wants the parts back to confirm the failure mode before committing to a corrective action.

From that Issue there is no way to ask for them back. The user must leave the Issue, open `x/sales/rmas`, create a new RMA, re-select the customer, re-find the shipment, re-key the item and quantity, and re-pick the serials — and when they are done, **nothing links the two records**. The Issue does not know an RMA exists; the RMA does not know why it was raised. Nobody can answer "how many of the 12 units this complaint covers have we actually authorized back?" without reading both documents side by side, and there is nothing to stop a second CSR authorizing the same 12 units again the next morning.

Three concrete failures follow:

1. **No coverage accounting.** The supplier direction solved this a fortnight ago — `nonConformancePurchaseReturnOrderLine.quantity` records what each linked return covers, and re-invoking the bridge drafts only the uncovered remainder. The customer direction has the junction table (`nonConformanceSalesReturnOrderLine`) but no `quantity` column on it, because the direction that writes it today (RMA line → new Issue) never needed one.

2. **The Issue can close while the goods are still at the customer — and for untracked items that posts a write-off.** `closeIssue` turns every `Scrap` row into a negative `itemLedger` movement. For **tracked** goods Carbon already refuses: a linked entity that is `Consumed` (which every shipped serial is) is a hard blocker at `quality-disposition.server.ts:694`. For **untracked** goods there is no such guard — closing a complaint Issue with a `Scrap` disposition writes off on-hand stock that has nothing to do with the units at the customer, whose cost already left via COGS at shipment.

3. **The CAPA trail fragments.** `x+/sales-return-order+/$id.$lineId.issue.tsx` unconditionally calls `insertIssue` when a received line is dispositioned `Scrap` or `Rework`. That is right for a blind return, and wrong for a return an Issue authorized in the first place: the complaint and the teardown that confirms it end up as two unrelated Issues, with the corrective action hanging off the second one. ISO 9001 §10.2 makes the customer complaint the trigger for corrective action and asks for root-cause and effectiveness evidence on that trail — an auditor following the complaint hits a dead end exactly where the evidence lives.

Every document-first system surveyed that has a nonconformance record at all bridges it to the return document: SAP creates a returns order directly from a Q1 Customer Complaint quality notification; NetSuite ships two first-party paths (support case → RA, warranty claim → RA). Odoo — with no bridge and no RMA object — is again the counter-example, and the ecosystem fills the gap with third-party RMA-claim modules (research §Odoo, §Synthesis).

## Proposed Solution

### Workflow

```
Issue (customer lineage)                      salesReturnOrder
  │                                                  │
  ├── Create RMA ──▶ resolve customer                │
  │                  allocate uncovered qty ────────▶ Draft (nonConformanceId = Issue)
  │                  pre-fill from returnable lines   │
  │                  pick shipped entities            │
  │                  write coverage rows              ▼
  │                                              Confirmed ─▶ Received
  │                                                  │
  │◀── disposition Scrap/Rework attaches HERE ───────┤  (not a new Issue)
  │                                                  │
  └── close BLOCKED while any linked RMA is Draft / Confirmed / Partially Received
```

1. **Raise.** On an Issue whose lineage resolves to a customer, a `Create RMA` card offers the action (with an optional customer override for ambiguous Issues, exactly like `CreateSupplierReturn`).
2. **Draft.** The action resolves the customer, computes each item's uncovered quantity, finds the matching returnable shipment lines, and writes a `Draft` RMA with lines, source links, prices, expected tracked entities, and one coverage row per line. It redirects to the RMA.
3. **Run the RMA normally.** Confirm, PDF to the customer, receive, disposition, credit, replacement — all existing machinery, untouched.
4. **Disposition attaches back.** `Scrap` / `Rework` on a received line of an Issue-originated RMA adds to the origin Issue's `nonConformanceItem` row and links the returned (now `On Hold`) entities to it, rather than creating a second Issue.
5. **Close.** The Issue closes once no linked RMA is open — by which point the goods are back, `On Hold`, and the disposition write-off is posting against stock that actually exists.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger | **Customer lineage** — the action is available when the Issue resolves to a customer (`nonConformanceCustomer`, or derived from associated shipment / sales-order lines). **No new `disposition` value** | Resolved with the user. `disposition` moves stock the company HOLDS — `closeIssue` turns every `Scrap`/`Return to Supplier` row into a negative `itemLedger` movement. A "get it back from the customer" value would need a permanent carve-out in that builder that moves no value, which is the tell that it does not belong in the enum. SAP triggers on notification ORIGIN (Q1 Customer Complaint), NetSuite on case + selectable source transaction (research §Synthesis 1) |
| Line source of truth | Item + quantity from `nonConformanceItem`; **returnable quantity and pricing from `getReturnableLinesForCustomer`** | Research §Synthesis 2: the complaint says *that* something is wrong; only the outbound document knows *how much may legitimately come back*. NetSuite caps at the source transaction's Returnable Quantity column. Carbon already ships this exact query — reusing it means the RMA's row-locked transactional cap covers the bridge for free |
| Coverage & idempotency | Per-quantity ownership on `nonConformanceSalesReturnOrderLine` (+ additive nullable `quantity`); allocate per item in `createdAt` order; re-invoking drafts only the uncovered remainder and redirects to the newest open linked RMA when nothing is left | Direct mirror of the supplier bridge shipped in `5efd86f7b`. Beats NetSuite's hard one-RA-per-case cap, which cannot express a complaint spanning two shipments (research §Divergences) |
| Origin link | Additive nullable `salesReturnOrder.nonConformanceId` (header), **in addition to** the per-line junction rows | The junction is written by BOTH directions (bridge-out and escalate-back), so "which Issue did this RMA come from?" is not answerable from it without guessing. An explicit header column answers it in one read, and gives the RMA detail page an origin chip. The junction keeps its separate job: per-line, per-quantity coverage |
| Circularity | When `salesReturnOrder.nonConformanceId` is set and that Issue is **open**, `Scrap`/`Rework` escalation **attaches** to it (increment `nonConformanceItem`, link the `On Hold` entities) instead of calling `insertIssue`. Closed origin → fall back to creating a new Issue, with a flash saying why | Resolved with the user. ISO 9001 §10.2 wants one corrective-action trail per complaint; NetSuite's warranty-claim bridge shows the same tight-coupling instinct (research §Implications 4). `isIssueLocked` forbids writing to a Closed issue, hence the fallback |
| Close guard | `closeIssue` blocked while any linked RMA is `Draft` / `Confirmed` / `Partially Received`. **No write-off arithmetic** | Symmetric with the supplier guard, but for a different reason. The supplier bridge needed write-off REDUCTION because a return shipment relieves inventory the Issue would otherwise write off (double relief). A customer RMA receipt *adds* inventory — no double relief exists. The guard survives because closing while the goods are in transit is premature: for tracked goods the existing `Consumed` blocker (`quality-disposition.server.ts:694`) already says so, and the RMA receipt flipping entities to `On Hold` is precisely what unblocks it (research §Implications 5) |
| Tracked entities | Expected entities = the Issue's `nonConformanceItemTrackedEntity` links, intersected with `Consumed` entities whose `attributes ->> 'Shipment'` traces to a posted shipment for the resolved customer. Foreign provenance is refused | Mirrors the supplier bridge's receipt-provenance check, with `Shipment` as the sales-side attribute (the attribute `getShippedTrackedEntitiesForCustomer` already keys on). Preserves the same-entity round trip the RMA module was built for |
| Blind fallback | An item with no resolvable returnable line still gets a line — no source links, no price | The RMA module supports blind returns as a first-class case; refusing to draft because history is unresolvable would be worse than drafting an honest blind line |
| Multi-customer Issues | One draft per customer: the action requires an explicit customer when lineage is ambiguous, and covers only that customer's quantities | Exactly the supplier bridge's rule for multi-supplier Issues. `nonConformanceCustomer` has no unique constraint, so more than one row is possible |
| Replacement path | **Not** added to the Issue. The drafted RMA's existing `Create Replacement Order` action is the route | NetSuite's Case SuiteApp offers RA-or-replacement-SO, but Carbon's RMA already owns replacement generation; a second road to the same document is surface without capability (research §Implications 6) |
| Scope | Bridge only — no complaint-intake form, no seeded "Customer Complaint" issue type, no external-source reporting | Resolved with the user. Smallest reviewable unit, and it mirrors how the supplier bridge shipped |
| Module home / permissions (heuristic 4) | Route `x+/issue+/$id.rma.tsx` gated `{ create: "sales" }`; the quality-side junction + origin writes go through the service role | Exact mirror of `$id.supplier-return.tsx` (`{ create: "purchasing" }`, service-role quality writes) — the bridge runs under the permission of the document it creates, and the quality-side link is a system record of that action. No new scopes; scopes are FROZEN |
| Multi-tenancy (heuristic 1) | No new tables. Both added columns carry composite tenant FKs (`("id","companyId")` targets), every read is `companyId`-scoped | House convention; `memo.salesReturnOrderId` in `20260814063415` is the precedent for the composite-FK + column-list `SET NULL` shape |
| Service shape (heuristic 2) | Reuses `insertSalesReturnOrder` / `upsertSalesReturnOrderLine` / `setSalesReturnOrderLineTrackedEntities` / `getReturnableLinesForCustomer` / `getShippedTrackedEntitiesForCustomer` verbatim; only `insertSalesReturnOrder` gains an optional `nonConformanceId` | One service file per module; the bridge is a route, not a new service layer |
| RLS (heuristic 3) | No new tables, so no new policies. `nonConformanceSalesReturnOrderLine` keeps its existing `quality_*` policies; the new column inherits them | Adding a column to an RLS-enabled table needs no policy change |
| Forms (heuristic 5) | The card posts a `FormData` via `useFetcher` (no zod validator) — one optional `customerId` field | Mirrors `CreateSupplierReturn.tsx` exactly; a one-optional-field action is not a `ValidatedForm` case |
| Module layout (heuristic 6) | `modules/quality/ui/Issue/CreateRma.tsx` + barrel export; guard logic in the existing `quality-disposition.server.ts` | Matches where `CreateSupplierReturn` and `closeIssue` already live |
| Backward compat (heuristic 7) | Two nullable columns, no renames, no drops, no enum values, no scope changes. The escalation change alters behavior **only** when `nonConformanceId` is set — which no existing row has | `BACKWARD_COMPATIBILITY.md`: schema ADDITIVE-ONLY, permission scopes FROZEN |

## Data Model Changes

One migration (`pnpm db:migrate:new issue-to-rma-bridge`), fully additive. `pnpm run generate:types` after.

### Per-quantity coverage on the existing junction

```sql
-- Nullable BY DESIGN: rows written by the RMA-line→Issue escalation direction
-- carry no coverage semantics. Only bridge-written rows set it.
ALTER TABLE "nonConformanceSalesReturnOrderLine"
  ADD COLUMN IF NOT EXISTS "quantity" NUMERIC;
```

Coverage for an item = `SUM(quantity)` over junction rows for the Issue whose RMA is not `Cancelled`. Cancelling an RMA releases its covered quantities back to the pool, exactly as on the supplier side.

### Origin link on the RMA header

```sql
ALTER TABLE "salesReturnOrder" ADD COLUMN IF NOT EXISTS "nonConformanceId" TEXT;

-- Composite tenant FK; PG15 column-list SET NULL clears only the ref column
-- (precedent: "memo_salesReturnOrderId_fkey" in 20260814063415_sales-return-orders.sql).
DO $$ BEGIN
ALTER TABLE "salesReturnOrder" ADD CONSTRAINT "salesReturnOrder_nonConformanceId_fkey"
  FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id")
  ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "salesReturnOrder_nonConformanceId_idx"
  ON "salesReturnOrder" ("nonConformanceId");
```

> `nonConformance` has a single-column PK (`"id"`), so this FK is single-column — the same shape the other `nonConformance*` junctions use. Tenant isolation is enforced by the `companyId`-scoped reads and the table's existing RLS, not by this constraint.

### Not changed

No new tables. No new enum values — in particular **no new `disposition` member** (see Design Decisions). No changes to `salesReturnOrderLine`, `nonConformanceItem`, `memo`, or `accountDefault`. The `salesReturnOrders` view gains `nonConformanceId` passthrough only if the list table surfaces it (it does not in v1).

## API / Service Changes

### `sales.service.ts`

- `insertSalesReturnOrder` — accept optional `nonConformanceId` in its input object and write it through. No other signature changes.
- No new functions. `getReturnableLinesForCustomer`, `getShippedTrackedEntitiesForCustomer`, `upsertSalesReturnOrderLine`, `setSalesReturnOrderLineTrackedEntities`, and `deleteSalesReturnOrder` (the rollback path) are used as-is.

### `quality-disposition.server.ts` — `closeIssue`

One additional preflight read and one additional blocker, alongside the existing supplier-return block:

```ts
// Customer-RMA bridge state: an OPEN linked salesReturnOrder blocks the close.
// Unlike the supplier side there is NO write-off reduction — an RMA receipt ADDS
// inventory, so no double relief is possible. The guard exists because closing
// while the goods are in transit disposition-writes-off stock that has not
// arrived; for tracked rows the existing Consumed blocker says the same thing.
const linkedRmas = await client
  .from("nonConformanceSalesReturnOrderLine")
  .select(`salesReturnOrderId, salesReturnOrderReadableId,
           salesReturnOrderLine(salesReturnOrder(status))`)
  .eq("nonConformanceId", nonConformanceId)
  .eq("companyId", companyId);
// blocker when status ∈ ('Draft','Confirmed','Partially Received')
```

The blocker message names the RMA and its escape hatches: receive it, short-close the remaining lines, or cancel it. `Received` / `Completed` / `Cancelled` do not block.

### New route — `x+/issue+/$id.rma.tsx` (POST only)

`requirePermissions(request, { create: "sales" })`. Body: optional `customerId`. Algorithm, mirroring `$id.supplier-return.tsx`:

1. **Load** the Issue, its `nonConformanceItem` rows (with `nonConformanceItemTrackedEntity` → `trackedEntity` links), its `nonConformanceCustomer` / `nonConformanceShipmentLine` / `nonConformanceSalesOrderLine` associations, and its existing `nonConformanceSalesReturnOrderLine` rows with each linked RMA's status. Refuse if the Issue is `Closed`.
2. **Resolve the customer** — explicit `customerId` (validated against `customer` for the company) → exactly one `nonConformanceCustomer` → exactly one customer derived from the associated shipment lines' parent shipments → exactly one derived from the associated sales-order lines' parent orders. Ambiguous or unresolvable → redirect with "Could not resolve a single customer — select one explicitly".
3. **Validate entity provenance.** For every `Consumed` entity linked to the Issue's rows, resolve `attributes ->> 'Shipment'` to its shipment and refuse if any traces to a different customer.
4. **Allocate uncovered quantity** per item, in `createdAt` order, against the non-`Cancelled` coverage sum. Entities already picked on a linked RMA line are excluded. Nothing uncovered → redirect to the newest open linked RMA with a success flash (idempotent no-op).
5. **Resolve returnable source lines** via `getReturnableLinesForCustomer(client, companyId, customerId)`. Prefer a line whose shipment is associated to the Issue (`nonConformanceShipmentLine`); otherwise the largest returnable remainder for that item. Copy `unitPrice`, `salesOrderLineId`, `shipmentLineId`, `salesInvoiceLineId`. **Clamp** the drafted quantity to the returnable remainder and flash when clamping occurred; no resolvable line → a blind line (no links, price 0).
6. **Write** `insertSalesReturnOrder({ customerId, nonConformanceId, locationId: issue.locationId, orderDate: today(companyTimeZone), … })`, then per uncovered row: `upsertSalesReturnOrderLine`, `setSalesReturnOrderLineTrackedEntities` (the provenance-checked entity ids), and a service-role `nonConformanceSalesReturnOrderLine` insert carrying `quantity`. Any failure rolls the whole draft back with `deleteSalesReturnOrder(serviceRole, id)` — the supplier bridge's rollback-by-delete pattern.
7. **Redirect** to `path.to.salesReturnOrder(id)`.

### Amended route — `x+/sales-return-order+/$id.$lineId.issue.tsx`

Today: always `insertIssue` + `create nonConformanceTasks` + link. Amended: read `salesReturnOrder.nonConformanceId` first.

- **Origin set and open** → attach instead of create. `nonConformanceItem` has `UNIQUE ("nonConformanceId","itemId")`, so this is an increment-or-insert on that row (`quantity += quantityReceived`, `disposition` set to the requested value), plus `nonConformanceTrackedEntity` / `nonConformanceItemTrackedEntity` inserts for the received `On Hold` entities, deduped against rows already present. **`create nonConformanceTasks` is NOT re-invoked** — the Issue's tasks already exist. The junction row already exists from the bridge; it is not duplicated. Redirect to the origin Issue.
- **Origin set but Closed** (`isIssueLocked`) → fall back to today's create-new path, flashing that the originating Issue is closed.
- **Origin unset** (blind RMA, or one created by hand) → today's behavior, byte-for-byte.

`setSalesReturnOrderLineDisposition` still records the disposition on the line in both paths.

### `path.ts`

`issueRma: (id: string) => ...` alongside the existing `issueSupplierReturn`.

## UI Changes

- **`modules/quality/ui/Issue/CreateRma.tsx`** — a card mirroring `CreateSupplierReturn.tsx`: explanatory copy, an optional customer `Combobox` (from the `useCustomers` store) for ambiguous Issues, and a submit button. Rendered only when `permissions.can("create", "sales")` and the Issue has customer lineage; disabled when the Issue is locked. Exported from the `ui/Issue` barrel.
- **`x+/issue+/$id.details.tsx`** — render `<CreateRma>` next to `<CreateSupplierReturn>` inside the existing associations `Await`. The lineage flag is computed from the already-resolved associations, so no new loader work.
- **Issue detail** — linked RMAs surface through the existing `nonConformanceSalesReturnOrderLine` association rendering (the association type `salesReturnOrderLines` is already registered in `quality.models.ts` and `IssueAssociations`); no new panel.
- **RMA detail** — an origin chip linking back to the Issue when `nonConformanceId` is set.
- **Nav / MES** — no changes.
- **i18n** — new strings run through `/translate` for the 12 locales, as with the supplier bridge.

## Acceptance Criteria

- [ ] An Issue with one `nonConformanceCustomer` association and one item row for 5 units shows `Create RMA`; invoking it drafts a `salesReturnOrder` for that customer with one line for 5 units, `nonConformanceId` set to the Issue, and a `nonConformanceSalesReturnOrderLine` row with `quantity = 5`.
- [ ] An Issue with **no** customer lineage does not show the card; an Issue whose lineage resolves to two customers shows it but refuses without an explicit `customerId`, and drafts only that customer's quantities when one is supplied.
- [ ] An Issue with no customer association but an associated shipment line drafts against that shipment's customer (derived lineage), and the drafted line carries `shipmentLineId`, `salesOrderLineId`, and the source line's `unitPrice`.
- [ ] An item whose affected quantity exceeds the customer's returnable remainder drafts a line clamped to the remainder, with a flash naming the clamp; an item with no resolvable returnable line drafts a blind line with no source links.
- [ ] Re-invoking `Create RMA` after a first draft covering 5 of 8 units drafts a second RMA for exactly 3; re-invoking again with nothing uncovered creates nothing and redirects to the newest open linked RMA with a success message. Cancelling the first RMA returns its 5 units to the uncovered pool.
- [ ] A serialized item's entities linked to the Issue are pre-picked on the drafted line; an entity whose `attributes ->> 'Shipment'` traces to a **different** customer's shipment is refused with an explicit error and no draft is written.
- [ ] A line-write failure part-way through leaves no orphan: the whole draft is deleted and the user is returned to the Issue with an error.
- [ ] Closing the Issue is blocked while a linked RMA is `Draft`, `Confirmed`, or `Partially Received`, with a message naming the RMA; it succeeds once that RMA is `Received`, `Completed`, or `Cancelled`.
- [ ] Receiving an Issue-originated RMA and dispositioning a line `Scrap` adds the received quantity to the **origin** Issue's `nonConformanceItem` row for that item, links the returned `On Hold` entities to it, creates **no** second Issue, and redirects to the origin Issue.
- [ ] The same disposition on an RMA with **no** `nonConformanceId` still creates a new Issue exactly as it does today (regression).
- [ ] The same disposition on an RMA whose origin Issue is `Closed` creates a new Issue and flashes why.
- [ ] After the returned entities are `On Hold` and linked to the origin Issue, closing that Issue with a `Scrap` disposition posts the write-off against those entities through `post-nonconformance` (the `Consumed` blocker no longer fires).
- [ ] Every route 403s without `sales_create` (bridge) / `quality_update` (close); cross-company reads return nothing.
- [ ] `pnpm run generate:types`, scoped typecheck (`--filter=@carbon/erp`), lint, and the existing quality + returns tests pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| The escalation route is load-bearing for the returns module shipped in PR #1392; changing it could regress blind returns | High | The new branch is entered **only** when `nonConformanceId` is set, which no pre-existing row has. The `insertIssue` path is untouched. Explicit regression criterion above |
| Untracked customer-complaint Issues can still be closed with a `Scrap` disposition and write off unrelated on-hand stock when **no** RMA was ever raised | Med | Pre-existing, not introduced here, and out of scope by the bridge-only decision — but real. The guard closes it for every bridged Issue; tracked goods are already protected by the `Consumed` blocker. Flagged for a follow-on: `closeIssue` arguably should not write off a row whose lineage is a customer shipment at all |
| `nonConformanceItem` increment on attach races with a concurrent edit of the same row | Med | Do it inside the existing Kysely transaction machinery in `quality-disposition.server.ts` with a row lock, following `assignEntitiesToIssueItem`, which already re-reads the parent's lock state inside the transaction |
| Coverage allocation across items is order-sensitive; a rewritten `nonConformanceItem` quantity could strand coverage | Med | Allocate in `createdAt` order (identical to the supplier bridge) and clamp at zero. Coverage rows are the record; recomputing from them is always consistent |
| `getReturnableLinesForCustomer` scans posted shipments per customer and could be slow for a high-volume customer | Low | Already the RMA "new from document" path's query, with the same access pattern; the bridge adds no new shape. Optimize both together if it bites |
| Two bridge invocations racing could jointly over-authorize | Low | The RMA module's row-locked transactional cap at confirm is the real enforcement point (spec `2026-08-07`, "Quantity caps are transactional invariants"); the bridge's clamp is a drafting convenience, not the invariant |

## Open Questions

> Resolved before writing, per `.claude/skills/spec-writing/SKILL.md`. Answers marked **User** came from the design interview; those marked **Precedent** follow an existing Carbon implementation the user has already reviewed and shipped.

- [x] What triggers the action — a `disposition` value (mirroring the supplier bridge) or the Issue's customer lineage? — **User:** customer lineage, no new disposition value. Goods at a customer are not stock we hold, and `closeIssue` turns disposition rows into inventory movements; a recall value would need a permanent no-op carve-out in that builder. Matches SAP's Q1-origin trigger and NetSuite's case+transaction trigger.
- [x] When an Issue-originated RMA line is dispositioned `Scrap`/`Rework`, attach to the origin Issue or create a new one? — **User:** attach to the origin Issue; fall back to creating a new one only when the origin is `Closed`. One corrective-action trail per complaint (ISO 9001 §10.2).
- [x] How wide is this spec — bridge only, or bridge plus complaint intake / direct replacement orders? — **User:** bridge only. Existing Issue intake is used as-is; the drafted RMA's own `Create Replacement Order` is the replacement path.
- [x] Where does the origin link live — header column, junction column, or derived? — **Precedent:** an additive nullable `salesReturnOrder.nonConformanceId`. The junction is written by both directions, so origin is not derivable from it without guessing; the header column answers it in one read and gives the RMA an origin chip. The junction keeps per-line coverage.
- [x] Does the close guard also reduce the write-off, as the supplier guard does? — **Precedent:** no. The supplier reduction exists to prevent double relief when a return *shipment* relieves inventory the Issue would also write off; a customer RMA receipt *adds* inventory, so there is nothing to double-relieve. The guard is retained purely as a timing gate.
- [x] Hard-cap one RMA per Issue (NetSuite's model) or per-quantity coverage? — **Precedent:** per-quantity coverage with idempotent re-invocation, exactly as the supplier bridge (`5efd86f7b`) does. A hard cap cannot express a complaint spanning two shipments (research §Divergences).
- [x] What happens to an item with no resolvable returnable line? — **Precedent:** draft a blind line. The RMA module treats blind returns as first-class; refusing to draft because history is unresolvable would be the worse failure.
- [x] Which permission gates the bridge route? — **Precedent:** `{ create: "sales" }`, with the quality-side junction and origin writes via service role — the exact shape of `$id.supplier-return.tsx` (`{ create: "purchasing" }`). No new scopes; scopes are FROZEN.

## Changelog

- 2026-08-18: Created. Research at `.ai/research/2026-08-18-issue-to-rma-bridge.md`. Follow-on to `.ai/specs/2026-08-07-rma-module.md`, which deferred this direction (`.ai/plans/2026-08-14-rma-module.md:27`). Three design questions resolved with the user before writing (trigger, circularity, scope); five more resolved from shipped Carbon precedent. Reviewer attention most warranted on: the two additive columns, the behavioral amendment to the existing escalation route, and the untracked-write-off risk called out as pre-existing and deliberately out of scope.

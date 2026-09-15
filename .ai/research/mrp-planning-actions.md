# MRP Planning Actions Research: Best Practices Survey

## Summary

This surveys how best-in-class manufacturing ERPs model MRP **action messages** /
**planning exceptions** — the full set of planning actions beyond just "create an
order" — and how those actions are routed to and worked by buyers/planners. The
motivation: Carbon's MRP today emits exactly one suggestion, "Order" (a computed,
non-persisted `quantityToOrder`), and cannot tell a planner to expedite, defer, or
cancel existing supply.

The consensus across SAP, Microsoft Dynamics 365 (SCM and Business Central),
Oracle NetSuite, Epicor Kinetic, and Infor (SyteLine/LN) is remarkably tight.
Every one of them separates **two concept classes**: (1) *actionable messages on
orders* — create a new order, pull-in/expedite, push-out/defer, cancel, and
(in some) change-quantity; and (2) *advisory exceptions/warnings* — below safety
stock, negative on-hand, cannot-meet-requested-date, master-data broken. All of
them gate reschedule noise behind a **tolerance window** so trivial date shifts
don't spam the worklist, and all of them **partition the worklist by an ownership
code** (SAP "MRP controller" for planning + "purchasing group" for buying; Epicor
"Buyer ID"; BC "planner"; LN "planner"). The pivotal enabling concept everywhere
is **firming**: a suggestion an engine freely rewrites only ever needs "create";
the moment an order can be committed/firmed, you need message-to-a-human actions
because the engine may no longer silently move it.

## Competitors Surveyed

- **SAP S/4HANA (and ECC)** — the enterprise reference; its 8-group numbered
  exception-message catalog (esp. Group 7: reschedule-in 10 / reschedule-out 15 /
  cancel 20 / plan-process 30) is the model every other ERP echoes.
- **Microsoft Dynamics 365 SCM (F&O)** — cleanest *directional* action taxonomy
  (Advance / Postpone / Increase / Decrease / Derived) plus the "Delays/futures"
  cannot-meet-date exception as a first-class output.
- **Microsoft Dynamics 365 Business Central** — cleanest *enum* to emulate:
  Planning Worksheet action messages New / Change Qty. / Reschedule / Resched. &
  Chg. Qty. / Cancel, orthogonal on (date, quantity) axes.
- **Oracle NetSuite Supply Planning** — Reschedule In / Reschedule Out / Cancel +
  numeric planning-exception codes; bulk approve/reject from a Planning Workbench.
- **Epicor Kinetic** — New PO Suggestions vs Change PO Suggestions (Expedite /
  Postpone / Cancel / Qty change), Buyer-ID-scoped worklists, reschedule-in/out
  delta tolerances.
- **Infor SyteLine (CSI) & LN** — planned orders + exception messages
  (Reschedule In / Reschedule Out / Cancel Order), firm/confirm to release,
  per-planner exception configuration.

## Key Consensus Patterns

### 1. Two concept classes: actionable messages vs. advisory exceptions

- **SAP**: Group 7 messages (10/15/20/30) are *actions on orders*; Groups 4/5/6/8
  are *advisory* (excess stock, below safety stock, no BOM, planning terminated).
- **Dynamics 365 SCM**: "Actions" (Advance/Postpone/Increase/Decrease) modify an
  existing order; "Delays/futures" is a separate cannot-meet-date exception.
- **Business Central**: the `Action Message` enum is the actionable set; the
  separate `Warning` field carries Emergency / Exception / Attention severities.
- **NetSuite**: order recommendations (Reschedule In/Out, Cancel, Create) are
  distinct from coded "Planning Action Messages" (100 below-zero, 110 below safety
  stock, 130 late PO, 140 late WO).
- **Infor LN**: order-planning messages (Reschedule In/Out, Cancel Order) sit in a
  broader exception taxonomy alongside quantity/lead-time/safety-time exceptions.
- **Rationale**: an actionable message maps 1:1 to a document edit a buyer/planner
  performs; an advisory flag needs human judgement and may not resolve to a single
  order edit. Modeling them separately (but linked) keeps the worklist crisp.

### 2. The actionable message taxonomy — six primitives

Every product implements the same core set (names vary):

| Primitive | SAP | D365 SCM | Business Central | NetSuite | Epicor | Infor LN |
|---|---|---|---|---|---|---|
| New buy order | new planned order / PR | planned purchase order | **New** | create/release | **New PO Suggestion** | Confirm planned PRP order |
| New make order | new planned order | planned production order | **New** | create/release | **New Job** (unfirm) | Confirm planned prod order |
| Pull in (earlier) | **10 reschedule in** | **Advance** | **Reschedule** | **Reschedule In** | **Expedite** | **Reschedule In** |
| Push out (later) | **15 reschedule out** | **Postpone** | **Reschedule** | **Reschedule Out** | **Postpone** | **Reschedule Out** |
| Cancel | **20 cancel process** | (Decrease→0) | **Cancel** | **Cancel** | **Cancel** | **Cancel Order** |
| Change quantity | (42 changed / 25-26 excess) | **Increase / Decrease** | **Change Qty.** (+ **Resched. & Chg. Qty.**) | via reschedule/qty | Change PO Suggestion (qty) | Qty < Min / > Max / <> Increment |

- **Directional vs. combined**: BC combines date+qty into `Resched. & Chg. Qty.`
  and leaves reschedule direction implicit; D365 SCM and SAP/Epicor/LN bake
  **direction** into the type (Advance/Postpone, expedite/de-expedite,
  reschedule-in/out). Direction-in-the-type is more legible to a buyer.
- **Cancel vs. Decrease-to-zero**: most products have an explicit **Cancel**;
  D365 SCM notably folds it into Decrease. Explicit Cancel reads better.
- **Rationale**: these six span the two axes a planner can change on any supply
  order — its **date** (earlier/later) and its **quantity** (more/less/none) —
  plus the create/cancel endpoints.

### 3. A reschedule proposal is a message + a proposed date, not a new order

- **SAP**: a reschedule (10/15) is *not* a new element — it's an exception message
  hung on the existing firmed receipt, plus a **rescheduling date** (the date MRP
  suggests moving it to), shown in a dedicated MD04/MD05 column.
- **NetSuite / Epicor / LN**: same — the recommendation references the existing
  order and carries a new suggested date/qty.
- **Rationale**: the buyer needs "move *this PO line* to *this date*", so the
  message must reference the concrete existing document + the target date/qty,
  distinct from a freestanding new-order proposal.

### 4. Tolerance windows gate reschedule noise

- **SAP**: the **rescheduling check** only proposes a reschedule when the mismatch
  exceeds configured forward/backward **tolerance values (in days)** within a
  **rescheduling horizon**.
- **D365 SCM**: `Advance margin` / `Postpone margin` cap and gate reschedules;
  action calculation is off unless within the **action message time fence**.
- **Business Central**: **dampener period / dampener quantity** suppress trivial
  messages.
- **Epicor**: separate **reschedule-in delta** and **reschedule-out delta** (days).
- **Infor LN**: per-planner exception-type configuration decides which fire.
- **Rationale**: without a tolerance, every 1-day drift generates a message and the
  worklist becomes noise the planner learns to ignore. This is a hard requirement,
  not a nice-to-have.

### 5. Firming is the concept that makes change-actions necessary

- Universal: an MRP engine freely creates, moves, and deletes its own *planned*
  proposals every run. Once a proposal is **firmed** (SAP asterisk / manual
  edit / planning-time-fence) or **converted** to a real PO/job, MRP must no
  longer silently touch it — so instead it raises a **reschedule/cancel message
  to a human**. SAP: 10/15/20 fire on *firmed* receipts; 30 fires on *planned*
  ones MRP can still auto-reschedule.
- **Conversion / "Carry Out" / "Firm" / "Confirm"**: the accept-and-convert step
  turning a proposal into a real document. SAP MD14/MD15 (planned→PR), CO40/CO41
  (planned→production); BC "Carry Out Action Message" after ticking "Accept
  Action Message"; Epicor "Buy"/"Firm"; LN/SyteLine "Confirm"/"Firm".
- **Rationale for Carbon**: Carbon already creates **real** POs (status `Planned`)
  and jobs directly from planning — there is no persisted "planned order" the
  engine owns. That means Carbon's change-actions (expedite/defer/cancel) in
  necessarily operate on **already-real** purchase orders and jobs, which is
  exactly SAP's "firmed receipt" case. Carbon effectively has no unfirmed tier,
  so *every* existing-supply action is a message-to-a-human by construction.

### 6. Owner-scoped, filterable, bulk-actionable worklists

- **SAP**: MD06 (snapshot) / MD07 (live) collective worklists filtered by **MRP
  controller** (planning) and **purchasing group** (buying); a **processing
  indicator** lets a planner tick off reviewed materials.
- **D365 SCM**: Master planning workspace + planned-orders lists filtered by
  vendor / coverage group / **buyer group**; group-by-vendor+buyer-group on firm.
- **Business Central**: **Planning Worksheet** (planners) vs **Requisition
  Worksheet** (buyers); Carry-Out can copy PO proposals into the Requisition
  Worksheet — the primary planner-vs-buyer routing mechanism.
- **NetSuite**: Supply Planning Workbench views grouped by subsidiary/location,
  header-checkbox **bulk approve/reject** ("Perform Selected Actions").
- **Epicor**: **Buyer Workbench** (POs) / **Planning Workbench** (jobs); Buyer ID
  resolved Part-Site → Part-Class → system default partitions the worklist.
- **Infor**: per-planner exception sessions; planner code + buyer on the item.
- **Rationale**: exception management only scales when each buyer/planner pulls
  "my materials" and can act in bulk; a single global list doesn't get worked.

## Answers to Research Questions

1. **Full catalog of action messages (beyond "Order")?** — Six primitives
   (§2): New buy, New make, Expedite/pull-in, Defer/push-out, Cancel, Change
   quantity — plus advisory exceptions (below safety stock, excess/over-supply,
   cannot-meet-date, late order, master-data broken). SAP's canonical action set
   is 10/15/20/30; BC's is New / Change Qty. / Reschedule / Resched.&Chg.Qty. /
   Cancel; D365's directional set is Advance / Postpone / Increase / Decrease.

2. **New order vs. change to existing order?** — Distinct outputs everywhere (§3).
   A new proposal is a freestanding planned order/requisition with its own dates; a
   change is a message referencing an existing (firmed/real) order + a proposed new
   date/quantity. SAP's "rescheduling date" is a first-class column.

3. **How planners work them?** — Owner-scoped, filterable worklists with
   accept/convert and bulk actions (§6): SAP MD06/MD07, BC Planning/Requisition
   Worksheet + Carry Out, NetSuite Workbench bulk approve, Epicor Buyer/Planning
   Workbench.

4. **Assignment to buyers/planners?** — A per-item/portfolio ownership code (§6):
   SAP MRP controller (mandatory MRP-1 material-master field) + purchasing group;
   Epicor Buyer ID (Part-Site → Part-Class → default); BC planner + worksheet
   split; Infor planner code + buyer. **Carbon has no buyer/planner field today** —
   only a generic document `assignee` (present on `purchaseOrder`, not populated by
   the planning path). This is the second gap the rewrite fills.

5. **Firming / conversion?** — §5. Firming protects a proposal from auto-change;
   conversion turns it into a real document. **Carbon skips the unfirmed tier** —
   it creates real `Planned`-status POs and real jobs directly — so its
   change-actions inherently target real documents (SAP's firmed-receipt case).

6. **Tolerance to suppress noise?** — Yes, universal (§4): SAP rescheduling-check
   tolerance days + horizon, D365 advance/postpone margins, BC dampeners, Epicor
   reschedule-in/out deltas. **Must-have** for Carbon's expedite/defer messages.

## Competitor-Specific Details

### SAP S/4HANA / ECC
8 exception groups; priority-1 messages on the results screen, priority-2 on
drill-in. Group 7 = actions: **10 reschedule in** (firmed receipt later than need),
**15 reschedule out** (firmed receipt earlier than need), **20 cancel process**
(firmed receipt with no matching requirement), **30 plan process** (planned receipt,
demand inside lead time). Priority order 10 → 20 → 15. Rescheduling date computed by
the rescheduling check within tolerance/horizon; can occasionally flag msg 10 with
no computable date. Worklists MD06 (snapshot, processing indicator) / MD07 (live) /
MD04 (single-material live cockpit). **MRP controller** = mandatory 3-char MRP-1
material-master field; **purchasing group** = analogous buy-side field. Firming via
manual edit / planning time fence; conversion MD14/MD15 (→PR, auto-firmed),
CO40/CO41 (→production).

### Microsoft Dynamics 365 SCM (F&O)
Master planning nets to **planned orders** (proposals). **Actions**:
Advance / Postpone / Increase / Decrease / **Derived** (propagate down to
components), gated by the **action message time fence** and advance/postpone
margins. **No explicit Cancel** (Decrease→0) and **no Create** action (a planned
order *is* the create). **Delays/futures**: a **delayed (futures) date** + delay
days when earliest fulfillment is later than requested — a first-class
cannot-meet-date exception, governed by the **futures time fence**; only propagates
to components once the top-level order is firmed. **Firming**: manual, auto
(firming time fence), or query-based batch; firmed PO is set to `Approved`.

### Microsoft Dynamics 365 Business Central
**Planning Worksheet** action-message enum: **New**, **Change Qty.**,
**Reschedule**, **Resched. & Chg. Qty.**, **Cancel** (spans purchase / production /
assembly / transfer). Separate **Warning** field: Emergency / Exception / Attention.
**Dampener period/quantity** suppress trivial messages. Planner ticks **Accept
Action Message** then runs **Carry Out Action Message** (choose planned vs firm
planned production orders; create POs/assembly/transfer). **Planning Flexibility**
(Unlimited vs None) controls whether planning may touch a supply line.
**Planning Worksheet (planners) vs Requisition Worksheet (buyers)** — Carry-Out can
copy PO/transfer proposals into the Requisition Worksheet when separate teams handle
purchasing vs production. Cleanest enum to emulate.

### Oracle NetSuite Supply Planning
Supply plan lists suggested POs/WOs/transfers as **planned orders**. Order
recommendations: **Reschedule In**, **Reschedule Out**, **Cancel**, plus
create/release. Coded **Planning Action Messages** (100 QtyOnHand<0, 110 below
safety stock, 120 above safety stock, 130 late PO, 140 late WO) on a Planning
Messages subtab, reusable in saved searches. **Supply Planning Workbench** views
grouped by subsidiary/location with header-checkbox **bulk approve/reject**
(Perform Selected Actions). 2025.2 added Reschedule In Firm / Reschedule Out Firm /
Cancel Firm views (recommendations now cover firm orders too).

### Epicor Kinetic
Process MRP → **manufacturing suggestions** (Planning Workbench, unfirm jobs) and
**purchasing suggestions** (Buyer Workbench). **New PO Suggestions** vs **Change PO
Suggestions** (Expedite / Postpone / Cancel / Qty change). **Reschedule-in delta**
and **reschedule-out delta** (days) gate expedite/postpone. Buyer clicks **Buy** to
convert (optionally via requisition); planner **firms** unfirm jobs. **Buyer ID**
resolution: Part-Site → Part-Class → system default; a buyer sees only their
authorized buyers' suggestions/POs.

### Infor SyteLine (CSI) & LN
SyteLine: planned orders on the Material Planner Workbench / Planning Detail; **firm**
a planned order → job / PO / PO requisition / transfer; item carries **planner code**
+ **buyer**. LN: **planned orders** with Order Status "To be released" / "Not to be
released", turned real via **Confirm Planned Order**; exception messages
**Reschedule In** / **Reschedule Out** / **Cancel Order** plus quantity/lead-time/
safety-time exceptions; configured and worked **per planner** (Exception Message
Types by Planner / Exception Messages by Planner).

## Carbon Current-State (grounding)

**MRP is no longer an edge function** — the old Deno `mrp` function was deleted.
MRP now runs in-process in Node via **`runMrp`** exported from `@carbon/ee/planning`
(`packages/ee/src/planning/mrp/mrp.ts`, ~1149 lines). The pure BOM-explosion core
(`explodeBom`) still lives in `packages/database/supabase/functions/lib/mrp-engine.ts`
and is reached via the `@carbon/database/mrp-engine` barrel.
**Note: `.claude/rules/supersession-system.md` still references the old
`functions/mrp/**` path — it is stale for MRP's location.**

- **The engine emits no action messages.** `runMrp` writes only forecast/actual
  buckets: `demandForecast` (`forecastMethod='mrp'`), `demandForecastSource`
  (lineage), `demandActual`, `supplyActual`. It **deletes but never writes**
  `supplyForecast` (that's written by the user-driven `planning.update` routes).
- **The single "Order" suggestion is computed downstream and never persisted.**
  SQL RPCs `get_purchasing_planning` / `get_production_planning` +
  `calculate_quantity_to_order` (branching on `reorderingPolicy`) compute an
  ephemeral `quantityToOrder`, recomputed on every page load. A client-side mirror
  `calculateOrders` (`ItemReorderPolicy.tsx`) additionally emits `policyName`,
  `isASAP`, and `triggerValues` per suggestion — the only "why" metadata, thrown
  away after order creation.
- **Time horizon**: engine forecasts 72 weeks (`WEEKS_TO_FORECAST = 18*4`), weekly
  buckets only; purchasing planning route shows 48 weeks. Today =
  `datetime.today(companyTimeZone)`.
- **Consuming action supports only `action === "order"`** — `planning.update.tsx`
  (purchasing + production) explicitly rejects anything else. Purchasing groups
  planned orders by `supplierId::periodId`, finds-or-creates one PO per group
  (status `Planned`), merges lines, upserts `supplyForecast`. Production inserts
  jobs + methods, upserts `supplyForecast`, `recalculateJobRequirements()`.
- **No persisted suggestion / action-message table** exists — no
  `purchaseSuggestion` / `materialRequirement` / `actionMessage` / `planningSuggestion`.
- **Trigger**: Inngest (not Trigger.dev/DB-cron). Scheduled every 3h
  (`packages/jobs/src/inngest/functions/scheduled/mrp.ts`, `cron: "0 */3 * * *"`),
  per-company `runMrp(..., userId: "system")`, Cloud skips Canceled subscriptions.
  Manual via `apps/erp/app/routes/api+/mrp.ts` (POST, `update: "inventory"`) →
  `runMRP` wrapper in `production.service.ts`.
- **No buyer/planner concept.** Generic `assignee` FK exists on `purchaseOrder`
  (and part/customer/supplier), but the planning path never sets it; planned POs
  carry status/supplier/currency/createdBy only. Supplier defaulting comes from
  `itemReplenishment.preferredSupplierId` + `supplierPart`.
- **Relevant tables/enums**:
  - `itemReplenishment` (per item): `preferredSupplierId`, `purchasingLeadTime`,
    `purchasingUnitOfMeasureCode`, `conversionFactor`, `lotSize`, `manufacturingPolicy`.
  - `itemPlanning` (per item+location, unique `(itemId, locationId)`):
    `reorderingPolicy`, `safetyStockQuantity`, `reorderPoint`, `reorderQuantity`,
    `reorderMaximumInventory`, `minimumOrderQuantity`, `maximumOrderQuantity`,
    `orderMultiple`, `demandAccumulationPeriod`, `demandReschedulingPeriod`,
    `critical`.
  - `itemReplenishmentSystem` = `'Buy' | 'Make' | 'Buy and Make'`.
  - `itemReorderingPolicy` = `'Manual Reorder' | 'Demand-Based Reorder' |
    'Fixed Reorder Quantity' | 'Maximum Quantity'`.
  - Planning tables `period`, `demandForecast`, `demandActual`, `supplyForecast`,
    `supplyActual`, `demandForecastSource`, `demandProjection`.

## Recommended Approach for Carbon

Modeled on **SAP's exception-message split + Business Central's clean enum +
Epicor's Buyer-scoped worklist**, adapted to Carbon's reality that it has **no
unfirmed planned-order tier** (it creates real `Planned` POs and jobs directly).

1. **Persist a planning action-message / suggestion table** keyed by
   `(itemId, locationId, periodId)` (or per suggestion), with an **action-type
   enum** and the proposal payload. This is the central new artifact — Carbon's
   suggestion is ephemeral today. `runMrp` already has net requirement, projected
   balance, supply timing, and lineage in Phase 5–7, so it can write these rows in
   the existing Phase-7 atomic transaction. Reuse the existing `policyName` /
   `reason` / `triggerValues` shape (already on `plannedOrderValidator`) as the
   persisted "why".

2. **Adopt a directional action-type enum** (direction-in-the-type reads best for a
   buyer): follow SAP/D365/Epicor rather than BC's implicit-direction enum.
   Proposed set: **Order** (new buy) · **Make** (new job) · **Expedite** (pull an
   existing PO/job in) · **Defer** (push an existing PO/job out) · **Cancel** (an
   existing PO/job no longer needed) · optionally **Increase Qty** / **Decrease
   Qty**. Keep a separate **advisory-exception** channel (below safety stock,
   excess/over-supply, cannot-meet-date/past-due, master-data broken) — do **not**
   overload the action enum with warnings. (Terminology to confirm with domain
   glossary — see Open Questions.)

3. **Change-actions target real documents.** Because Carbon has no unfirmed tier,
   Expedite/Defer/Cancel reference an existing `purchaseOrderLine` / job (SAP's
   firmed-receipt case). The message carries the **proposed new date** (and/or qty)
   — a first-class field (SAP's "rescheduling date"). Acting on it edits/cancels
   that real document.

4. **Gate reschedule messages behind a tolerance window** (mandatory, §4). Add
   forward/backward tolerance days (candidate home: `itemPlanning`, reusing
   `demandReschedulingPeriod`, or a company-level default) so Expedite/Defer only
   fire past a threshold. Without this the worklist becomes noise.

5. **Add a buyer/planner ownership + assignment model.** Follow Epicor's Buyer-ID
   idea but reuse Carbon's existing generic `assignee` pattern where possible.
   Options to resolve in spec: (a) an owner field on the item (per-item or
   per-item-location, analogous to SAP MRP controller / purchasing group), with a
   resolution fallback; and/or (b) an `assignee` on each action-message row that a
   lead can (re)assign. Populate the PO `assignee` when an Order action converts.
   Let the planning worklist filter by assignee ("my actions") and act in bulk.

6. **Generalize the consuming action + UI.** Extend `planning.update.tsx` beyond
   `action === "order"` to handle expedite/defer/cancel (edit/cancel the referenced
   document), and extend the planning tables/drawers to render the action type,
   proposed date, reason, and assignee, with **bulk accept/dismiss** (NetSuite's
   Perform-Selected-Actions). Preserve the existing "Order" behavior as one action
   type among several.

7. **Keep the two module views** (purchasing planning vs production planning) as the
   buyer/planner split (BC's Planning vs Requisition Worksheet analog): purchasing
   view shows buy actions to buyers, production view shows make actions to planners.

### Open questions to carry into the spec

- **Terminology**: confirm action-type names against `@carbon/glossary` domain
  terms ("Expedite"/"Defer" vs "Reschedule In/Out" vs "Pull In/Push Out";
  "Order" vs "New"). SAP/Epicor say expedite/de-expedite; NetSuite/LN say
  reschedule in/out.
- **Assignment axis**: per-item owner (SAP MRP-controller style) vs per-message
  assignee vs both? Where does the owner field live — `itemReplenishment`
  (buy-side) / `itemPlanning` (per-location) / a new `buyer`/`planner` reference?
- **Do we introduce an unfirmed "planned order" tier**, or keep creating real
  `Planned` POs/jobs and treat every change-action as operating on real documents?
  (Recommendation: keep Carbon's real-document model; it's simpler and matches
  SAP's firmed-receipt semantics — but this is a scope decision.)
- **Persistence vs recompute**: persist action messages (needed for assignment +
  bulk work + dismissal state) vs continue computing on read. (Recommendation:
  persist — assignment and dismissal state require it.)
- **Change-quantity actions**: include Increase/Decrease Qty, or fold into
  Expedite/Defer + Cancel like SAP does? (SAP folds; D365/Epicor split.)
- **Advisory exceptions scope**: which exceptions ship in v1 (below safety stock,
  over-supply, past-due/cannot-meet-date, master-data broken)?
- **Tolerance home + defaults**: company-level default days vs per-item override.

## Sources

### SAP
- MRP exception 30 vs 10 (firmed vs planned): https://community.sap.com/t5/enterprise-resource-planning-q-a/mrp-exception-message-difference-between-30-10/qaq-p/10550514
- KBA 1698291 — messages 10/15/20/26/30 not displayed in MD04: https://userapps.support.sap.com/sap/support/knowledge/en/1698291
- KBA 3542305 — msg 10 without reschedule date: https://userapps.support.sap.com/sap/support/knowledge/en/3542305
- KBA 2609209 — reschedule exceptions 10 and 30: https://userapps.support.sap.com/sap/support/knowledge/en/2609209
- Exception 20 vs 10 in MD04: https://community.sap.com/t5/enterprise-resource-planning-q-a/differences-between-exception-20-and-10-in-md04/qaq-p/10399918
- Froggy's SAP — exception messages 10/15/20: http://froggysap.blogspot.com/2014/07/sap-mrp-understanding-exception.html
- SAPinsider — manage MRP exception messages: https://sapinsider.org/manage-material-requirements-planning-exception-messages-in-sap/
- SAP supply chain — exception-minded business (8 groups, MD06 vs MD07): http://sap-supply-chain-ideas.blogspot.com/2012/05/moving-towards-exception-minded.html
- MD07 exception monitor: https://blogs.sap.com/2022/07/02/md07-mrp-exception-monitor-collective-stock-requirement-list/
- Converting planned orders → PRs (MD14, auto-firm): https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9905622a5c1f49ba84e9076fc83a9c2c/49106354c08b063de10000000a441470.html
- Planned orders get firmed (PTF firming): https://community.sap.com/t5/enterprise-resource-planning-q-a/planned-orders-get-firmed/qaq-p/9599784
- Firming type in MRP types: https://www.stechies.com/what-is-firming-type-in-the-mrp-types/
- Define MRP controllers: https://www.saponlinetutorials.com/define-mrp-controllers-material-requirement-planning/
- Purchasing group vs MRP controller: https://community.sap.com/t5/enterprise-resource-planning-q-a/purchasing-group-and-mrp-controller/qaq-p/4888880
- MRP Exception Monitor (Fiori) PDF: https://help.sap.com/doc/80c6ad471d2d42598c766e3ef5c1fac4/2024.1/en-US/ERM-EN-PUBLIC.pdf

### Microsoft Dynamics 365
- SCM master planning home: https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-planning-home-page
- SCM delays (futures messages): https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/delays
- AX 2012 about action messages (Advance/Postpone/Increase/Decrease/Derived): https://learn.microsoft.com/en-us/previous-versions/dynamicsax-2012/appuser-itpro/about-action-messages
- SCM master planning performance (time fences): https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-planning-performance
- SCM firm planned orders: https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/planned-order-firming
- SCM coverage settings: https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/coverage-settings
- SCM maintain/filter planned orders: https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/maintain-planned-orders
- BC about planning functionality: https://learn.microsoft.com/en-us/dynamics365/business-central/production-about-planning-functionality
- BC run MPS/MRP (action-message enum, Carry Out): https://learn.microsoft.com/en-us/dynamics365/business-central/production-how-to-run-mps-and-mrp
- BC planning journal action messages (plain-language): https://usedynamics.com/business-central/planning/action-messages/

### Oracle NetSuite
- Planning Action Messages (coded exceptions, Reschedule In/Out): https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3865354301.html
- Supply Planning overview: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159171867422.html
- Setting up Reschedule Out messages: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_162557605659.html
- Supply Planning Workbench: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159187932855.html
- Creating a Planning Workbench View: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_164313117883.html
- NetSuite 2025.2 supply chain enhancements: https://www.netsuite.com/portal/resource/articles/supply-chain-management/netsuite-2025-2-optimizes-supply-chain-planning-and-execution-efficiency.shtml
- Rand Group — supply planning enhancements (bulk approve): https://www.randgroup.com/insights/oracle-netsuite/netsuite-supply-planning-and-allocation-enhancements/

### Epicor
- New vs Change PO Suggestions: https://www.epiusers.help/t/opinions-wanted-new-po-suggestions-vs-change-po-suggestions/101881
- Change PO Suggestions: https://www.epiusers.help/t/change-po-suggestions/136427
- Expedite from Change PO Suggestions: https://www.epiusers.help/t/expedite-pos-from-change-po-suggestions-benefit-or-liability/90485
- Reschedule out/in delta parameters: https://www.epiusers.help/t/reschedule-out-and-reschedule-in-parameters-affect-on-po-sugestions/116671
- Buyer field / Part-Plant→Part-Class→default: https://www.epiusers.help/t/buyer-field-in-new-po-suggestions/44378
- Filtering PO Suggestions by Site and Buyer: https://www.epiusers.help/t/filtering-po-suggestions-with-different-sites-and-buyers/97142
- MRP unfirming jobs: https://www.epiusers.help/t/mrp-is-unfirming-jobs/102553
- Production Management (workbenches): https://tomerlin-erp.com/knowledge-production-management/
- Kinetic Planning & Scheduling: https://www.epicor.com/en-us/products/enterprise-resource-planning-erp/kinetic/planning-and-scheduling/

### Infor
- SyteLine planning activity / firm planned orders / Order Action Report: https://csi.lamartcorp.com/syteline/language/en-us/mergedProjects/sl_invprod/forms/mrptopic/planning_activity.htm
- SyteLine APS overview: https://www.visualsouth.com/blog/advanced-planning-and-scheduling
- SyteLine PO requisitions from planned orders: https://inforcloudsuite.blogspot.com/2015/04/purchase-order-requisitions.html
- LN order/order-planning exception messages (Reschedule In/Out, Cancel Order): https://docs.infor.com/ln/10.5/en-us/lnolh/help/cp/onlinemanual/000069.html
- LN types of exception messages: https://docs.infor.com/ln/10.5/en-us/lnolh/help/cp/onlinemanual/000063.html
- LN Process Exception Messages (cprao1220m000): https://docs.infor.com/ln/10.3/en-us/lnolh/help/cp/rao/cprao1220m000.html
- LN Exception Message Types by Planner (cprao1110m000): https://docs.infor.com/ln/10.6/en-us/lnolh/help/cp/rao/cprao1110m000.html
- LN Planned Order (cprrp1600m000), Confirm/Order Status: https://docs.infor.com/ln/10.4/en-us/lnolh/help/cp/rrp/cprrp1600m000.html
- LN Planned Orders (cprrp1100m000): https://docs.infor.com/ln/10.5/en-us/lnolh/help/cp/rrp/cprrp1100m000.html

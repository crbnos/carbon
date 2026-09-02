# MRP v2: Planner UI & Data/Workflow Model — Best-Practices Survey

## Summary

Surveyed how eight MRP systems generate planned orders, cascade them through
multi-level BOMs, and present the plan to a planner — to inform Carbon's move from a
quantity-sorted per-item reorder worklist (`get_production_planning` +
`calculate_quantity_to_order`) to real planned-order MRP (spec
`.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md`). The enterprise systems
(SAP, Oracle, NetSuite, Dynamics 365, Infor LN/M3) are strikingly consistent on the
**data/workflow model** — planned order → firm → release, low-level-code single-pass
explosion, pegging, action/exception messages, the six-row time-phased record, and a
lot-sizing-then-modifiers pipeline whose output (not the raw net requirement) explodes
to children. The SMB cloud tools (Katana, MRPeasy, Fishbowl) diverge sharply on
**UI**: they hide the time-phased grid behind a single derived date ("stockout" /
"order-by" / "days-of-cover"), present each shortage as a **dated, decision-ready row
sorted by urgency** with a one-click Make/Buy → pre-filled draft → approve path, and
show the multi-level chain as a drill-down rather than a matrix. The recommendation:
**adopt the enterprise data model and standard terminology, but lead the UI with the
SMB dated-decision pattern**, offering the full time-phased matrix as an expert
drill-down.

## Competitors Surveyed

- **SAP S/4HANA (+ ECC)** — the enterprise reference; MRP Live, MD04/MD05/MD07, MD09 pegging, exception messages, planning time fence, lot-sizing procedures.
- **Oracle Fusion Cloud Supply Planning / Planning Central (+ legacy ASCP)** — order modifiers precedence, hard/soft pegging, Planner Workbench.
- **NetSuite Supply Planning (MRP)** — the closest enterprise peer to Carbon's SMB audience running a full multi-level MRP; Supply Planning Workbench, action messages, lot-sizing methods.
- **Microsoft Dynamics 365 SCM (Planning Optimization)** — regenerative-only cloud engine, coverage groups/codes, action + futures messages, explosion/pegging tree.
- **Infor LN & M3** — Planned→Firm Planned→Confirmed→Released lifecycle; M3's coded A/B/C action-message taxonomy.
- **Katana MRP, MRPeasy, Fishbowl** — the SMB/cloud UX cluster (same audience as Carbon); how they make MRP approachable for non-APICS planners.
- **Canonical MRP (APICS/ASCM)** — the standard time-phased record, LLC, lot-sizing techniques, pegging, firm planned orders, action messages — the source of correct terminology.

## Key Consensus Patterns

### 1. Planned order = first-class, disposable, typed suggestion
Every system generates **planned orders** typed by sourcing: **planned production /
planned purchase / planned transfer** (SAP: planned order vs purchase requisition;
Oracle/NetSuite/Dynamics/Infor: make/buy/transfer planned orders). A planned order is
**freely re-planned, rescheduled, or deleted** by every run until firmed. **Rationale:**
the plan must be disposable so regen can rebuild it without destroying human decisions —
exactly the durable-planned-order layer the Carbon spec proposes (validates the new
`plannedOrder` entity over the period-bucketed `supplyForecast`).

### 2. Lifecycle: Planned → Firm → Released/Converted
Universal three-state lifecycle. **Firm** freezes quantity + timing against re-planning
but the order **still explodes to components and still emits messages** (SAP firming
indicator `*`; Oracle/NetSuite firm checkbox; Dynamics manual/auto/query firming; Infor
LN "Firm Planned"→"Confirmed"). **Release/convert** turns it into a real work order / PO
/ transfer (SAP CO40/CO41/MD15; Oracle/NetSuite/Dynamics "release"/"firm"; Infor
"Confirm → transfer to execution"). **Rationale:** planners override the computer to
honor supplier minimums, level load, or protect commitments, without leaving MRP logic.
Validates Carbon's Planned/Firm/Released.

### 3. Auto-firm inside a planning time fence (the "nervousness" guard)
Every enterprise system has a near-term **planning time fence / firming horizon** inside
which MRP stops auto-creating or rescheduling orders — protecting the shop from
"nervousness" (small demand changes cascading into churn). SAP firming types P1–P4;
Dynamics firming time fence (evaluated on **order/start date**, not due date — a
documented trap); Infor firm-planned status acting as a fence. **Not in the current
Carbon spec** — recommend adding the hook (per-location firm-horizon days), even if v1
ships manual-firm-only.

### 4. Multi-level cascade = one low-level-code sweep; the lot-sized qty explodes
LLC processing (each item planned at its deepest BOM appearance, top-down) makes a
**single pass** correct for acyclic BOMs — no iteration — because every parent is
processed before the child, so the child's gross requirements are complete when it nets
(SAP LLC; canonical topological-sort proof). Critically, **the lot-sized order quantity —
not the raw net requirement — is what explodes to components** (SAP: dependent
requirement = inflated parent order qty × BOM qty; canonical: planned-order-release drives
child gross requirements). SAP labels the surplus that pegs to nothing **"quantity
without source"** (MD09). Validates the spec's core engine change and the fix to
`mrp-engine.ts:269`.

### 5. Pegging: bottom-up + top-down, single-level + full, soft vs hard
Pegging links supply↔demand as an audit trail ("why does this exist / what does it
support"). **Single-level** (immediate parent) vs **full/multi-level** (chained to the
top independent demand). **Soft peg** (a supply serves one-or-many demands) vs **hard
peg** (dedicated supply for a specific customer/project — SAP account-assignment/individual
segment, Oracle hard peg, Infor hard pegging). Surfaced as a graphical tree (Oracle
Graphical Pegging, Dynamics Explosion form, NetSuite hierarchical drill-down, SAP MD09).
Validates `plannedOrderPeg`; note Carbon **already hard-pegs** MTO jobs to sales-order
lines (`job.salesOrderLineId`).

### 6. Action / exception messages — the planner's real worklist
The plan is worked as a **message queue**, not an item list. The canonical set, with each
vendor's names:

| Canonical | SAP | Dynamics | Infor M3 |
|---|---|---|---|
| Release | (release/convert) | Firm | A1/A2 Release |
| Reschedule-in / **Expedite** | 10 Bring forward | **Advance** | B1/B3 Reschedule in |
| Reschedule-out / **De-expedite** | 15 Postpone | **Postpone** | B2/B4 Reschedule out |
| Cancel | 20 Cancel | (Decrease→0) | B7 Delete order |
| Increase / Decrease qty | 42 changed | **Increase/Decrease** | B5/B8 |
| Past due | 06/07 date in past | (Delays) | C1 delayed |
| Delay / **Futures** warning | — | **Futures → "Delays"** | C2/C3 will be delayed |

Two design-critical points: (a) **reschedule/cancel messages apply to real open orders
(scheduled receipts), not just planned orders** — MRP prefers rescheduling an existing
job/PO over creating a new planned order; (b) messages are grouped/prioritized and the
highest-priority one shows on the element line (SAP), the rest on drill-down.

### 7. Time-phased record — the six canonical rows (enterprise) vs one derived date (SMB)
The standard MRP record (canonical + SAP MD04 "period totals" + Oracle Horizontal Plan +
Dynamics "Period" tab): **Gross Requirements · Scheduled Receipts · Projected Available
Balance · Net Requirements · Planned Order Receipts · Planned Order Releases**, computed
left-to-right per bucket (PAB end-of-period; scheduled receipts = real open orders;
planned orders = suggestions). SAP MD04 pairs this with an **individual-lines view** — a
running available-balance ledger sorted by date, exception message on the line where the
balance goes negative. **The SMB tools deliberately omit this grid** and substitute a
single **stockout date / order-by date / days-of-cover** per item.

### 8. The SMB "dated decision row" is the UX the quantity worklist lacks
Katana's Replenishment screen and MRPeasy's Critical On-Hand are the models: each row is a
**dated decision** — item, supplier (resolved), shortage qty, **stockout date**,
**suggested order-by date**, suggested qty, cost — **sorted by urgency (time), not
quantity**, containing **only** items needing action, with a **one-click Buy/Make → pre-filled
draft → approve** path (individually or batched, Katana up to 50). Multi-level shows as a
**drill-down**: an ingredient's "Not available" expands to the missing sub-parts, and the
`Expected` date is literally the linked PO's arrival or sub-MO's deadline. Katana adds
**priority-based availability** (dragging MO priority live-recomputes every order's
availability — a lightweight allocation/peg substitute). None expose a formal firm flag;
MRPeasy's "in-progress" status is the de-facto lock.

### 9. Lot-sizing: a small standard taxonomy + order modifiers
All converge on: **lot-for-lot**, **fixed order quantity**, **period-of-supply / POQ /
fixed-period**, **min/max (replenish-to-max)**, then **order modifiers applied on top in
precedence**: minimum, maximum (split), **multiple/rounding (round up)**, standard qty,
scrap/yield. Carbon's four `reorderingPolicy` values map cleanly (see below). Dynamics
bundles these into a reusable **coverage group** attached to items — heavier than Carbon
needs (`itemPlanning` already holds them per item/location).

### 10. Regenerative-only, made fast + event-driven — net-change is being abandoned
Dynamics **Planning Optimization dropped net-change entirely** — regenerative-only,
justified by being fast enough (in-memory cloud service) to regenerate during office
hours. Validates Carbon staying regenerative (full company run) and investing in
**fast + event-driven scoped regen** rather than building incremental net-change.

## Answers to Research Questions

1. **Planned-order generation & multi-level cascade** — Net requirements → lot-size →
   planned order → BOM-explode the **lot-sized qty** to children, processed in LLC order,
   one top-down pass (acyclic). Universal. (SAP, canonical.)
2. **Lifecycle (planned/firm/released)** — Universal three states; firm freezes qty+date
   but still explodes and messages; release converts to real order. (All.)
3. **Pegging** — Bottom-up + top-down, single vs full, soft vs hard; surfaced as a
   graphical tree. (Oracle, SAP, Dynamics, Infor.)
4. **Exception / action messages** — Standard set = Release, Expedite/Reschedule-in,
   De-expedite/Reschedule-out, Cancel, Increase, Decrease, Past-due, Delay/Futures;
   worked as a filtered queue; apply to open orders too. (Canonical, SAP, Dynamics, M3.)
5. **Time-phased matrix** — Six canonical rows (GR/SR/PAB/NR/POR/POL) in enterprise;
   SMB substitutes a single derived date. (Canonical, SAP; Katana/MRPeasy.)
6. **Lot-sizing** — L4L / FOQ / POQ / min-max + modifiers (min/max/multiple/scrap); the
   modified qty explodes downstream. (All.)

## Competitor-Specific Details

- **SAP** — MD04 (live) vs MD05 (run snapshot); MD07 collective by MRP controller/exception
  group; Fiori "Monitor/Manage Material Coverage" cockpit; S/4HANA 2025 "Accept the MRP
  results" (mark reviewed); "quantity without source" = lot-sizing surplus that pegs to
  nothing; planning time fence firming types P1–P4.
- **Oracle** — order-modifier precedence (Fixed Days Supply → FOQ → Fixed Lot Multiplier →
  Min → Max(split) → Rounding); hard vs soft peg as an item attribute; Graphical Pegging.
- **NetSuite** — Supply Planning Workbench (review/modify/create/release, bulk approve,
  hierarchical peg drill-down); reschedule-in/out day thresholds; steers customers from
  legacy reorder-point + Time-Phased Planning to MRP.
- **Dynamics 365** — Planning Optimization (regenerative-only, in-memory); coverage
  group + coverage codes (Manual/Per requirement/Per period/Min-Max/Priority/Decoupling);
  Action messages (Advance/Postpone/Increase/Decrease/Derived) + Futures→"Delays";
  Explosion pegging tree; firm on order-date not due-date.
- **Infor** — LN Planned→Firm Planned→Confirmed→Released + Demand Pegging (hard/soft, up/down
  browsers); M3 coded A/B/C action messages worked in RPS001/002/005 with temporary
  deactivations.
- **Katana** — Replenishment screen (supplier/stockout-date/missing/suggested-qty/cost/order-by,
  urgency-sorted), one-click Buy/Make → draft (batch ≤50), priority-based availability,
  sub-MO chain via Ingredients Availability drill-down.
- **MRPeasy** — auto-cascades multi-level BOM (sub-assembly ops nested inside the parent MO),
  Critical On-Hand report = the shortage worklist, "Check Stock and Book Items" one-click MO/PO
  generation, in-progress = de-facto lock.
- **Fishbowl** — reorder-point outlier (min-qty thresholds, auto-draft PO, exception reports,
  email/SMS alerts); markets itself as replenishment "without the complexity of full MRP."

## Recommended Approach for Carbon

1. **Keep the enterprise data model** (validates the spec): `plannedOrder` (Make/Buy, typed,
   disposable) with **Planned → Firm → Released**; `plannedOrderPeg` (soft peg; MTO
   job↔sales-line is the existing hard peg). Adopt standard terms — planned order, firm
   planned order, release, low-level code, gross-to-net, planned order receipt/release,
   pegging, action message.
2. **Fix the engine as specced** — single LLC sweep (the existing `for level` loop),
   seed reorder need at each item's level, and **explode the lot-sized order quantity**
   (`computePlannedOrderQuantity`), not raw net requirement.
3. **Map the four existing policies to standard names** (keep the policies, no new enum):
   `Manual Reorder`→Manual · `Demand-Based Reorder`→lot-for-lot/net-requirement ·
   `Fixed Reorder Quantity`→fixed order quantity · `Maximum Quantity`→min/max
   (replenish-to-max); modifiers (min/max OQ, `orderMultiple`, `lotSize`, scrap) applied on
   top. Note **period-of-supply/POQ** as a future addition, not v1.
4. **Lead the UI with the SMB dated-decision pattern** — the default plan surface is a list
   of **decision-ready rows sorted by urgency (order-by date), not quantity**: item,
   supplier, shortage, **stockout/order-by date**, suggested qty, cost, status, one action
   chip; one-click **Release** (Make→job, Buy→PO) → pre-filled draft → approve, batch and
   whole-cascade. Only action-needed rows by default.
5. **Offer the full time-phased matrix as the expert drill-down** — the six canonical rows
   (GR/SR/PAB/NR/POR/POL) per bucket + the SAP-style running-balance line view; this is
   view #3, not the landing page. Substitute a single **stockout/order-by date** on the
   worklist rows so non-experts never need the grid.
6. **Action messages are a computed worklist over planned orders AND open orders** — adopt
   Release / Expedite (reschedule-in) / De-expedite (reschedule-out) / Cancel / Increase /
   Decrease / Past-due / Delay. v1 can ship **Release + planned-order exceptions**; deriving
   reschedule messages on **real open jobs/POs** is phase 2 (it interacts with the finite
   scheduler, which owns job dates).
7. **Cascade = drill-down tree** (Katana model) — each level shows its `Expected`/order-by
   date pointing at the child planned order / linked PO; reuse the existing job/method
   BOM-tree rendering. Surface "quantity without source" (lot-sizing surplus) as a labeled
   node so over-production is explainable.
8. **Add a planning-time-fence hook** — a per-location firm horizon inside which the engine
   auto-firms (or won't churn) planned orders; v1 may ship manual-firm-only but design the
   field. Evaluate the fence on the order's **release/start date** (Dynamics trap).
9. **Stay regenerative + event-driven** (Dynamics Planning Optimization precedent) — don't
   build net-change; invest in fast full regen + `notifyScheduleInputsChanged`-style scoped
   re-plan on demand/supply changes.
10. **Small wins to copy** — "mark reviewed / accept results" (SAP S/4HANA 2025) on a planned
    order; batch-release up to N (Katana); email/SMS shortage alert (Fishbowl) reusing
    Carbon's notification system.

## Sources

**SAP** — [Classic vs MRP Live](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/title-differences-and-functions-of-classic-mrp-and-mrp-live/ba-p/13919062) · [BOM explosion in MRP](https://sites.google.com/site/sapswords/home/sap-mrp/sap-mrp-functionality/step-10---bom-explosion-in-sap-mrp-run) · [Firming / Planning Time Fence](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/21aead0c98bd4755abdacd91c99e3393/8b73b6535fe6b74ce10000000a174cb4.html) · [Firming types P1–P4](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/mrp-types-p1-to-p4/ba-p/13262708) · [MD09 pegging](https://www.testingbrain.com/sap/pp-tutorial/md09-tcode-in-sap-2.html) · [MD04P pegging](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/stock-requirement-pegging-md04p-and-mrp-statuses/ba-p/13457413) · [Exception messages](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/mrp-exception-messages-list-introductory-information/ba-p/12918530) · [MD04 vs MD05](https://community.sap.com/t5/enterprise-resource-planning-q-a/difference-between-md05-and-md04/qaq-p/5593553) · [Manage Material Coverage F0251A](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/f296651f454c4284ade361292c633d69/c106b41442594c6797aad29381a6b521.html) · [Lot-size calculations](https://sites.google.com/site/sapswords/home/sap-mrp/sap-mrp-functionality/step-7---lot-size-calculations-for-the-procurement-proposals-in-an-sap-mrp-run)

**Oracle** — [Planning Central datasheet](https://www.oracle.com/a/ocom/docs/oracle-planning-central-cloud.pdf) · [Order modifiers](https://docs.oracle.com/cd/A60725_05/html/comnls/us/mrp/ordmod.htm) · [Item attributes & order modifiers 25D](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/fausp/item-attributes-and-order-modifiers-for-supply-planning.html) · [Planning exceptions](https://docs.oracle.com/en/cloud/saas/supply-chain-management/21d/fausp/planning-exceptions.html) · [Graphical Pegging](https://docs.oracle.com/cd/E18727_01/doc.121/e15188/T478564T479443.htm) · [Planner Workbench](https://docs.oracle.com/cd/E18727_01/doc.121/e15188/T478564T479029.htm)

**NetSuite** — [Supply Planning Workbench](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159187932855.html) · [Supply Planning process](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159172577944.html) · [Action messages](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_161945469305.html) · [Create orders from supply plans](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2294794.html) · [MRP product page](https://www.netsuite.com/portal/products/erp/supply-planning/mrp.shtml) · [Improved lot sizing / lead-time offset (RSM)](https://technologyblog.rsmus.com/technologies/netsuite/netsuites-new-supply-planning-features-improved-lot-sizing-methods-new-lead-time-offset/)

**Dynamics 365** — [Master planning architecture](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-planning-architecture) · [Master plans](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-plans) · [Planned order firming](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/planned-order-firming) · [BOM explosion](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-plan-explosion-bom-version) · [Net requirements & pegging](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/net-requirements) · [Coverage settings](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/coverage-settings) · [Action messages](https://learn.microsoft.com/en-us/dynamicsax-2012/appuser-itpro/about-action-messages)

**Infor** — [LN order statuses](https://docs.infor.com/ln/10.3.in/en-us/lnolh/help/cp/onlinemanual/000325.html) · [LN Planned Orders session](https://docs.infor.com/ln/10.5/en-us/lnolh/help/cp/rrp/cprrp1100m000.html) · [LN item order data / lot-sizing](https://docs.infor.com/ln/2022.x/en-us/lnolh/cpordplanug/cpomop000200.html) · [M3 action messages A/B/C](https://docs.infor.com/m3udi/16.x/en-us/m3beud/scplanhs/rps001.html) · [M3 planning policies/order types](https://docs.infor.com/m3swb/15.1.6/en-us/m3swbolh/setup/c_pwb_2_2_planning_policies_order_types.html)

**SMB cloud** — [Katana replenishment & order suggestions](https://support.katanamrp.com/en/articles/8937095-understanding-replenishment-and-order-suggestions) · [Katana AI replenishment](https://katanamrp.com/blog/ai-replenishment/) · [Katana MO priorities](https://support.katanamrp.com/en/articles/5914369-managing-manufacturing-order-priorities) · [Katana make-to-order / sub-MOs](https://support.katanamrp.com/en/articles/5908804-make-to-order-workflow-for-manufacturers) · [Katana ingredients availability](https://support.katanamrp.com/en/articles/5914374-ingredients-availability) · [MRPeasy multi-level BOM/scheduling](https://www.mrpeasy.com/demo-videos/multi-level-bom-and-multi-level-production-scheduling/) · [MRPeasy production planning](https://www.mrpeasy.com/demo-videos/production-planning-and-management/) · [MRPeasy stock replenishment](https://www.mrpeasy.com/blog/stock-replenishment/) · [Fishbowl MRP guide](https://www.fishbowlinventory.com/blog/material-requirements-planning)

**Canonical (APICS/ASCM)** — [Time-phased record / rows](https://www.erp-information.com/planned-order-receipt.html) · [Scheduled receipt](https://www.erp-information.com/scheduled-receipt.html) · [MRP text Ch.4 (U. Houston)](https://www.bauer.uh.edu/egardner/3301H%20Operations%20Management/OM%20Text/4MRP-1.pdf) · [Low-level code](https://www.asprova.jp/mrp/glossary/en/cat248/post-740.html) · [Lot-sizing methods](https://usersolutions.com/blog/mrp-lot-sizing-methods) · [Pegged requirements](https://www.erp-information.com/pegged-requirements.html) · [Time fences](https://www.apicsforum.com/docs-page?id=194&category=Release+Time+Fence)

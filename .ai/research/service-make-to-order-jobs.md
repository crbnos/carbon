# Service Make-to-Order Jobs Research: Best Practices Survey

## Summary

How should a **made-to-order service** — sold on a sales order line, produced by a
job, but never stocked as a finished good — be fulfilled and posted to the GL?
Surveyed SAP S/4HANA, Oracle NetSuite, Epicor Kinetic, Microsoft Dynamics 365
Business Central, and Odoo, plus standard cost-accounting references. **Consensus is
unambiguous: a service output is never a finished-goods inventory asset, so its cost
flows WIP → COGS directly (or is expensed on delivery) with no Finished-Goods leg and
no inventory shipment.** The cleanest fit for Carbon (which already has a job/WIP model
and a shipment-posting step) is **Epicor's "Make Direct" pattern**: keep the job and
its WIP accumulation, but relieve **WIP → COGS at fulfillment with no stock movement**;
mark the sales line fulfilled by job/service completion rather than a goods issue; sweep
any residual WIP to a variance account at job close. Revenue-recognition timing reduces
to a small enum (completed-contract / percent-of-completion / as-billed), not a config
matrix. In-house vs subcontracted service differ only at the *cost origin* (internal
labor absorption vs a vendor bill), never in the downstream WIP→COGS treatment.

## Competitors Surveyed

- **SAP S/4HANA** — enterprise reference for cost-object controlling, WIP, results
  analysis / event-based revenue recognition, and resource-related billing of services.
- **Oracle NetSuite** — clearest item-type model (Service vs Inventory/Assembly) and the
  "services bill directly, no fulfillment, no COGS from the item" pattern; steers
  cost-matched service deliverables to Projects/job costing.
- **Epicor Kinetic** — the "Make Direct" make-to-order pattern that ships a job straight
  from WIP to COGS with no inventory leg — the closest match to Carbon's existing model.
- **Microsoft Dynamics 365 Business Central** — item types (Inventory / Non-Inventory /
  Service) and the Projects (Jobs) WIP-recognition engine (five WIP methods).
- **Odoo** — service product fulfillment via timesheets/milestones + invoicing policy
  (ordered vs delivered); no WIP for services; subcontracting-as-purchase contrast.

## Key Consensus Patterns

### 1. A service output is never a finished-goods inventory asset

- **SAP**: made-to-order services use **non-valuated sales-order stock** — *no* GL posting
  at "receipt to stock" and *no* goods issue; the order/WBS is the cost object and cost
  settles WIP → COGS.
- **NetSuite**: a Service-for-sale item carries **only an Income account** (plus optional
  Deferred Revenue) — **no Asset and no COGS account**. A work order/assembly build *must*
  land its completion in an inventory Asset account, so a WO literally **cannot output a
  service**.
- **BC**: Non-Inventory and Service item types track **no inventory**, post **no COGS
  offset**, and create **no shipment**; Production Orders require inventory items.
- **Epicor**: a service is a **non-stock part + job**; shipping relieves **WIP, not
  on-hand**.
- **Odoo**: Service products generate **no stock moves**; MRP does not "produce" a service.
- **Rationale**: you can only capitalize an asset you can measure and hold. A delivered
  service has no unit of stock to value, so there is nothing to sit in Finished Goods —
  cost is matched to revenue directly as WIP → COGS (or expensed on delivery).

### 2. Fulfillment is decoupled from inventory shipment

- **Epicor**: a **customer shipment document (packing slip) still exists**, but it relieves
  **WIP instead of inventory** and posts a single **MFG-CUS (WIP → COGS)** entry. This is
  the "make-to-order direct-to-COGS" pattern.
- **NetSuite/BC**: service lines are flagged **not fulfillable** and are **billed directly
  off the order** — invoice alone completes the line, no fulfillment record.
- **Odoo**: the SO line's **delivered quantity** is driven by **timesheets / milestones /
  manual**, never a delivery order.
- **SAP**: no goods issue; billability is driven by **order status (TECO/complete) +
  accumulated cost**, invoiced via **Resource-Related Billing** (actuals) or **milestone
  billing** (fixed price).
- **Rationale**: "fulfilled" for a service means *the work was performed*, signalled by
  job/service completion — not a stock movement.

### 3. Cost flows WIP → COGS (job/WIP is the only "inventory" a service has)

- **Job/WO WIP** accumulates labor + overhead (+ any consumed materials).
- On completion/fulfillment, **WIP is relieved directly to COGS** (Epicor MFG-CUS; SAP
  settlement on non-valuated stock; BC Recognized Cost via Calculate WIP).
- **NetSuite** takes the alternate route: no item-level WIP for services — cost is
  accumulated on a **Project (job costing)** container instead, recognized by a billing
  schedule. The project *is* the WIP container.

### 4. Revenue recognition timing is a small enum, not a matrix

Every system exposes the same three shapes:
- **Completed contract** — recognize cost + revenue at completion (SAP RA method 15; BC
  Completed Contract).
- **Percentage-of-completion (cost-based)** — recognize proportional to cost incurred vs
  budget (SAP method 03; BC Percentage of Completion).
- **As-billed / T&M** — recognize as invoiced; billing itself is the progress measure (SAP
  method 07 / resource-related billing; NetSuite T&M; BC Cost Value / Sales Value; Odoo
  "invoice what is delivered").
- The balance-sheet plug between recognized revenue and billed amount is **unbilled
  receivable** (cost/revenue > billed) or **deferred revenue** (billed > earned).

### 5. No standard finished-good cost ⇒ no production variance; sweep residual WIP

- **SAP**: non-valuated stock has no material-master standard, so there is **no
  target-vs-actual production variance** — profit/loss is simply recognized revenue minus
  recognized actual cost in CO-PA.
- **Epicor**: at job close, **Capture COS/WIP** marks the job WIP-cleared and **purges any
  residual WIP to a manufacturing variance (MFG-VAR)** account.
- **Rationale**: a service job's "variance" is just leftover WIP that never became COGS; it
  must be swept to a variance/adjustment account so WIP ties out.

### 6. In-house vs subcontracted service differ only at the cost origin

- **In-house labor**: internal **activity absorption** — confirmed hours × labor rate
  debit the job/WIP; the offset **credits a labor/cost-center account** (SAP secondary cost
  element; no vendor, no AP). Odoo routes this to an **analytic account** via timesheets.
- **Subcontracted / outside processing**: a **purchased service** — a **PO → receipt/service
  entry → vendor bill (three-way match)** debits the job/WIP, credits **GR/IR clearing**
  then **AP**. (SAP external-service PO item category D / ML81N; SyteLine "receipt posts the
  vendor's processing cost to the job's WIP"; D365 "subcontracted cost is the purchase
  price of the service").
- **Both** land in the same job/WIP bucket and flow **WIP → COGS** for a service output.
  The three-way match to AP is the *tell* for subcontracting; time entry with an applied
  rate is the tell for in-house.

## Answers to Research Questions

1. **How is an MTO service SO line marked fulfilled with no inventory shipment?** — By
   **job/service completion**, not a goods issue. Epicor keeps a *shipment document* that
   relieves WIP (not stock); NetSuite/BC **bill the line directly** (no fulfillment record);
   Odoo sets **delivered qty from timesheets/milestones**; SAP bills from **accumulated
   cost + TECO status** via resource-related billing. All four avoid an inventory movement.

2. **Does service-job WIP go WIP → COGS directly, or WIP → deferred/service asset → COGS at
   invoice?** — **WIP → COGS directly**, with **no Finished-Goods / service-inventory asset
   leg** (Epicor MFG-CUS; SAP settlement on non-valuated stock; BC Recognized Cost).
   Deferral, when used, is a **revenue-recognition** choice (deferred *revenue*), not a
   deferred *cost asset*. NetSuite's variant keeps cost on a **Project** container rather
   than item WIP, but still never creates a finished-good asset.

3. **Revenue recognition timing for MTO services?** — Configurable per line/contract:
   **completed-contract** (on completion), **percent-of-completion** (cost-based), or
   **as-billed/T&M**. Default for a simple shop: recognize at completion / on invoice.

4. **Variance treatment with no standard finished-good cost?** — There is **no production
   variance** in the standard-cost sense; instead, **residual WIP at job close is swept to a
   variance/adjustment account** (Epicor Capture COS/WIP → MFG-VAR). Margin = recognized
   revenue − recognized actual cost.

5. **How are service/non-stock work orders closed vs physical ones?** — Same WIP
   accumulation, but the **completion posts WIP → COGS instead of WIP → Finished Goods**,
   and closing sweeps leftover WIP to variance rather than reconciling to a stocked
   standard cost. No receipt-to-inventory step.

6. **Where does accounting differ for subcontracted vs in-house service?** — Only at the
   **cost origin**: subcontracted = **vendor bill via PO/receipt/3-way match → GR/IR → AP**;
   in-house = **internal labor absorption at a rate (no AP document)**. Downstream WIP→COGS
   is identical, so model **one WIP path with two cost sources**.

## Competitor-Specific Details

### SAP S/4HANA
- Cost object = service order / WBS / **sales order with account-assignment category E**
  (sales-order controlling on) and **non-valuated stock** (no FG postings).
- **Resource-Related Billing (RRB)** via a **DIP profile** turns accumulated actual cost
  into a billing request (`DP90/DP91`) — bill from actuals, no delivery.
- **Results Analysis (classic)** or **Event-Based Revenue Recognition (S/4HANA, real-time,
  posts WIP/COGS/deferred revenue at each source document)** — EBRR is the simpler model to
  emulate.
- In-house labor = **activity confirmation** (secondary cost element credits cost center,
  debits order). External service = **service PO (item cat D) + ML81N service entry** (Dr
  expense/order, Cr GR/IR).

### Oracle NetSuite
- **Service for sale** item = **Income account only**; no Asset/COGS. Set **"Can Be
  Fulfilled/Received" = off** → line **skips fulfillment, bills directly** (DR AR / CR
  Income; CR Deferred Revenue if ARM on).
- A **Work Order builds an assembly into inventory** — it **cannot output a service**.
- Made-to-order services with cost-vs-revenue matching go to **Projects / job costing**:
  costs accumulate on the job; revenue via billing schedule (T&M, milestone/%-complete,
  fixed interval, charge rules). The project *is* the WIP container.

### Epicor Kinetic  ← closest to Carbon
- **Make Direct** = demand link from an SO release to a job; ships **straight from WIP**,
  no stock. Auto-triggered for **non-stock parts** / engineered-from-quote parts, or a
  manual "Make Direct" checkbox.
- Shipment posts **MFG-CUS: WIP → COGS** (no Finished Goods). Fulfillment is still a
  **customer shipment / packing slip**, just with **no inventory relief**.
- **Capture COS/WIP** batch closes jobs and **purges residual WIP to MFG-VAR**.
- Edge cases to design for: **partial-shipment** cost can strand in WIP; **zero-dollar
  MFG-CUS posts no GL**.
- Minimal account set: **WIP, COGS, Sales, Variance/Adjustment**.

### Dynamics 365 Business Central
- Item **Type**: Inventory / Non-Inventory / Service. Non-Inventory & Service post **no
  COGS offset, no shipment**; invoice alone books revenue.
- Production Orders need inventory items; service/made-to-order deliverables go to
  **Projects (Jobs)** with a **WIP engine**: five methods (Cost Value, Cost of Sales, Sales
  Value, Percentage of Completion, Completed Contract) posting **WIP Costs → Recognized
  Costs** and **WIP Sales → Recognized Sales** via the Calculate WIP batch. Only needed if
  you want deferred/percent-complete recognition; a simple ship-to-COGS service doesn't.

### Odoo
- **Service** product + invoicing policy (**Ordered / Delivered / Timesheets /
  Milestones**). Timesheets on the linked project task drive **delivered qty**; **no WIP**
  for services — cost/revenue tracked via **analytic accounting** (project profitability).
- **Subcontracting** = a **BoM of type "Subcontracting"** + subcontractor-as-vendor; it's a
  **purchase flow** (PO → receipt → vendor bill), and the output is a **storable good** (so
  *that* gets a FG leg) — distinct from selling a bare service.

## Recommended Approach for Carbon

Carbon already models jobs with real WIP and posts a Make-to-Order job as
**WIP → Finished Goods → COGS on shipment**. The service path should reuse that machinery
minus the inventory legs — i.e., **adopt Epicor's "Make Direct" pattern**:

1. **Keep the job as the cost object.** A service MTO line still creates a job that
   accumulates **labor + overhead (+ any consumed materials)** as WIP, exactly like a
   physical job. This is what the user wants ("create a service job"), and it preserves
   job costing.

2. **Fulfill by completion, not by goods issue.** Mark the sales order line fulfilled when
   the **service job completes** (or via a lightweight "service completion" analogous to a
   shipment with **no inventory movement**). Do **not** post a finished-goods receipt and do
   **not** relieve on-hand inventory. (Mirrors the branch's existing decision to hide
   Shipments for service SO lines.)

3. **Post WIP → COGS directly at fulfillment/completion.** Replace the
   **WIP → Finished Goods → COGS-on-shipment** chain with a single **WIP → COGS** relief for
   service jobs. No Finished-Goods (or Raw-Materials-as-FG) account is touched. This is the
   only accounting change of real substance and is the crux of the user's "accounting
   transactions will need work" instinct.

4. **Recognize revenue on the sales invoice** as today (DR AR / CR service revenue). Start
   with the simplest timing — **recognize at completion / on invoice** — and leave
   percent-of-completion / deferred revenue as a future enhancement (the small enum from
   Pattern 4). A service item should carry a **revenue account** and a **COGS account** but
   **no inventory/asset account** (NetSuite's rule).

5. **Sweep residual WIP to a variance/adjustment account at job close.** Reuse Carbon's
   existing manufacturing-variance handling; there is **no standard-cost production variance**
   for services, so leftover WIP (over/under-absorbed labor/overhead) is booked to variance
   — don't try to reconcile it to a stocked standard cost.

6. **One WIP path, two cost sources.** In-house labor (production events / activity at a
   labor rate) and subcontracted/outside operations (PO receipt → vendor bill) both debit
   the same job WIP — Carbon already supports outside operations on jobs, so no new branch
   is needed beyond ensuring both feed the service job's WIP and then WIP → COGS.

**What to explicitly *not* build:** a finished-goods/service-inventory asset leg, an
inventory shipment/goods-issue for services, or a standard-cost variance against a
non-existent stocked cost. **Deferred-cost assets are out** — deferral, if ever added, is a
revenue-recognition concern (deferred *revenue*), not a cost asset.

**Open questions to carry into the spec** (`/spec-writing`):
- Is fulfillment marked by **job completion** directly, or by a distinct **service-completion
  document** (Epicor keeps a shipment doc; NetSuite/BC bill directly)? Recommend: job
  completion drives line fulfillment, no separate doc.
- Does the service item require a **COGS account** (job/WIP path, recommended) or should a
  pure service **bill directly with no COGS** (NetSuite simplest path)? The user's "create a
  service job" framing points to the **WIP → COGS job path**.
- **Revenue timing**: completion/on-invoice only for v1 (recommended), or expose the
  percent-of-completion enum now?
- Does Carbon post service **labor to WIP in real time** (production events) or only settle
  at completion? Recommend: accumulate as events post (matches physical jobs), relieve to
  COGS at completion.

## Sources

**SAP**
- https://sapinsider.org/make-to-order-wip-and-cost-of-sales-you-have-three-not-two/
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-resource-related-billing
- https://learning.sap.com/courses/cost-object-controlling-in-sap-s-4hana/calculating-work-in-process-wip
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/c9b5e9de6e674fb99fff88d72c352291/ec1c1e42ce614499a93790c213fbecab.html
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/cost-of-goods-sold-split-in-make-to-order-scenario-mto-with-sap-s-4hana/ba-p/13475148
- https://community.sap.com/t5/financial-management-blog-posts-by-sap/supported-revenue-recognition-methods-in-sap-s-4hana-service-including-sap/ba-p/14248039
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/89d896ca9cd64318b1667df5ec00e4b2/7fd9ad1108b94403a2871cf348d4b891.html (Event-Based Revenue Recognition)
- https://community.sap.com/t5/supply-chain-management-blog-posts-by-members/the-ultimate-guide-to-subcontracting-in-sap-s-4hana/ba-p/14223371

**NetSuite**
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1536275392.html (Items for Revenue and Expense)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2172688.html (Account Information about Items)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2328390.html (Assembly Work Orders)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2337938.html (Using WIP on Work Orders)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1204906.html (Project Billing)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N1678106.html (Using Revenue Recognition)

**Epicor**
- https://www.epiusers.help/t/is-it-ok-to-receive-a-make-to-order-job-to-inventory/132874
- https://www.epiusers.help/t/possible-reasons-for-make-direct/124197
- https://www.epiusers.help/t/make-direct-and-shipping-from-inventory/59242
- https://www.epiusers.help/t/packing-slip-from-shipment-did-not-trigger-wip-release-to-cogs/68707
- https://scaledsolutionsgroup.com/how-to-use-epicor-kinetic-for-accurate-job-costing-and-margin-analysis/

**Dynamics 365 Business Central**
- https://learn.microsoft.com/en-us/dynamics365/business-central/projects-understanding-wip
- https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-about-item-types
- https://learn.microsoft.com/en-ca/dynamics365/business-central/walkthrough-calculating-work-in-process-for-a-job

**Odoo + industry accounting**
- https://www.odoo.com/documentation/18.0/applications/sales/sales/invoicing/invoicing_policy.html
- https://www.odoo.com/documentation/18.0/applications/sales/sales/invoicing/time_materials.html
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/mto.html
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/subcontracting.html
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/manage-subcontract-work-production
- https://www.netray.co/resources/how-to-configure-syteline-outside-processing
- https://www.accountingtools.com/articles/work-in-process-accounting
- https://accountingforeveryone.com/explain-the-revenue-recognition-and-matching-principle/

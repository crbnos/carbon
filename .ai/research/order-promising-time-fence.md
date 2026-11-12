# Order Promising and Time Fence Research: Best Practices Survey

## Summary

This survey answers one question: what must a sales order do when its date is inside the near-term window? The window is the period in which the material, the capacity and the lead time are already fixed. A customer asked for an exception message at order entry for that case.

The survey covers SAP S/4HANA, Dynamics 365 SCM, Dynamics 365 Business Central (BC) and Oracle NetSuite. It also covers Oracle Fusion Global Order Promising (GOP), Epicor Kinetic, Odoo and JobBOSS². The survey also uses the APICS dictionary. It maps the result onto the MRP v2 spec (`.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md`).

The industry name for the request is **order promising**, and the check is an **availability check** (ATP or CTP). Five findings matter:

1. Every product with a check runs it on the **sales order line**. No product checks an RFQ.
2. The fence that controls order entry is the **lead time** of the item (SAP replenishment lead time, Oracle infinite fence, NetSuite ATP lead time). It is not the MRP planning time fence.
3. The MRP planning time fence and the firming fence affect **MRP only** (SAP, D365, NetSuite, Epicor).
4. On a failed check, SAP, D365, BC, NetSuite and Oracle **propose the earliest date**. Odoo and Epicor only warn. No product found here hard-blocks the order.
5. In SAP and NetSuite, a **confirmed** date reduces the free stock for the next order. Only a supply order (a planned order or a job) holds capacity.

The MRP v2 fence (`planningTimeFenceDays`) is the APICS planning time fence. The customer asks for the APICS demand time fence. The two features share an engine, but they need two separate settings.

This file does not repeat the CTP engine survey. For that, see `.ai/research/quote-lead-time-prediction.md`.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference: the classic ATP check, advanced ATP (aATP), CTP, backorder processing (BOP) and MRP firming types.
- **Microsoft Dynamics 365 SCM** — `Delivery date control` on the sales line is the cleanest model of check levels. It also has the most explicit set of MRP fences.
- **Microsoft Dynamics 365 Business Central** — mid-market. It has a stockout warning at line entry and order promising on demand.
- **Oracle NetSuite** — mid-market. It has an ATP lead time for each item and Supply Allocation (a reservation that lasts) with exception alerts.
- **Oracle Fusion GOP** — rule-based promising with two named order-entry fences.
- **Epicor Kinetic** — a make-to-order job shop ERP with CTP in Sales Order Entry and a planning time fence on the part.
- **Odoo** and **JobBOSS²** — job-shop and SMB tools. Each one shows what "warn only" looks like.
- **APICS / ASCM dictionary** — the standard definitions of the demand time fence, the planning time fence and the three zones.

## Key Consensus Patterns

### 1. The check runs on the sales order line, when the user saves or changes it

- **SAP**: The availability check runs automatically at sales order entry and again when the quantity or the date changes. On sales quotations the check is off by design (schedule line category BN).
- **D365 SCM**: With CTP, each save of a line sets the `Confirmed ship date` and the `Confirmed receipt date`. A change of quantity or site starts the check again. The check re-promises only if the old date can no longer be met.
- **NetSuite**: With Supply Allocation, an edit to the item, the quantity, the location or the `Supply Required By Date` starts the check. Without Supply Allocation, the user runs `Check Item Availability` on demand.
- **Oracle GOP**: Order Management schedules the line automatically. A change to the requested date schedules it again.
- **BC**: The `Stockout Warning` shows automatically at line entry. Order promising runs on demand.
- **Epicor**: CTP runs on demand from Sales Order Entry.
- **Rationale**: The sales order line is the point where the promise binds. The quote is a proposal, and the RFQ has no structure to check.

### 2. A setting with check levels: a company default plus an item override

- **D365 SCM**: The levels are `None`, `Sales lead time`, `ATP`, `ATP + Issue margin`, `CTP` and `Batch CTP`. The company default is in the Accounts receivable parameters. A product can override it, and each order line can override it too.
- **Oracle GOP**: An ATP rule has 3 modes: `Infinite Availability`, `Lead Time` and `Supply Chain Search`. A flag, `Search Components and Resources`, turns on CTP. The most specific rule wins (item and organization, then item, then category).
- **SAP**: The checking group on the material master (MRP 3 view) selects the check. The value `KP` means "no check".
- **NetSuite**: The item sets the `Default ATP Method` and the `ATP Lead Time`. Each location can set its own ATP lead time.
- **BC**: Order promising runs only for items with `Critical` selected.
- **Rationale**: A make-to-stock part needs a stock check. A make-to-order part needs a capacity check. A commodity part needs only the lead time. One company has all three, so the item needs an override.

### 3. The order-entry fence (APICS: demand time fence) is the lead time of the item

- **SAP**: The replenishment lead time (RLT) is the fence. "Requirements outside the replenishment lead time are considered to be available." Inside the RLT, the end of the RLT is the earliest date that SAP can confirm.
- **Oracle GOP**: The `Infinite Fence` is the order-entry fence. After it, GOP promises the requested date without a check. The fence can be a number of days or a lead time (`Total Lead Time`, `Cumulative Manufacturing Lead Time`, `Cumulative Total Lead Time`). The `ATP Fence` decides whether GOP uses stock first or new supply first.
- **NetSuite**: If the supply is not enough, the promise is today plus the `ATP Lead Time`.
- **D365 SCM**: The `ATP time fence` sets the ATP period. CTP never promises a date earlier than the `Sales lead time`.
- **APICS**: The demand time fence (DTF) controls new customer orders. Inside the DTF, the planner promises a new order from ATP only. An order that needs new production inside the DTF needs the approval of the master scheduler.
- **Rationale**: After the lead time, the factory can still buy and make the part, so any date is possible. Before the lead time, only existing stock or free capacity can meet the date. The lead time is already on every item, so this fence needs no setup.

### 4. The MRP planning fence is a different fence

- **SAP**: The planning time fence and the firming type (0 to 4) control MRP proposals. The SAP help pages tie them to procurement proposals, not to sales orders.
- **D365 SCM**: The `Coverage`, `Freeze`, `Firming` and `Capacity` time fences are master planning settings. D365 shows the ATP fences separately.
- **NetSuite**: The `Demand Time Fence` and the `Planning Time Fence` affect supply planning only. Both defaults are 0.
- **Epicor**: The `Planning Time Fence` on Part > Site stops MRP from creating suggestions inside the fence. It counts calendar days.
- **APICS**: The planning time fence (PTF) is usually the cumulative lead time. Inside it, MRP creates no planned orders and does not reschedule in. Beyond the PTF is the "liquid zone". There, sales can book customer orders freely.
- **Rationale**: The planning fence keeps the plan stable when the demand changes. The order-entry fence protects the customer promise. One setting cannot do both jobs.

### 5. On a failed check: propose the earliest date, keep the requested date, and do not block

- **SAP**: The Availability Control screen offers 3 options: `One-time delivery`, `Complete delivery` and `Delivery proposal`. Each option writes confirmed schedule lines. A partial confirmation writes more than one line. I found no source for a block from the ATP check.
- **D365**: The AX 2012 dialog lets the user keep the typed date (`Disable dlv. date control`) or accept the proposed date. The current SCM version of this dialog is unconfirmed. With ATP, the ship date moves to the first date that has enough ATP.
- **BC**: BC writes the earliest date to `Shipment Date`. The stockout warning "doesn't prevent them from creating the order."
- **Odoo**: If the delivery date is earlier than the expected date, Odoo shows "Requested date is too soon." The user can still save.
- **Epicor**: A `Past Due Completion Date` indicator and a `Days Past Ship By` field show the miss. Nothing blocks the order.
- **Oracle GOP**: The line gets the status "Delay of x days". `Check Availability` shows up to 5 alternatives: on time, delayed, or split.
- **Two dates**: 4 products keep the requested date apart from the promised date:
  - SAP: the requested date and the confirmed schedule line.
  - D365: the requested and the confirmed ship dates.
  - Oracle: the requested and the scheduled dates.
  - NetSuite: `Supply Required By Date` and `Expected Ship Date`.
- **Rationale**: Sales sometimes accepts a late date on purpose, for example with an expedite or a partial shipment. A block forces a workaround. The two dates make each miss visible and measurable.

### 6. Free stock is cumulative ATP, and a confirmation reduces it

- **SAP**: ATP = stock + receipts (purchase orders, planned orders, production orders) − issues (sales orders, deliveries, reservations, dependent requirements), added up over time. A confirmed quantity reduces ATP when the user saves the order.
- **D365 SCM**: The method is "cumulative ATP with look-ahead". The first period is the on-hand stock minus the due and overdue orders. ATP is never less than 0.
- **NetSuite**: The methods are `Discrete ATP` and `Cumulative ATP with Look Ahead`. Supply is POs, transfer orders and work orders. Demand is sales orders, transfer orders and work orders. Plain ATP does not allocate. Supply Allocation does allocate (`Reserved Allocation`, `Firm Allocation`).
- **APICS**: ATP is "the uncommitted portion of a company's inventory and planned production".
- **Rationale**: Raw on-hand stock over-promises. Two orders can see the same 100 pieces. Cumulative ATP subtracts what other orders already use.

### 7. A supply order holds the capacity, not the check

- **SAP**: CTP creates temporary planned orders. If the user does not save the order, SAP deletes them. On save, they become permanent planned orders.
- **D365 SCM**: `Keep supply for confirmed demand` keeps the planned orders and the capacity reservations of a confirmed line. The default is `No`.
- **BC**: `Accept` on a CTP result creates a planning line and a reservation entry.
- **Epicor**: `Confirm` on a CTP result creates a firm or unfirm job.
- **Oracle GOP**: `Check Availability` sets supply aside only until the next collection. I found no reservation that lasts.
- **Rationale**: Capacity is a schedule, not a stock quantity. Only a scheduled supply order can hold it.

### 8. Exceptions go to a worklist; the person who enters the order gets a message on the line

- **SAP**: The user works from pull worklists ("Sales Order Fulfillment - Analyse Issues"). A BOP run "doesn't raise any exceptions." I found no push notification.
- **NetSuite**: A missed `Supply Required By Date` creates a `Supply Allocation Exception` on the `Order Allocation Alerts` page.
- **JobBOSS²**: The Scheduling Advisor lists jobs that are at risk or past due, after the fact.
- **SAP, D365, BC, Odoo, Epicor**: The person who enters the order sees the result at entry, on the line or in a dialog.
- **Rationale**: A message on the line reaches the only person who can still change the promise. A worklist lets the planner fix the problem in one place.

## Answers to Research Questions

1. **Where in the order flow does the check run, and is it automatic?** The check runs on the sales order line. It runs at entry and at a change of quantity, date or location. It is automatic in SAP, D365 CTP, NetSuite with Supply Allocation and Oracle GOP. It is on demand in BC order promising, Epicor CTP and NetSuite without Supply Allocation. SAP turns the check off on quotations by design. The earlier survey found CTP on a quote line only in SyteLine, VISUAL and Cetec. No product checks an RFQ.
2. **What check levels exist, and where are they set?** The levels are none, lead time, ATP and CTP (D365, Oracle, SAP). Each product sets them as a company default with an item override (D365, Oracle rule precedence, the SAP material master, the NetSuite item).
3. **Which fences exist, and which ones control order entry?**
   - Order entry: SAP RLT, Oracle `Infinite Fence` and `ATP Fence`, D365 `ATP time fence` and `Sales lead time`, NetSuite `ATP Lead Time`, and the APICS demand time fence.
   - MRP only, SAP and D365: the SAP planning time fence and firming type; the D365 coverage, freeze, firming and capacity fences.
   - MRP only, NetSuite and Epicor: the NetSuite demand and planning fences; the Epicor planning time fence.
   - The usual order-entry default is the lead time of the item. NetSuite planning fences default to 0. I found no stated default for the SAP or Oracle fences.
4. **What happens when the check fails?** The system proposes the earliest date, a split, or alternatives (SAP, D365, Oracle, BC). It keeps the requested date. It warns and does not block (BC, Odoo, Epicor; no block found in SAP). D365 (AX 2012) lets the user keep the typed date. Exceptions go to pull worklists (SAP, NetSuite). No product found here pushes a notification at order entry.
5. **How does ATP calculate free stock, and does the check reserve anything?** Cumulative ATP: stock + scheduled receipts − committed issues, carried forward (SAP, D365, NetSuite, APICS). A confirmation reduces ATP for later orders (SAP, NetSuite Supply Allocation). Only a supply order holds capacity. The system creates it when the user saves or accepts the promise (SAP CTP, BC, Epicor, D365 with `Keep supply for confirmed demand`).
6. **What are the standard terms?**
   - Order promising, available-to-promise (ATP), capable-to-promise (CTP).
   - Requested date, confirmed (promised) date.
   - Demand time fence, planning time fence; frozen, slushy and liquid zones (APICS).
   - Delivery date control (D365), availability check (SAP).

## Competitor-Specific Details

### SAP S/4HANA

- The requirements class turns the check on globally. The schedule line category can turn it off, but it cannot turn on a check that the requirements class has off.
- The scope of check selects which stock types count. Unrestricted stock always counts. Quality inspection stock, blocked stock and safety stock count only if the scope selects them.
- aATP adds product allocation, alternative-based confirmation (other plants, substitute materials) and supply creation-based confirmation (SBC). SBC is the aATP form of CTP.
- BOP confirms orders again in priority order. The confirmation strategies are `Win`, `Gain`, `Redistribute`, `Fill` and `Lose`.
- Firming types 1 to 4 decide two things. The first is automatic or manual firming. The second is what MRP does with a new proposal. MRP moves it to the end of the fence, or MRP does not create it.

### Microsoft Dynamics 365 SCM

- The ATP fences are `ATP time fence`, `ATP backward demand time fence`, `ATP backward supply time fence`, `ATP delayed demand offset time` and `ATP delayed supply offset time`.
- `Delivery alternatives` lists earlier options. A partial quantity splits the line into a delivery schedule.
- `Batch CTP` leaves the confirmed dates blank until a planning run. A status field shows `Not ready` or `Ready`.
- The coverage time fence defaults to 100 days.

### Microsoft Dynamics 365 Business Central

- ATP returns a blank date when no stock covers the line. The user then runs CTP for the part that is not covered.
- `Check-Avail. Period Calc.` and `Check-Avail. Time Bucket` set the look-ahead window. BC has no named order-entry fence.

### Oracle NetSuite

- With Supply Allocation, `Expected Ship Date` becomes read-only. The availability check moves to `Supply Required By Date`.
- If supply drops, NetSuite removes allocations in reverse priority order.
- `Expected Ship Date` does not update by itself when a supply date changes.

### Oracle Fusion GOP

- `Supply at End of Horizon` has 2 options: `Assume Supply is Infinitely Available` or `Assume no Supply is Available`.
- `Profitable to Promise` picks the lowest-cost option. `Source Based Promising` reads live stock and respects reservations.
- Oracle advises that the infinite fence match the planning time fence (search-result snippet only).

### Epicor Kinetic

- Multi Level CTP generates and schedules an unfirm job when stock is short. Without it, CTP uses the manufacturing lead time and the receive time of the part.
- The user types the `Promise Date` field (Kinetic 2024.1). The field does not drive scheduling. MRP plans from `Ship By`.
- A forum source says that jobs linked to make-to-order demand get no planning time fence (unconfirmed).

### Odoo

- The expected date comes from the customer lead time plus the sales security lead time. It ignores weekends and capacity.
- The quotation shows forecast stock. Make-to-order lines get no warning before confirmation.

### JobBOSS²

- The promised date defaults to today, according to a user request on the ECI ideas portal. Other user requests ask for a prompt or a block. This suggests that no check exists today (unconfirmed).

## Recommended Approach for Carbon

### Carbon today

| Item | Current behavior | Source |
|---|---|---|
| Sales order line date | One date: `salesOrderLine.promisedDate`. The user types it, or quote conversion sets it to today + `quoteLinePrice.leadTime`. | `packages/database/src/types.ts`; `.ai/specs/2026-09-22-quote-lead-time-prediction.md` |
| Requested date | Only on the shipment header: `salesOrderShipment.receiptRequestedDate` and `receiptPromisedDate`. | `packages/database/src/types.ts` |
| MRP demand date | MRP reads `promisedDate`, else today, in weekly periods. A wrong promise becomes wrong demand. | `packages/planning/src/mrp/plan-company.ts:568` |
| Check at order entry | None. | `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderLineForm.tsx` |
| `planningHorizonDays` | A view filter on the planning grids. It is not an engine input. | `.claude/rules/mrp-system.md` |
| Quote lead-time simulation | Finite CTP on a quote line. It counts on-hand stock only: no incoming supply, and no stock that other orders use. | `packages/planning/src/scheduling/quote-lead-time.ts` |
| MRP v2 Phase 1 | Shipped: planning actions. | `.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md` |
| MRP v2 Phase 2+ | Designed, not started: planned orders, `planningTimeFenceDays` auto-firm, rough-cut capacity, `runPlanningWhatIf`, the `PlanningExceptions` digest. | same |

### How MRP v2 and the customer request fit together

| Customer request | APICS term | Carbon piece | Status |
|---|---|---|---|
| The near-term window is fixed | Demand time fence | None. `planningTimeFenceDays` (v2) is the planning time fence, a different fence. | Missing |
| Check the date at order entry | Order promising | None on the sales order line | Missing |
| Material is already ordered | ATP | The quote simulation (on-hand stock only); the MRP projection (weekly) | Partial |
| Resources are already allocated | CTP | The quote lead-time simulation (finite); v2 rough-cut capacity | Shipped for quotes |
| Lead time is too short | Lead-time check | `itemReplenishment.leadTime` | Data exists, no check |
| Do not promise stock sold to others | Cumulative ATP plus confirmation | None | Missing |
| Message to the person who enters the order | Line message | None | Missing |
| Hold capacity for a confirmed order | CTP accept | v2 planned orders and Firm status | Designed, not started |
| Planner exceptions | Exception worklist | v2 `PlanningExceptions` digest; the `JobsProjectedLate` digest exists | Designed |
| Simulation from the RFQ | — | No ERP surveyed checks an RFQ | Not recommended |

The two features meet at one point. MRP v2 makes a confirmed order hold its supply: planned orders, Firm status, auto-firm. This is the role of SAP CTP planned orders and D365 `Keep supply for confirmed demand`. Order promising decides whether to confirm the date at all. Carbon can build order promising first. When MRP v2 ships, its planned orders become the way a confirmed promise holds capacity.

### Recommendations

1. **Add a delivery date check on the sales order line (the D365 `Delivery date control` pattern).** Run it when the user saves a line. Run it again when the quantity, the promised date or the location changes. Do not add it to the RFQ (pattern 1). Keep the quote lead-time simulation as the quote-stage check.
2. **Use a setting with 4 levels: `None`, `Lead time`, `ATP` and `CTP` (D365, Oracle).** Put the company default in Settings → Sales. Let the item override it. Make `None` the default, so that no current company sees a change.
3. **Make the lead time of the item the fence (SAP RLT, Oracle infinite fence, NetSuite ATP lead time).** If the promised date is after today + the lead time, skip the check. If the date is before it, run the check. This needs no setup. An optional fence in days can come later.
4. **Keep the new fence apart from `planningHorizonDays` and from the v2 `planningTimeFenceDays` (pattern 4).** The horizon is a view filter. The v2 fence is the APICS planning time fence. The new fence is the APICS demand time fence. Use the name "demand time fence" for it, and confirm the name with the owner of the MRP v2 spec.
5. **Warn and propose the earliest date. Do not block (pattern 5).** Show the reason (lead time, stock or capacity) and the earliest date on the line. Let the user accept the earliest date or keep the typed date. If the user keeps it, record that the user overrode the warning.
6. **Store the requested date apart from the promised date (SAP, D365, Oracle, NetSuite).** Carbon has a requested date only on the shipment header. A requested date on the line keeps the customer's wish after the check changes the promise. It also makes on-time delivery measurable.
7. **Calculate ATP as cumulative ATP (SAP, D365, NetSuite).** Free stock by date = nettable on-hand stock + open PO lines + open jobs − open sales order lines − open job material demand. Then change the quote lead-time simulation to read the same ATP, so that the quote and the order give one answer.
8. **Reuse the quote lead-time engine for CTP. Feed it the active make method of the item (SAP temporary planned order, Epicor unfirm job).** Do not hold capacity in the first version (Oracle check, D365 default `No`). Holding capacity comes with MRP v2 planned orders.
9. **Send the result to the right people (pattern 8).** Show the message on the line to the person who enters the order. Raise an event that workflows can use, so each company decides who else gets notified. Feed unconfirmed and overridden lines into the planner worklist, or into the v2 `PlanningExceptions` digest when it ships.
10. **Ship in this order: `Lead time`, then `ATP`, then `CTP`.** The lead-time level alone stops the worst case: a promise shorter than the lead time. It uses data that every item already has.

### Open questions for the spec

1. Must ATP use days or weeks? MRP buckets by week, but a promise needs a day.
   - **Resolved (2026-11-10): weeks.** ATP uses the same weekly periods as MRP, so the check and MRP give one answer.
2. What lead time applies to a make item that has no `itemReplenishment.leadTime`: the 7-day default, or the cumulative lead time through the BOM?
   - **Resolved (2026-11-10): the cumulative lead time through the BOM.** The fence of each item is its own lead time plus the longest lead time path through its components. Carbon does not calculate this value today. `itemReplenishment.leadTime` is one typed number.
3. Who may keep a date that fails the check? Is a reason required?
   - **Resolved (2026-11-10): no new permission.** A user who can edit the sales order can keep the date. The system records who kept it and when. The reason is optional. The system raises an event, so a company can add approval or alerts with a workflow.
4. Must the check run on lines that the quote conversion creates, or only on lines that a user types?
   - **Resolved (2026-11-10): yes, without a stop.** The conversion finishes as today. Then the check runs on each new line. A line that fails shows a flag on the sales order.
5. Must a confirmed line hold its stock before MRP v2 ships (an allocation, like NetSuite Supply Allocation), or is ATP subtraction enough?
   - **Resolved (2026-11-10): ATP subtraction is enough.** Use cumulative ATP with look-ahead (D365, NetSuite), so that a new order cannot take stock that a later order already has. The first version holds no capacity. A make-to-order job already holds capacity through the scheduler.

## Sources

### SAP
- https://help.sap.com/saphelp_470/helpdata/en/93/744bbe546011d1a7020000e829fd11/content.htm
- https://help.sap.com/saphelp_46c/helpdata/en/cb/7f97ce43b711d189410000e829fbbd/content.htm
- https://userapps.support.sap.com/sap/support/knowledge/en/3718297
- https://help.sap.com/SAPHelp_46c/helpdata/EN/93/744b97546011d1a7020000e829fd11/content.htm
- https://learning.sap.com/courses/exploring-aatp-in-sap-s-4hana/outlining-availability-check-in-detail
- https://help.sap.com/saphelp_46C/helpdata/EN/89/a42f85461e11d182b50000e829fbfe/content.htm
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d328744af11d182b40000e829fbfe/content.htm
- https://learning.sap.com/courses/performing-the-availability-check/acquiring-a-basic-understanding-of-available-to-promise-atp-_ae470c8e-1483-46ce-b5cc-e80647e8a32b
- https://learning.sap.com/courses/exploring-aatp-in-sap-s-4hana/getting-a-functional-overview-of-aatp
- https://learning.sap.com/courses/performing-the-availability-check/acquiring-a-basic-understanding-of-backorder-processing-bop-_c96b5fca-56b4-4c4d-8e5a-7c626c2bf034
- https://learning.sap.com/courses/functions-innovations-in-sap-s-4hana-sales/using-advanced-available-to-promise-aatp-in-sap-s-4hana_ef38afd2-4730-433f-854a-613b8e4afec5
- https://help.sap.com/saphelp_SCM700_ehp02/helpdata/en/12/42c95360267614e10000000a174cb4/content.htm
- https://implementconsultinggroup.com/article/exploring-aatp-supply-creation-based-confirmation
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f4/7d30a944af11d182b40000e829fbfe/content.htm
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d30b644af11d182b40000e829fbfe/content.htm
- https://help.sap.com/saphelp_470/helpdata/en/ae/20415a4f40d3119b440060b0671acc/content.htm
- https://learning.sap.com/courses/implementing-sap-s-4hana-cloud-public-edition-sales-automation-and-analytics/using-sales-order-fulfillment-monitoring-and-operations-bkk-_bc5cf72d-0812-4352-a6d6-e5a8e4fa6513

### Microsoft Dynamics 365
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/delivery-dates-available-promise-calculations
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/calculate-delivery-dates-using-ctp
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/delivery-alternatives
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/coverage-time-fence
- https://learn.microsoft.com/en-us/training/modules/set-up-order-cash-supply-chain-management/set-up-promising
- https://learn.microsoft.com/en-us/previous-versions/dynamicsax-2012/available-ship-and-receipt-dates-form
- https://learn.microsoft.com/en-us/previous-versions/dynamicsax-2012/appuser-itpro/set-up-delivery-date-control
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-plans
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/planned-order-firming
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/not-used-parameters
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/keep-supply-for-confirmed-demand
- https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-to-calculate-order-promising-dates
- https://learn.microsoft.com/en-us/dynamics365/business-central/sales-date-calculation-for-sales
- https://learn.microsoft.com/en-us/dynamics365/business-central/sales-setup-show-stockout-warning
- https://learn.microsoft.com/en-us/previous-versions/dynamics-nav-2013-r2/hh169453(v=nav.71)
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-planning-parameters
- https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-how-availability-overview

### Oracle NetSuite and Oracle Fusion GOP
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2301636.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2300611.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2302738.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_163052274836.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0929025924.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159250317916.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156556825274.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156433189079.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156518739289.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159172238892.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_3848149573.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fauom/schedule-fulfillment-lines-manually.html
- https://docs.oracle.com/en/cloud/saas/readiness/scm/25a/order25a/25A-order-mgmt-wn-f35211.htm
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/fascp/atp-rule-promising-modes.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fascp/promising-attributes-for-supply-chain-availability-searches.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/fascp/how-atp-rule-precedence-is-determined.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/fascp/infinite-availability-time-fence.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24b/faims/how-you-configure-global-order-promising-to-support-back-to-back.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/fascp/determine-how-order-promising-gets-and-estimates-availability.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fascp/manage-supply-after-the-promising-horizon-expires.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fascp/how-availability-options-are-determined.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/fascp/fulfillment-line-splits-and-substitutions.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fascp/how-availability-results-are-determined.html

### Epicor, Odoo, JobBOSS²
- https://encompass-inc.com/wp-content/uploads/2020/11/Epicor-ERP-9-to-10.2-Feature-Highlights-Guide-ENS.pdf
- https://tomerlin-erp.com/wp-content/uploads/2018/11/Epicor10_FeatureSummary_102300.pdf
- https://tomerlin-erp.com/wp-content/uploads/2018/08/Epicor-Planning-and-Scheduling.pdf
- https://www.epiusers.help/t/automate-ctp/98073
- https://www.epiusers.help/t/does-ctp-consider-unfirm-mrp-jobs-as-demand-for-components/78446
- https://www.epiusers.help/t/new-2024-1-feature-promise-date-progress-report/108806
- https://www.epiusers.help/t/getting-change-suggestions-instead-of-new-suggestions/54306
- https://www.epiusers.help/t/accurate-requirement-dates-planning-fence-mrp-challenge/117123
- https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/lead_times.html
- https://github.com/odoo/odoo/blob/17.0/addons/sale_stock/static/src/widgets/qty_at_date_widget.js
- https://github.com/odoo/odoo/blob/17.0/addons/sale_stock/models/sale_order.py
- https://ecisolutions.com/en-au/products/jobboss2/features/quotes
- https://www.ecisolutions.com/products/jobboss2/features/scheduling/
- https://ideas.jobboss.com/ideas/JBCORE-I-1365
- https://ideas.jobboss.com/ideas/JBCORE-I-1914/related_ideas

### APICS / ASCM
- https://learningsystem.ascm.org/wp-content/uploads/2018/11/APICS_CPIM_2019_Excerpt.pdf
- https://www.vskills.in/certification/tutorial/time-fences/
- https://docs.ifs.com/ifsclouddocs/26r1/lang/en/MasterScheduling/AboutTimeFenceDemandAndPlanning.htm
- https://docs.oracle.com/cd/E18727_01/doc.121/e15188/T478564T479135.htm
- https://open-exam-prep.com/study-guides/cpim/master-scheduling/using-maintaining-mps

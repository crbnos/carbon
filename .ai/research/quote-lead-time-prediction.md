# Quote Lead Time Prediction (Capable-to-Promise) Research: Best Practices Survey

## Summary

Surveyed how SAP (ATP, MATP, CTP/SBC), Oracle Global Order Promising, Microsoft D365 SCM and Business Central, job-shop ERPs (Epicor Kinetic, Infor SyteLine and VISUAL, JobBOSS², ProShop, Cetec), Odoo, and modern quoting tools (Fulcrum, MRPeasy, Katana, Paperless Parts, Xometry, Protolabs) compute a promised lead time for a make-to-order line. Three tiers exist: **policy lead time** (a typed days value, optionally with priced expedite tiers — Odoo, Paperless Parts, marketplaces); **material-driven ATP** (stock plus replenishment/BOM lead time, infinite capacity — SAP classic ATP and MATP, Oracle lead-time mode, BC CTP, D365 ATP); and **capacity-driven CTP** (a temporary order is exploded and finitely scheduled into the live plan and the earliest feasible finish returned — SAP CTP/SBC, Oracle Make-CTP, D365 CTP, Epicor, SyteLine, Fulcrum, ProShop). Every CTP product runs it on **sales orders**; only SyteLine, VISUAL and Cetec expose it on a quote/estimate line, and then as a date only. No vendor holds capacity for a quote. Lead time is universally counted in **working days to ship**, with pick/pack/transit added separately, and purchased-material lead time and capacity are two constraints of which the later wins.

## Competitors Surveyed

- **SAP S/4HANA / APO** — the reference: classic ATP with replenishment-lead-time fallback, MATP, finite CTP/SBC, backward-then-forward delivery scheduling.
- **Oracle Fusion GOP / EBS ASCP** — three promising modes; Make-CTP with resource capacity; non-committal Check Availability vs committing Schedule.
- **Microsoft D365 SCM / Business Central** — the delivery-date-control ladder; BC's what-if CTP with accept-to-reserve.
- **Epicor Kinetic, Infor SyteLine/VISUAL, JobBOSS², ProShop, Cetec** — job-shop CTP as a temp-job simulation the estimator accepts.
- **Odoo 17** — pure lead-time policy; the counter-example.
- **Fulcrum, MRPeasy, Katana, Paperless Parts, Xometry, Protolabs** — one-click finite simulation vs customer-selected expedite tiers.

## Key Consensus Patterns

### 1. A ladder of promising modes, chosen per item and per line
- **D365**: `Delivery date control` = None / Sales lead time / ATP / ATP + Issue margin / CTP / Batch CTP — global default, per-product override, per-line override. "At a minimum, CTP offsets delivery dates to the sales lead time."
- **Oracle**: ATP-rule promising mode = Infinite / Lead time based / Supply chain availability search, plus a "Search components and resources" flag that turns on Make-CTP.
- **SAP**: classic ATP (stock + receipts inside the replenishment lead time; beyond RLT everything is assumed available) → MATP → CTP.
- **Rationale**: CTP is slow ("the CTP calculation isn't as fast as the ATP calculation") and only pays off for make/assemble-to-order items.

### 2. CTP = explode a temporary order and finitely schedule it into the live plan
- **SAP**: "Temporary planned orders are created … Capacities are then taken into account. A feasible availability date is determined in PP/DS from the result of scheduling these planned orders." PP/DS modes: *find slot* (first gap in the planning direction), *insert*, *squeeze in*, *infinite*.
- **D365**: "CTP functionality is based on the explosion function" — BOM + route through the dynamic plan, finite capacity inside the capacity time fence, purchase lead times, transport days, safety margins.
- **Epicor**: `CalculateCTP` builds an unfirm job and rough-cut finite-schedules it, honouring production buffers, queue/move, Receive Time, planning time fence and constrained-material lead times; "runs against the actual schedule and drops in the operations where it can and then returns a date."
- **SyteLine**: Get ATP/CTP inserts the demand "into a temporary copy of the APS plan" at the due date; finite APS gives a "worst case … against an already loaded schedule."
- **Fulcrum**: "simulates when a job would get finished if scheduled at that moment … based on the priority level of the job."

### 3. Backward from the requested date; forward from today when infeasible
- **SAP SD**: requested delivery − transit − loading − transportation lead time − pick/pack = material availability date; if that is in the past or unconfirmable, forward-schedule from the earliest ATP date and re-add the four times, each rounded on its own factory calendar.
- **BC**: "requested delivery date − shipping time = planned shipment date; − outbound whse. handling time = shipment date"; if unavailable, calculate forward and write the earliest `Shipment Date`.
- **D365**: the `Available ship and receipt dates` dialog pops when the requested date cannot be met and the user picks.
- **Rationale**: "can we hit this date?" and "earliest feasible date" are one engine run in two directions.

### 4. Requested vs confirmed; the system writes the confirmed date, the user may only loosen it
- **SAP**: confirmed schedule lines; the user may push the date later or reduce quantity, never earlier or larger.
- **Oracle**: Requested vs Scheduled (GOP output) vs Promised (tracking) dates; EBS `Promise Date` modes include "First Schedule Date" (frozen) and "Dependent on Schedule Date" (recomputed).
- **D365**: `Confirmed ship/receipt date` set on every save of a CTP line, but re-promised **only when the existing promise can no longer be met** — a smaller quantity keeps the original date.
- **SyteLine**: Projected date is recomputed every APS run; the due date is never overwritten; a Late Alert compares the two.

### 5. Temporary supply becomes real only on save/accept; quotes never hold capacity
- **SAP**: CTP temporary orders "exist only in the check session; converted to permanent on save, deleted otherwise." Quotation schedule line BN "No MRP" transfers nothing; BP does, and the valid-to date does **not** release it — a known trap.
- **BC**: accepting CTP dates creates "a planning line and a reservation entry"; declining leaves nothing.
- **D365**: CTP writes planned orders and capacity reservations, but plan runs historically replanned them — hence "Keep supply for confirmed demand" (10.0.48) and "Protect confirmed CTP dates" (GA Sep 2026). "Delivery date control method is not supported for a sales quotation line."
- **Epicor**: `ConfirmCTP` firms the job; cancel discards it; "quotes are not associated with a job." **SyteLine**: an accepted CO line is incrementally planned, but "estimate lines are not incrementally planned." **Oracle EBS**: scheduling level "ATP Only" for inquiry-type transactions.
- **Rationale**: quote win rates are well below 100 %; holding capacity per quote starves real orders. Quote expiry is cosmetic everywhere (Odoo: a ribbon; Hubs: price "valid for 30 days").

### 6. Material lead time and capacity are separate constraints; the later wins
- **SAP MATP**: each component checks against its own rule (a bought part with no stock confirms at the end of its RLT); the header is forward-scheduled from the latest component date.
- **Oracle**: Buy-CTP applies supplier lead times as a hard constraint; Make-CTP checks resources; the promise is the max.
- **Odoo 17**: `days_to_prepare_mo` = Compute → "the longest lead time among all the components listed on the BoM."
- **Cetec** / **VISUAL** / **Fulcrum**: material availability gates operation start inside the finite engine.

### 7. Working days, calendars, and a post-production buffer
- **SAP**: scheduling-margin-key floats (before/after production, opening period) in workdays; safety time in working days.
- **D365**: receipt / issue / reorder margins on working-day calendars; issue margin = ship-prep buffer; transport days by mode of delivery.
- **BC**: `Offset (Time)` + inbound/outbound warehouse handling + shipping time. **Oracle**: a non-business-day result moves to the previous working day.
- **Odoo**: the outlier — "lead times are based on calendar days … do not consider weekends, holidays, or work center capacity."
- **Protolabs / Xometry**: lead times in business days **to ship**; shipping assumed separately (1-day expedite / 2-day standard).

### 8. Expedite is a priority, priced as tiers
- **Paperless Parts**: standard lead time plus "Days Faster" options each with a % markup, "expressed as relative days and percentage markup"; the customer picks; leaving standard blank gives each quantity break its own lead time.
- **Xometry**: Economy / Standard / Expedited — "expedited orders receive prioritization in all aspects of order fulfillment." **SyteLine**: Expedited Fixed/Variable lead times feed Get CTP.
- **SAP / Oracle / D365**: no named expedite mode; forward scheduling from today *is* the fastest date, and priority reallocation happens later (aATP backorder processing).

## Answers to Research Questions

1. **Inputs** — Routing standard times via work-center formulas (SAP, D365, Epicor, SyteLine, Fulcrum); the live finite load (all CTP products); component supply and supplier lead time (SAP MATP/RLT, Oracle Buy-CTP, Odoo `days_to_prepare_mo`, Epicor, Cetec); factory/shift calendars (all but Odoo); buffers (SAP floats + safety time, D365 margins, Odoo security leads, BC handling times, Epicor production buffers); a policy floor (D365 sales lead time, SAP RLT with no explosion, Protolabs per-process standard, SyteLine Fixed + Variable + Paperwork + Dock-to-Stock).
2. **Modes** — Infinite (SAP classic ATP, Oracle Infinite/Lead-time, D365 Sales lead time/ATP, SyteLine infinite APS); finite earliest feasible (SAP CTP, Oracle supply-chain search + resources, D365 CTP, Epicor, SyteLine finite, Fulcrum, Cetec); "can we hit this date" (SAP backward scheduling, BC backward verify, D365 dialog on miss, SyteLine check-mark if projected ≤ due, ProShop phantom order); best case (job priority in Fulcrum; priced tiers in Paperless Parts/Xometry/Protolabs; Cetec conservative/optimistic; no ERP names a first-in-queue mode).
3. **Surfacing** — A system-written confirmed/projected date beside the requested one, accepted or loosened (SAP, Oracle, D365, BC, SyteLine); a suggestion the estimator types over (MRPeasy "Estimate costs and dates", Katana auto deadline, Odoo read-only `expected_date` + editable `commitment_date`, Epicor's manual quote Lead Time field). Per quantity break only in Paperless Parts; Protolabs gives "the same quoted lead time" regardless of quantity. Recompute: D365 only when infeasible; SyteLine every APS run (reference only); Oracle frozen or live by mode; the rest on demand.
4. **Quote-time reservation** — None. Temporary supply materialises on order save/accept (SAP, BC, D365, Oracle Schedule, Epicor `ConfirmCTP`, SyteLine CO line). SyteLine and Cetec answer on an estimate line but plan nothing; VISUAL loads quotes only as explicit what-if orders. Expiry releases nothing anywhere, and SAP BP quotes are a cautionary tale.
5. **Materials vs capacity, rounding, shipping** — Promise = max(material date, capacity date), header forward-scheduled from the later (SAP MATP two-step, Oracle, Epicor). Working-day rounding on the factory/shift calendar (SAP, D365, BC, Oracle, SyteLine M-days); Odoo is calendar-day. Ship vs delivery separated by pick/pack + loading + transit (SAP), outbound handling + shipping time (BC), issue margin + transport days (D365); marketplaces quote days to ship.

## Competitor-Specific Details

**SAP** — Classic ATP never reads routing. MATP stores an "ATP tree", not a receipt. CTP is incompatible with safety stock, period lot sizes and backorder processing. S/4HANA SBC (2022+, aATP + ePP/DS licences) recreates supply on every MTO recheck.

**Oracle** — Infinite-availability time fence (beyond it, promise on request date) and ATP time fence (inside it, search existing supply before CTP). Resource need = qty × usage / (yield × efficiency × utilization). Fusion 25D pulls scheduled dates earlier when supply arrives early, gated by an `Override Schedule` flag.

**Microsoft** — D365 "Near real-time CTP" (10.0.41+) computes in the background per line save; "Batch CTP" every N minutes with a Not ready/Ready status. BC CTP applies only to the uncovered remainder ("10 ordered, 6 available → CTP on 4") and requires the item flagged `Critical`.

**Job shops** — SyteLine: lead-time start = due − FLT − int(VLT × qty / hrs per day + .499). VISUAL: the one scheduler that natively loads "planned orders and quotes." JobBOSS²: "auto-default the promise date to lead times" is still a user idea. ProShop: lead time typed; capacity checked by phantom job placement. Cetec Build Estimate: start + ship date from on-hand, component lead times and labour, view-only.

**Odoo** — `expected_date = date_order + customer_lead`, nothing else; MO/PO dates back-schedule from it; the MO Plan button forward-schedules work orders on work-center calendars but never moves the SO date.

## Recommended Approach for Carbon

Carbon already has the hard part: a forward-ASAP finite scheduler over `capacityReservation` (`packages/planning/src/scheduling/run-schedule.ts`; `runExpediteWhatIf` with `persist:false` returning `{ projectedCompletionAt, cause }`), `quoteOperation` rows carrying setup/labor/machine times and work centers column-for-column with `jobOperation`, `itemReplenishment.leadTime` for purchased parts, and an unused `capacityReservation.scenarioId`. What is missing is the glue.

1. **A mode ladder per line, not a replacement (D365).** Keep the typed `quoteLinePrice.leadTime` as the policy mode and add a computed suggestion beside it, floored at an item/company minimum lead time.
2. **CTP = a what-if run of the existing engine seeded from `quoteOperation`, not a job (SAP temporary planned order; SyteLine "temporary copy of the plan"; Fulcrum).** Generalise `runExpediteWhatIf` to take a synthetic operation set (quote make method × quantity) placed at end of queue over the live reservation snapshot, `persist:false`. Return `{ promiseDate, confidence, cause }` — the `getJobPromiseDate` contract already exists with no caller.
3. **Two modes from one engine.** *Earliest feasible* = end of queue; *best case* = the synthetic job ordered first (what the expedite what-if already does). "Can we hit this date?" = feasible ≤ requested, reporting `cause` (bottleneck work center vs material) — no surveyed vendor computes "what would have to move" for a quote, and neither should Carbon in v1.
4. **Material-driven floor (SAP MATP; Odoo `days_to_prepare_mo`).** Take max over `quoteMaterial` Buy lines of `itemReplenishment.leadTime` net of on-hand at the quote location, start the synthetic operations no earlier than that, and say which constraint won.
5. **Per quantity break, on demand, frozen (Paperless Parts; Oracle "First Schedule Date").** Run per pricing-grid row when the estimator asks, write the accepted value into `leadTime`, and record `leadTimeSource: 'system' | 'manual'` next to the existing `priceSource`. Never auto-recompute a sent quote; on reopen offer "recalculate" with the delta.
6. **No quote-time reservation.** Unanimous. Do not write `scenarioId` rows for quotes; a soft booking, if ever wanted, is a sales-order feature (D365 "Keep supply for confirmed demand").
7. **Working days plus a ship buffer.** Convert the engine's completion timestamp to whole business days on the location shifts (`need-by-calculator.ts` `workingDayTest`), add a location `shippingBufferDays` (D365 issue margin; BC outbound handling), and fix `convert/index.ts`, which sets `promisedDate = now + leadTime × 86 400 000` on calendar days. Prior art: `quoteShipment.leadTime` (migration `20260206061346`) was reverted three days later — the quote header was the wrong grain; the per-quantity-break line is right.

## Sources

- https://help.sap.com/doc/saphelp_scm700_ehp02/7.0.2/en-US/4c/56297de7c33a0de10000000a42189c/content.htm?no_cache=true
- https://help.sap.com/saphelp_SCM700_ehp01/helpdata/en/a9/27c95360267614e10000000a174cb4/content.htm?no_cache=true
- https://help.sap.com/saphelp_SCM700_ehp02/helpdata/en/4c/4e5b37eb096ad8e10000000a42189c/content.htm?no_cache=true
- https://help.sap.com/saphelp_SCM700_ehp02/helpdata/en/f0/40c95360267614e10000000a174cb4/content.htm?no_cache=true
- https://help.sap.com/doc/saphelp_snc70/7.0/en-US/21/7acc37d2fee941e10000009b38f8cf/content.htm?no_cache=true
- https://help.freedsap.com/ENHELPhtml/PPMRP/AvailabilityCheckWithorWithoutRe.html
- https://learning.sap.com/courses/exploring-aatp-in-sap-s-4hana/outlining-supply-based-confirmation-sbc-
- https://learning.sap.com/courses/exploring-advanced-production-planning-with-sap-s-4hana-pp-ds/exploring-concepts-and-principles-of-detailed-scheduling
- https://blog.sap-press.com/delivery-scheduling-and-transportation-scheduling-in-sap-s4hana
- https://blog.sap-press.com/atp-checks-in-s4hana-sales
- https://www.stechies.com/where-the-schedule-margin-key-is-customized/
- https://community.sap.com/t5/enterprise-resource-planning-q-a/atp-at-quotation/qaq-p/8699789
- https://community.sap.com/t5/enterprise-resource-planning-q-a/quotation-appearing-on-md04-list-instead-of-sales-order/qaq-p/7654130
- https://thesdvault.com/sap-advanced-atp-s4hana
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24c/fascp/atp-rule-promising-modes.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-management/21d/fascp/order-promising-rules.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fascp/check-availability.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/faiom/set-promised-ship-and-arrival-dates-on-fulfillment-lines.html
- https://docs.oracle.com/cd/E18727_01/doc.121/e13378/T474179T474185.htm
- https://docs.oracle.com/cd/E18727_01/doc.121/e13406/T373258T377249.htm
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/calculate-delivery-dates-using-ctp
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/delivery-dates-available-promise-calculations
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/delivery-alternatives
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/safety-margins
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/keep-supply-for-confirmed-demand
- https://learn.microsoft.com/en-us/dynamics365/release-plan/2026wave1/enterprise-resource-planning/dynamics365-supply-chain-management/protect-confirmed-ctp-dates-planning-optimization
- https://community.dynamics.com/forums/thread/details/?threadid=a72157a6-6faa-4dda-bc77-d071835535d1
- https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-to-calculate-order-promising-dates
- https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-date-calculation-for-purchases
- https://probitas.co.uk/2022/01/14/available-and-capable-to-promise-in-business-central-part-two/
- https://www.epiusers.help/t/capable-to-promise/89981
- https://www.epiusers.help/t/quote-entry-lead-time-field/48890
- https://www.epiusers.help/t/promise-dates-vs-running-balance-vs-aps-ctp/104057
- https://www.epiusers.help/t/dating-orders-dare-i-open-the-ctp-can-of-worms/125533
- https://erp.smcusa.com/SyteLine/Language/en-US/mergedProjects/sl_invprod/buttons/g/get_atp_ctp_button.htm
- https://docs.infor.com/csi/2026.x/en-us/csbiolh/inventory_user_cl_sl/mergedprojects/sl_invprod/forms/system/availability_results.html
- https://docs.infor.com/csi/9.01.x/en-us/csbiolh/mergedprojects/sl_invprod/fields/p/projected_order_line_maintenance.htm
- https://wm-synergy.com/products/infor-visual-erp-scheduling/
- https://www.ecisolutions.com/products/jobboss2/features/scheduling/
- https://proshoperp.com/product/estimating-quoting/
- https://proshoperp.com/blog/better-shop-floor-scheduling/
- https://cetecerp.com/blog/using-cetec-erp-build-estimates-for-accurate-quotes-and-delivery-dates/
- https://fulcrumpro.com/manufacturing-software/quoting-software-for-manufacturing
- https://fulcrumpro.com/workflows/cnc-machine-shop
- https://www.mrpeasy.com/resources/user-manual/crm/customer-orders/details/
- https://support.katanamrp.com/en/articles/5914341-how-to-manage-production-deadlines
- https://support.katanamrp.com/en/articles/5914243-managing-quotes
- https://help.paperlessparts.com/s/article/dynamic-lead-times-guide
- https://www.paperlessparts.com/blog/can-we-get-the-parts-sooner-sure/
- https://www.xometry.com/resources/blog/lead-time-options/
- https://www.protolabs.com/help-center/lead-times/
- https://www.hubs.com/help-center/how-to-get-a-quote/
- https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/lead_times.html
- https://raw.githubusercontent.com/odoo/odoo/17.0/addons/sale/models/sale_order_line.py
- https://raw.githubusercontent.com/odoo/odoo/17.0/addons/mrp/models/mrp_bom.py
- https://www.odoo.com/forum/help-1/how-to-deal-with-maximum-manufacturing-capacity-per-day-when-planning-203797

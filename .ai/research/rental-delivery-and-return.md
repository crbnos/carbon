# Rental Delivery and Return Research: Best Practices Survey

> Date: 2026-10-07
> Prepared for: the rental delivery and return documents (branch `rental-shipment-receipt`). This builds on `.ai/research/2026-09-21-sell-vs-rent-rental-revenue-recognition.md`, which covers the accounting of a rental fleet.
> Method: web survey of vendor help sites and community threads. SAP Community pages refused direct fetch (HTTP 403), so the SAP claims come from search-result extracts of those threads. The file marks these claims **search-synthesized**.

## Summary

This survey asks how rental systems record the physical delivery (check-out) and the physical return (check-in) of serialized rental units against a rental contract. Most products surveyed use a separate logistics document for each trip. The document links to the contract and can carry units from one contract or from several. The delivery document names the units that go. The return document names the units that come back, so a partial return is normal. Every dedicated rental system splits the return into two events. The **off-rent date** stops billing. The **physical return** happens later, at the yard. Check-in captures a meter reading, condition, photos, a damage code and a signature per unit. A returned unit does not become available at once. It goes through an inspection, and the inspection can raise damage charges and a repair order. When the unit is company-owned equipment, the delivery and the return change custody and location only. No product surveyed posts a GL entry for the move itself. A return to another branch updates the unit's location. One product also splits the rental revenue between the two branches.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference. SD rental contracts (document type MV) bill from a billing plan. Physical moves use outbound deliveries with special-stock movement types and serial-number statuses.
- **SAP partner add-on FIT-Rent** — shows how a rental vertical builds on SAP outbound and inbound deliveries.
- **NetSuite (rental SuiteApps: RentalSeries, Luxent Rental & Lease, SuiteWorks)** — NetSuite has no native rental module. SuiteApps build rental on sales orders, item fulfillments, item receipts and return authorizations.
- **Microsoft Dynamics 365 F&SCM with STAEDEAN Rental Management (formerly DynaRent)** — the most complete documented ERP rental add-on. Its help site documents each step of delivery and return.
- **Texada (SRM, Rental Management "Next", Texada Mobile)** — dedicated equipment-rental system with delivery tickets, pickup tickets and mobile check-in.
- **Wynne Systems RentalMan** — dedicated equipment-rental ERP for large rental companies. It has pickup tickets, full and partial returns, and branch transfers.
- **Point of Rental (Essentials and the 2020 desktop help)** — counter-based rental system for general and party rental stores.
- **HirePOS** (UK "hire" terminology) and **Odoo Rental** — secondary checks for the off-hire split and for a general ERP's pickup and return buttons.

## Key Consensus Patterns

### 1. Delivery and return are separate documents linked to the contract

- **SAP**: The rental contract (VA41, type MV, item category MVN) holds the terms and the billing plan. The physical move is an outbound delivery. The delivery uses consignment fill-up (movement type 631) or returnable packaging issue (621). The return uses consignment pick-up (632), returnable packaging pick-up (622), or a customer return with an inbound delivery. **Search-synthesized.**
- **FIT-Rent (on SAP)**: A swap "automatically creates inbound delivery (for return equipment) and outbound delivery (for sent equipment)". The contract stays valid for the swapped unit.
- **STAEDEAN (D365)**: The user posts a **packing slip** from the rental order to deliver. The user posts a **return note** from the rental order (Post-rental → Return note) to return. The mobile app also generates the return note when the driver closes the collection task.
- **NetSuite (RentalSeries)**: "Quick Ship" creates **Delivery Orders** and their item fulfillments to move units to the customer location. "Quick Return" creates **Pickup Orders** and an item fulfillment plus an item receipt. These move the units from the customer location to the company's inspection location.
- **Texada**: A **Delivery ticket** moves assets from inventory to the customer site. A **Pickup ticket** moves them back. A **Task ticket** moves assets between locations. Each ticket links to a parent contract.
- **Wynne RentalMan**: The rental contract records delivery or customer pickup, with the driver, the carrier and the charges. A **Pickup Ticket** requests collection from the job site. **Full Return**, **Partial Return** and **Consolidated Return** record the check-in.
- **Point of Rental** (the exception): It has no separate document. The contract line status changes from Out to Returned when the user closes the item.
- **Rationale**: One contract can run for months and see many trips. A separate document per trip gives each trip its own date, driver, signature and printout. The contract keeps the terms.

### 2. One document carries many units, and the user picks which units go or come back

- **STAEDEAN**: A serialized rental line holds quantity 1 with one assigned business object. Post packing slip asks for the quantity to post. The return flow branches into "Full return" and "Partial return".
- **Texada**: One ticket can hold several assets "from the same Contract". Mobile check-in can process "Products for multiple different Contracts, at the same time".
- **Wynne**: A Consolidated Pickup Ticket covers several contracts for one customer and job. Partial Return selects "the quantities of equipment returned".
- **Point of Rental**: Partial Return splits the line. The returned quantity moves to a new line, and the original line keeps the rest.
- **SAP**: The outbound delivery assigns serial numbers per item. **Search-synthesized.**
- **Rationale**: Units come back on different days. The line per unit, not the document, holds the on-rent and off-rent state.

### 3. The return has two dates: off-rent (billing stops) and physical return (unit arrives)

- **Wynne**: A pickup ticket "stops further billing for all of the rental contracts on the ticket". After the return, billing resumes "for any items on the pickup ticket that were not returned".
- **Point of Rental**: **Called Off Rent** "stop[s] the rental time but doesn't close out the contract or the item". The user closes the item later, when it is back at the store.
- **Texada**: The Off Rent status means "billing for an Asset has been paused" and earns no revenue. A pickup ticket has a Requested and an Actual date and time.
- **STAEDEAN**: The user enters the **Off-rent date** on the rental order line, or on the header for all lines. Then the user plans a collection task.
- **HirePOS**: "Billing stops as of the Off-Hire date, even though the equipment remains with the customer". The collection date and the return date come later.
- **Rationale**: The customer stops paying when it releases the unit, not when the truck arrives. The yard records the arrival separately.

### 4. Check-out and check-in capture per-unit evidence

| Captured | Who captures it |
|---|---|
| Actual date and time | Wynne (return date and time; warns if before the billed-through date), Texada (Actual Date/Time) |
| Meter reading | Point of Rental (asks for the meter reading when a metered item changes status), Texada (Confirm Meter Reading when a metered product goes on a contract), STAEDEAN (business object meters) |
| Fuel | STAEDEAN (fuel tanks per business object, fuel transactions on the rental order), Point of Rental (standard fuel charge per item) |
| Condition, inspection checklist | Texada (inspection forms per product group), STAEDEAN (quality check task per product), FIT-Rent (model and checklist inspection) |
| Photos, damage code | Texada ("Damaged" check box reveals photos and a damage code), STAEDEAN (notes and pictures on the collection task) |
| Customer signature | Texada (check-in and check-out), Odoo (Sign before pickup) |
| Driver, carrier, charges | Wynne (driver name, carrier code, delivery and pickup charges), Texada (driver on the ticket) |

### 5. Moving a company-owned unit changes custody, not the ledger

- **SAP**: Consignment fill-up (631) moves stock to customer special stock W with no accounting document. Pick-up (632) moves it back, again with no accounting document. Returnable packaging (621/622) updates quantity only. After goods issue, the serial number status changes from ESTO (in the warehouse) to ECUS (at the customer). EDEL marks a serial number on an open delivery. **Search-synthesized.**
- **STAEDEAN**: Purchased rental units become fixed assets ("Auto convert asset purchases"). The packing slip and the return update inventory quantities and the business object status: Assigned → On-rent → Off-rent → Rental-ready.
- **NetSuite (RentalSeries)**: The item fulfillment and the item receipt move units between company locations: stock, customer location, inspection location.
- **Point of Rental and Texada**: The contract and the tickets change the item status. They do not post a stock movement.
- **Rationale**: The company still owns the unit, and the unit is on the books as a fixed asset or as rental stock. Only the custodian and the place change. Revenue and depreciation follow other documents.

### 6. A returned unit goes through inspection before it is available again

- **STAEDEAN**: After collection, the user plans a **Quality check** task for each product. A failed check leads to an inspection list and a repair work order. The asset statuses include Off-rent, Maintenance and Rental-ready.
- **NetSuite (RentalSeries)**: The return lands in the inspection location and "automatically create[s] inspection orders". Versich: "assets should not move to available inventory immediately upon receipt".
- **HirePOS**: With "Auto-create post-hire inspections" or "Lag Time" on, the unit stays unavailable until the inspection completes.
- **Texada**: An item returned to the yard but not yet closed on the contract shows status "O", not "F" (off rent).
- **Damage charges**: FIT-Rent bills "customer damages" and "late returns" as extra charges. Versich uses the inspection record "to add damage or cleaning charges". Texada records a damage code at check-in.
- **Rationale**: The next customer must get a safe, complete unit. The inspection is also the evidence for a damage charge.

### 7. Delivery starts billing and the off-rent date stops it in rental systems, but not in SAP standard

- **STAEDEAN**: Each line carries an **On-rent date** and an **Expected off-rent date** from the header. The off-rent date ends the rental.
- **Versich (NetSuite)**: "A billing process might use the dispatch date as the start event, the actual return date as the end event".
- **Wynne, Point of Rental, HirePOS**: The pickup ticket, the call-off or the off-hire date stops billing.
- **SAP standard SD**: The billing plan runs from the contract's start and end dates, not from the delivery (SAPinsider). Rental add-ons on SAP add the delivery link.
- **Rationale**: A customer pays for the time it has the unit. Billing from the contract start charges for days before delivery.

## Answers to Research Questions

1. **Is delivery or return a separate document? What is it called?** — Yes, in every product except Point of Rental. Point of Rental changes the contract line status directly. The names:
   - SAP: outbound delivery; returns delivery or pick-up
   - STAEDEAN: packing slip; return note
   - NetSuite RentalSeries: delivery order with item fulfillment; pickup order with item receipt
   - Texada and Wynne: delivery ticket; pickup ticket
   - Odoo: pickup receipt; return receipt
2. **One document per contract or per unit? Partial deliveries and returns?** — One document per trip, holding many units. The user selects the units. A partial return is a standard function (STAEDEAN, Wynne, Point of Rental, FIT-Rent). Texada and Wynne also let one ticket or one return cover several contracts.
3. **What is captured?** — See the table in pattern 4. Backdating: Point of Rental requires a Store Manager password for a call-off date before today. Wynne warns when the return date is before the last billed-through date, and the user decides on a credit.
4. **Inventory or GL entries for a capitalized unit? Custody tracking?** — No GL entry for the move in any product surveyed. SAP moves the unit to customer special stock with no accounting document and sets the serial status ECUS. STAEDEAN updates the business object status. NetSuite SuiteApps move the unit to a customer location. Texada keeps Division and Location on the asset.
5. **Return to a different branch?** — Point of Rental asks the counter user to transfer the unit to the receiving store. Its current location then changes to that store. Texada credits a **Cross-Store Check-In Account** with the part of the rental revenue that goes to the return division. STAEDEAN changes the business object's depot with a depot start date. Wynne has inventory transfer programs; this survey found no documented cross-branch return step for Wynne.
6. **Inspection before availability? Damage charges?** — Yes. STAEDEAN, NetSuite RentalSeries, HirePOS and FIT-Rent all put an inspection between return and availability. Damage findings become extra charges on the contract (FIT-Rent, Versich) or a repair work order (STAEDEAN).
7. **Delivery date starts billing, return date stops it?** — Yes in STAEDEAN, the NetSuite SuiteApps, Wynne, Point of Rental and HirePOS. The stop event is the off-rent date, which can come before the physical return. SAP standard SD bills from the contract dates instead.

## Competitor-Specific Details

### SAP S/4HANA
- Rental contract: VA41, document type MV, item category MVN, periodic billing plan run by V.07 / RVFPLA01. The billing plan uses the contract's start and end dates.
- Physical move without a rental add-on: consignment fill-up 631 / pick-up 632 (special stock W), or returnable packaging 621 / 622 (special stock V). Neither posts an accounting document. **Search-synthesized.**
- Serial number statuses: ESTO (in the warehouse), EDEL (on a delivery), ECUS (at the customer). **Search-synthesized.**
- S/4HANA Public Cloud practice: receive a rented unit back as a customer return with no refund, through an inbound delivery and a goods receipt. **Search-synthesized.**

### FIT-Rent (SAP add-on)
- Delivery planning board, in-transit monitoring, optional IoT tracking.
- Partial or full return, checklist inspection per model, swap with an automatic inbound and outbound delivery.
- Billing adds charges for "late returns, customer damages, over-usage".

### NetSuite rental SuiteApps
- Luxent: "A single sales order drives the entire rental lifecycle: fulfillment, return authorization, and recurring monthly invoicing". It creates the return authorization on fulfillment.
- RentalSeries: Delivery Orders, Pickup Orders, an Inspection Location, inspection orders on return, and asset records created from item transactions.

### STAEDEAN Rental Management (D365)
- Business object = one serialized unit. A serialized line holds quantity 1.
- Flow:
  1. Confirm the rental order.
  2. Post the packing slip.
  3. Change the off-rent date.
  4. Plan the collection task.
  5. Collect the unit (notes, pictures).
  6. Close the collection task. This generates the return note.
  7. Do the quality check.
  8. If the check fails, create a repair work order.
- Technical exchange: the user sets the off-rent date and time and the requested pickup date and time. The replacement unit must be the same item.
- Depot: "a business location used to receive and distribute business objects". "Change depot" sets a new depot and a depot start date.

### Texada
- Ticket types: Delivery, Pickup, Task. A ticket prefills from its parent contract.
- 2019 field names: delivery ticket "Deliver By", "Drop Off Date/Time", "Date/Time On"; pickup ticket "Requested Date/Time", "Actual Date/Time", "Close Date/Time".
- Pickup and Delivery inspection form types, with inspector name, signature and date.
- Cross-Store Check-In Account per rental class.

### Wynne RentalMan
- Return launch screen: customer, contract, equipment, pickup ticket, return date, return time, credit days, credit hours.
- The user must set the actual return date and time before searching. Otherwise the program uses the current system date and time.

### Point of Rental
- Line statuses: Reserved, Out, Hold (rental time stopped), Returned, Sold Asset.
- Close options:
  - Close All Items
  - Partial Return
  - Called Off Rent
  - Line Item Billing: bills the returned lines and moves the open lines to a new contract
  - Site Transfer: calls the units off rent at one site and opens a delivery to the new site

## Recommended Approach for Carbon

Carbon context: `rentalAgreementLine` already holds one fleet unit (quantity 1), `status` Pending / On Rent / Returned / Sold, `deliveredAt`, `returnedAt`, `meterIn` and `returnNotes`. Deliver and Return are actions on the line. Billing periods run from the agreement's start date, whatever the delivery date (`apps/erp/app/modules/sales/AGENTS.md`).

1. **Add one delivery document and one return document per trip, linked to the rental agreement.** Each document holds one or more units of that agreement, and the user picks the units. This follows STAEDEAN (packing slip, return note), Texada (delivery and pickup tickets) and SAP (outbound and returns delivery). If Carbon reuses `shipment` and `receipt` for this, add the rental agreement as a source document type.
2. **Keep the rental agreement line as the unit's state.** Posting a delivery sets the line On Rent and stamps `deliveredAt`. Posting a return sets it Returned and stamps `returnedAt`. A partial return is then only a return document with fewer units (STAEDEAN, Wynne).
3. **Post no item ledger row and no journal for a fixed-asset unit.** The document changes custody and location only. SAP 631/632 and the rental systems surveyed work this way. If Carbon reuses `shipment` and `receipt`, their posting must skip the inventory and GL legs for these lines.
4. **Store two return dates: the off-rent date and the received date.** The off-rent date stops billing. The received date records arrival at the yard. Allow an off-rent date before today with a warning when it falls inside an already billed period. Carbon's existing early-return credit memo then handles the credit (Wynne, Point of Rental, HirePOS).
5. **Capture per unit on each document:** meter out and meter in, condition notes, photos as attachments, and an optional signature. Put the driver, the carrier and the tracking number on the document header (Texada, Wynne). Leave fuel out of v1. Only STAEDEAN and Point of Rental model fuel, and both bill it as a separate charge.
6. **Record the receiving location on the return and move the asset there.** Update the fixed asset's `locationId` to the receiving location. Do not create an inter-branch transfer document (Point of Rental, STAEDEAN depot change). Leave revenue allocation between branches out of scope (Texada's cross-store account).
7. **Put a returned unit into an inspection state before it is Available.** Let the inspection raise a `rentalAgreementCharge` for damage and an optional maintenance dispatch (STAEDEAN, NetSuite RentalSeries, HirePOS).
8. **Open question for the spec: should the delivery date start billing?** Every rental system surveyed bills from the on-rent (delivery) date. Carbon bills from the agreement start date, the SAP standard SD pattern. Carry this into the spec's Open Questions.

## Sources

- https://sapinsider.org/manage-rental-contracts-with-help-from-sales-and-distribution-functionality/
- https://community.sap.com/t5/enterprise-resource-planning-q-a/consignment-fill-up-accounting-entry-required-in-631w-movement-type/qaq-p/9164502
- https://community.sap.com/t5/enterprise-resource-planning-q-a/movement-types-in-consignment-processing/qaq-p/3682302
- https://community.sap.com/t5/enterprise-resource-planning-q-a/serial-number-status-esto-and-ecus/qaq-p/9773461
- https://community.sap.com/t5/enterprise-resource-planning-q-a/serial-number-status-edel-esto-in-sd/qaq-p/5431627
- https://community.sap.com/t5/enterprise-resource-planning-q-a/rental-process-through-solution-order-how-to-manage-returns/qaq-p/14246357
- https://community.sap.com/t5/enterprise-resource-planning-q-a/rental-process-delivery-with-movement-type-621/qaq-p/12703815
- https://userapps.support.sap.com/sap/support/knowledge/en/2686854
- https://fit-global.com/sap-equipment-management-solutions/equipment-rental-software/
- https://sererra.com/rentalseries/
- https://luxent.com/products/rental-lease
- https://versich.com/blog/netsuite-rental-management-for-cleaner-returns-and-billing-control/
- https://docs.staedean.com/equipment-rental/docs/post-packing-slip.md
- https://docs.staedean.com/equipment-rental/docs/return-business-object-on-rental-order.md
- https://docs.staedean.com/equipment-rental/docs/receive-rental-orders-including-field-service-app.md
- https://docs.staedean.com/equipment-rental/docs/change-rental-order-off-rent-date.md
- https://docs.staedean.com/equipment-rental/docs/change-rental-order-line-off-rent-date.md
- https://docs.staedean.com/equipment-rental/docs/collect-the-assets-mobile-app.md
- https://docs.staedean.com/equipment-rental/docs/close-the-collection-task-mobile-app.md
- https://docs.staedean.com/equipment-rental/docs/close-the-quality-check-task-mobile-app.md
- https://docs.staedean.com/equipment-rental/docs/manually-create-a-repair-work-order-mobile-app.md
- https://docs.staedean.com/equipment-rental/docs/add-rental-order-line-with-rental-item.md
- https://docs.staedean.com/equipment-rental/docs/technical-exchange.md
- https://docs.staedean.com/equipment-rental/docs/add-fuel-transaction.md
- https://docs.staedean.com/equipment-rental/docs/maintain-released-product.md
- https://docs.staedean.com/equipment-rental/docs/manage-business-object-depot.md
- https://docs.staedean.com/equipment-rental/docs/change-depot-on-the-business-object.md
- https://staedean.com/rental/blog/managing-daily-rental-operations-dynarent-dynamics-365
- https://staedean.com/rental/blog/rental-inventory-management-dynamics-365
- https://help.texadasoftware.com/en/knowledge/187/create-a-ticket-in-texada-web
- https://help.texadasoftware.com/en/knowledge/480/complete-a-check-in-or-check-out-in-service-and-rental-mobile
- https://help.texadasoftware.com/en/knowledge/474/2019-systematic-rental-management-srm-release-notes
- https://help.texadasoftware.com/en/knowledge/1044/texada-srm-data-import-toolbox
- https://help.texadasoftware.com/en/knowledge/knowledge/171/the-asset-list-page
- https://help.texadasoftware.com/en/knowledge/809/the-contract-reservation-details-page
- https://support.wynnesystems.com/help/rm/ENU/Content/Operations_Overview.htm
- https://support.wynnesystems.com/help/rm/ENU/Content/RASUST102.htm
- https://support.wynnesystems.com/help/rm/ENU/Content/RARINT10.htm
- https://support.wynnesystems.com/help/rm/ENU/Content/RARINT101.htm
- https://support.wynnesystems.com/help/rm/ENU/Content/RAOUTT20.htm
- https://help.point-of-rental.com/2020/Content/Close%20Contract.htm
- https://help.point-of-rental.com/2020/Content/Items%20Tab.htm
- https://help.point-of-rental.com/2016/Documents/calledoffrent.htm
- https://help.point-of-rental.com/2016/Documents/partialreturn.htm
- https://help.point-of-rental.com/2021/Content/Transfer%20Contract.htm
- https://docs.hirepos.com/en/articles/2324865
- https://www.odoo.com/documentation/17.0/applications/sales/rental.html

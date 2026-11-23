# Field Service Research: Best Practices Survey

> Research date: 2026-10-08. Input to `.ai/specs/implemented/2026-10-08-field-service.md`. Companion: `.ai/research/serial-service-cost-treatment.md` (capitalize or expense, decided by the unit's owner).

## Summary

We surveyed how seven products model field service and depot repair:
- SAP S/4HANA Service, SAP Field Service Management, Microsoft Dynamics 365 Field Service, Business Central Service Management, IFS Cloud, Salesforce Field Service and Epicor Kinetic.
- Six entities recur: an installed base of customer assets, warranty terms, a service order, its lines, one or more visits per order, and contracts.
- In D365 and Business Central, the visit status drives the order status.
- Coverage (warranty or contract) is decided per line. Covered lines stay on the invoice at zero price, so cost and history stay visible.
- Depot repair links to the return order and ships the same serial back (SAP In-House Repair is the strongest model).
- The technician's mobile flow is the same everywhere: today's visits, status changes, time, parts, checklist, photos and signature.

Carbon already has serial tracking, returns (RMA), maintenance dispatch, contracts and a per-serial cost layer. It has no installed base, no warranty fields, no service order and no signature capture.

## Competitors Surveyed

- **SAP S/4HANA Service and FSM**: service orders, confirmations, In-House Repair, equipment as the installed base, warranty and contracts.
- **Microsoft Dynamics 365 Field Service**: work orders, incident types, bookings, customer assets, agreements and entitlements.
- **Business Central Service Management**: service items created at shipment, service orders, warranty dates and the posting verbs (Ship, Consume, Invoice).
- **IFS Cloud**: work tasks, service objects, customer and supplier warranty.
- **Salesforce Field Service**: work orders, service appointments, the asset hierarchy, warranty terms and maintenance plans.
- **Epicor Kinetic**: service calls, field service jobs, RMA to job, warranty codes on parts.

## Key Consensus Patterns

### 1. One order, many visits

- **D365**:
  - A work order holds products, services and service tasks. Bookings are the visits.
  - Creating a booking sets the order to Scheduled. Traveling sets it to In Progress.
  - The order completes when every booking is Completed or Canceled.
  - A custom booking status can return the order to Unscheduled for a follow-up visit.
- **SAP FSM**: a service call holds activities, one per technician visit.
- **Salesforce**: a work order holds service appointments. Here the appointment status does NOT drive the order status, which users report as a pitfall.
- **Rationale**: one job often needs a second trip. The order keeps the cost and billing; the visit keeps who was there and when.

### 2. An installed base of customer assets, created at shipment

- **Business Central**: a sales shipment of an item whose service item group has "Create Service Item" creates a service item. The service item holds the serial, warranty dates, contracts and history.
- **D365**: "Convert to Customer Asset" on a used product creates an asset. It creates one asset regardless of quantity, which is a known pitfall.
- **Salesforce**: assets have Parent Asset and Root Asset, and inherit the product's warranty terms.
- **SAP**: equipment and functional locations.
- **Rationale**: a field visit starts from "which unit, at which site, under which warranty". The shipment is the only reliable moment to capture it.

### 3. Warranty dates per unit, decided per line

- **Business Central**: separate labor and parts warranty dates and percentages on the service item. The line has a warranty discount and an "exclude warranty" flag.
- **Salesforce**: warranty terms with labor, parts and expenses percentages, each with its own duration.
- **IFS**: customer warranty covers serialized parts only. Covered posting lines carry "Keep revenue = No".
- **Epicor**: the warranty starts at the ship date. It is checked on the top-level part only, which users report as a pitfall.
- **Rationale**: labor and parts often have different terms, and a visit can mix covered and billable work.

### 4. Covered lines stay visible

- **D365**: an entitlement applies a price list and a percentage discount. A 100 % discount leaves the lines on the invoice at zero.
- **Business Central**: warranty lines carry a discount. "Ship and Consume" posts free work with no invoice.
- **Rationale**: the customer sees what the warranty paid for, and cost history stays complete.

### 5. Depot repair keeps the unit out of company stock

- **SAP In-House Repair**:
  1. The returns order receives the unit into non-valuated, customer-owned stock.
  2. A precheck decides between repair and return.
  3. An optional quotation needs the customer's acceptance.
  4. A repair order holds the confirmations.
  5. An outbound delivery ships the same object back.
  6. The confirmations go to billing.
- **Salesforce**: a return order line has a processing plan (Repair, Discard, Salvage, Restock) and can send the repaired item back.
- **D365**: the RMA has no native "repair and ship back the same serial" path.
- **Rationale**: the customer owns the unit. Valuing it as stock overstates inventory and lets planning count it.

### 6. Parts from a warehouse or a van

- **D365**: a warehouse can be a technician's truck, and each resource has a default warehouse. D365 does not block negative stock by default, which is a pitfall.
- **Salesforce**: a location (warehouse or van) holds product items. Products consumed decrement it.
- **Business Central**: Replace Component moves the old component to a replaced-component list and installs the new one.
- **Rationale**: technicians carry stock. The part source is a normal stock location.

### 7. The technician's phone flow is the same everywhere

| Step | Evidence |
|---|---|
| Today's visits | D365 mobile, SAP FSM |
| Accept, travel, arrive, complete | D365 booking statuses fill in the arrival time and the durations |
| Log time | SAP FSM stopwatch or manual entry; D365 booking journals |
| Add parts | SAP FSM from van stock; D365 sets the line to Used |
| Checklist | D365 inspections; SAP FSM smartforms |
| Photos | D365 inspections |
| Signature and service report | Salesforce "Sign & Confirm"; D365 |
| Offline | SAP FSM, Epicor |

### 8. Dispatch starts simple

- **Essential**: a list of unscheduled work, and an assignment of a technician and a time window per visit.
- **Useful early**: skills and territories.
- **Advanced**: schedule optimization (D365 RSO, Salesforce scheduling policies).

## Answers to Research Questions

1. **Which entities?**
   - customer asset (installed base);
   - warranty terms per item;
   - service order;
   - service order lines (labor, part, expense);
   - visits;
   - contracts.

   Source: every product surveyed.
2. **How does the order status move?** From its visits (D365). It is scheduled when a visit exists, and in progress when a technician travels or arrives. It is completed when the work is complete.
3. **How is coverage decided?**
   - Per line, from the unit's labor and parts warranty dates, then the customer's contract.
   - Covered lines stay at zero price.

   Source: Business Central, D365, Salesforce.
4. **How does depot repair work?** The return receives the unit outside company stock, and a repair order holds the work. The same serial ships back (SAP).
5. **What does a technician need?** Today's visits, status changes, time, parts, notes, photos and a signature, on a phone.

## Competitor-Specific Details

- **D365 incident types** are templates. They pre-fill tasks, products, services, skills and duration.
- **D365 agreements** can bill twice (the agreement invoice and the work order invoice), which is a pitfall.
- **Business Central's order status** rolls up from each item's repair status (In Process, then Pending, then On Hold, then Finished).
- **SAP warranty** can inherit from the next higher equipment in the tree.
- **IFS** bills a supplier warranty claim on the same work order.
- **Salesforce maintenance plans** generate work orders per asset per due date, 3 times a day.

## Recommended Approach for Carbon

1. **`customerAsset`**: one row per shipped serial, keyed to its `trackedEntity`, with customer, site, ship date and the labor and parts warranty end dates.
   - Created by `post-shipment` for every serialized item.
   - Registered by hand for units sold before Carbon.

   Follows Business Central's service item.
2. **Warranty months on the item's sales settings** (labor and parts separately). The asset's end dates are ship date + months, and a user can edit them. Follows Business Central and Salesforce.
3. **`serviceOrder`** with three types:
   - **Field Visit**: a customer unit, at the customer's site.
   - **Depot Repair**: a customer unit, received through an RMA.
   - **Refurbishment**: a unit the company owns, in stock.

   Each order has one subject serial, as SAP has one repair order per object.
4. **`serviceOrderVisit`**: technician, planned window, status, actual arrival and end, signature. Visits drive the order status (D365).
5. **`serviceOrderLine`**: Labor, Part or Expense, each with a coverage of Warranty, Contract or Billable, decided per line. Covered lines stay at zero on the invoice (D365, Business Central).
6. **Depot repair through the RMA**:
   - A `Repair` disposition is set before receipt.
   - The receipt and the return shipment write no stock ledger and no value (SAP).
7. **Parts from any storage unit**, including a van. Issue refuses negative stock, avoiding the D365 pitfall.
8. **Mobile through the ERP**: a phone-friendly My Visits page, and a visit page with status buttons, time, parts, notes, photos and a signature.
9. **Dispatch v1**: assign a technician and a window per visit; list visits by day and technician. Skills, territories and optimization come later.
10. **Later**:
    - component replacement in the asset tree (Business Central);
    - preventive maintenance plans (Salesforce);
    - entitlements with priority (D365);
    - advance exchange;
    - supplier warranty claims (IFS);
    - offline mode.

## Sources

- https://learn.microsoft.com/en-us/dynamics365/field-service/work-order-status-booking-status
- https://learn.microsoft.com/en-us/dynamics365/field-service/create-product-or-service
- https://learn.microsoft.com/en-us/dynamics365/field-service/work-order-entitlements
- https://learn.microsoft.com/en-us/dynamics365/field-service/configure-incident-types
- https://learn.microsoft.com/en-us/dynamics365/field-service/agreements-overview
- https://learn.microsoft.com/en-us/dynamics365/field-service/assets
- https://learn.microsoft.com/en-us/dynamics365/field-service/inventory-purchasing-returns-overview
- https://learn.microsoft.com/en-us/dynamics365/field-service/process-return
- https://learn.microsoft.com/en-us/dynamics365/field-service/mobile/overview
- https://learn.microsoft.com/en-us/dynamics365/field-service/inspections
- https://learn.microsoft.com/en-us/dynamics365/field-service/rso-overview
- https://learn.microsoft.com/en-us/dynamics365/business-central/service-service-posting
- https://learn.microsoft.com/en-us/dynamics365/business-central/service-how-to-create-service-items
- https://learn.microsoft.com/en-us/dynamics365/business-central/service-how-to-work-on-service-tasks
- https://learn.microsoft.com/en-us/dynamics365/business-central/service-service-order-status-and-repair-status
- https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/table/microsoft.service.item.service-item
- https://learning.sap.com/courses/implementing-in-house-service-processes-in-sap-s-4hana-cloud-public-edition-service/explaining-the-process-steps-for-in-house-repairs_a5ddc919-9c1b-435b-b031-d413d9182f6c
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/9d794cbd48c648bc8a176e422772de7e/f437d220829a4334976cd81c3b055a04.html
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/warranty-determination-in-sap-s-4hana-service-orders/ba-p/13453305
- https://learning.sap.com/courses/managing-sap-field-service-management/utilizing-sap-mobile-field-service
- https://help.salesforce.com/s/articleView?id=sf.fs_appointment_fields.htm
- https://developer.salesforce.com/docs/platform/data-models/guide/field-service-warranty-management.html
- https://help.salesforce.com/s/articleView?language=en_US&id=sf.fs_return_order_settings.htm
- https://help.salesforce.com/s/articleView?id=sf.assets_rel_hierarchical.htm
- https://help.salesforce.com/s/articleView?language=en_US&id=service.fs_generate_work_orders_plan.htm
- https://help.salesforce.com/s/articleView?language=en_US&id=mfs_service_report.htm
- https://docs.ifs.com/ifsclouddocs/25r2/WorkTaskManagement/AboutWorkTaskManagement.htm
- https://docs.ifs.com/ifsclouddocs/25r2/EquipmentAdministration/AboutWarranty.htm
- https://docs.ifs.com/ifsclouddocs/26r1/lang/en/InstalledBase/AboutServiceObject.htm
- https://www.epiusers.help/t/implementing-warranties-basic-questions/63819
- https://erp-demos.net/epicor-training/field-service-warrant-contract-rma/

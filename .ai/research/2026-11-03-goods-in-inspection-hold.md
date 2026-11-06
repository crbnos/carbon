# Goods-In Inspection Hold Research: Best Practices Survey

Scope: a default inspection storage unit and inspection flags on the receipt,
then a hold until the inspection passes, inspection statuses on the receipt,
and putaway after the pass. This file covers the logistics side:
where held stock sits, what blocks it, and how stores see the work. The
measurement side (characteristics, sampling, results) is in
`.ai/research/inbound-inspection-execution.md` and is not repeated here.

## Summary

We surveyed 9 products and 3 quality standards. Every product separates two
records. The receipt posts stock and value at once. The inspection lot holds
the stock until a person makes a decision. No product keeps
the receipt itself unposted while inspection runs. Oracle and Epicor
are partial exceptions: they post the receipt, but the stock is not on hand
until the pass or the putaway. Products model
held stock in one of 3 ways: a status (SAP, Epicor), a location (Odoo,
Fishbowl, Acumatica), or both (D365, Business Central, NetSuite). Most products set the default inspection location per warehouse or
site. A pass leads to a putaway move. A fail leads to a
nonconformance and a return, scrap or concession.

Carbon already has most of the parts: the inspection lot (`inspection`),
`On Hold` for serial and batch stock, and non-nettable storage units. Four
parts are missing. Untracked stock has no hold at all. Nothing routes a receipt
line to an inspection storage unit. The receipt shows no inspection status. And
5 move paths ignore `On Hold`.

## Competitors Surveyed

- **SAP S/4HANA (QM, WM, EWM)** — the enterprise reference: quality inspection
  stock type, inspection lot, usage decision, QC work center per warehouse.
- **Microsoft Dynamics 365 Supply Chain Management** — the closest match to the
  request: a quality location per warehouse, quality orders, inventory
  blocking, and a quality order status on the PO line.
- **Microsoft Dynamics 365 Business Central (Quality Management)** — lot
  blocking per transaction type, and failure actions by quantity.
- **Oracle Fusion Cloud SCM and EBS** — receipt routing (Direct / Standard /
  Inspection Required) and an "Awaiting Inspection" queue.
- **NetSuite (Quality Management SuiteApp)** — a pre-inspection bin plus a
  pre-inspection status, and pass and fail bins.
- **Epicor Kinetic** — receive to inspection as a separate inventory state, and
  a required-document gate at receipt.
- **Odoo (Inventory + Quality)** — 3-step receipts per warehouse (Input →
  Quality Control → Stock) and a split pass/fail dialog.
- **Fishbowl and Acumatica** — location-only models with "available" flags per
  location.
- **1factory and HighQA** — quality point solutions. They own the inspection.
  The ERP owns the hold.
- **ISO 9001, AS9100D, ISO 13485 (FDA QMSR)** — the rules for inspection status
  identification and urgent release.

## Key Consensus Patterns

### 1. The receipt posts at once; the inspection lot is the open record

- **SAP**: the goods receipt posts the material document. The inspection lot
  stays open until the usage decision. A GR reversal cancels an open lot
  (status `LTCA`). SAP refuses the reversal after a usage decision has posted
  stock.
- **D365**: the receipt registers stock. A quality order holds it. "Event
  blocking = End" can hold the next document step, such as the invoice.
- **NetSuite / Business Central / Odoo**: the receipt posts. The inspection
  queue, inspection or quality check is the open record.
- **Oracle**: with Inspection Required routing, stock stays in receiving. On
  hand does not increase until putaway.
- **Epicor**: the receipt posts `PUR-INS`. The stock leaves on hand until the
  pass posts `INS-STK`.
- **Rationale**: the receipt drives value, the GL and the PO balance. Those
  must not wait for a quality decision that can take days.

### 2. Held stock is a status, a location, or both

| Product | Model | Default inspection location |
|---|---|---|
| SAP | Stock type (QI). It travels with the stock between bins. | QC work center per EWM warehouse |
| Epicor | Inventory state. The stock is not on hand while in inspection. | Default inspection warehouse and bin per site |
| D365 SCM | Location plus an inventory blocking record | Location directive per warehouse (`QMS`) |
| Business Central | Lot block plus an optional quarantine bin | Rule filter by location |
| NetSuite | Bin plus inventory status | Workflow parameter, per location by condition |
| Odoo | Location only. Reservation blocks it. | Per warehouse (`WH/Quality Control`) |
| Fishbowl / Acumatica | Location only, with "available" flags | Location type default |

- **Rationale**: a location is visible on the floor and works for untracked
  stock. A status works for lots and serials and survives a move. Systems that
  serve both kinds of stock use both.

### 3. The default inspection location is set per warehouse or site

- **SAP**: "Assign Default Work Center for Inspections" per EWM warehouse.
- **D365**: one quality location per warehouse, through location directives.
- **Odoo**: the 3-step receipt setting is per warehouse.
- **Epicor**: a default inspection warehouse and bin per site.
- **Rationale**: each building has its own physical QC area. A company-wide
  default does not work for more than one site.

### 4. The hold blocks issue, shipping and picking

- **SAP**: withdrawals post from unrestricted stock only. The usage decision is
  the only legal way out of QI stock.
- **D365**: "While there are open quality orders, inventory quantities are
  automatically blocked from being issued."
- **NetSuite**: a status without "Make Inventory Available" removes the stock
  from available but keeps it on hand.
- **Oracle**: material status control lists the allowed and refused
  transaction types per subinventory, locator, lot and serial.
- **Business Central**: Block, "Allow finished only" or Allow, per inspection
  result and transaction type.
- **Rationale**: the hold is only real if every move path checks it. A hold
  that one path ignores is not a hold.

### 5. A pass leads to putaway; a fail leads to an NCR and a disposition

- **SAP**: the usage decision splits the quantity across unrestricted, blocked,
  scrap, sample and return to supplier.
- **D365**: validation creates quality order work. A location directive on
  `Quality orders.Status` sends Pass to bulk and Fail to a return zone.
- **NetSuite**: "Bin On Pass/Fail" and "Inventory Status On Pass/Fail" move the
  stock per lot.
- **Odoo**: a "Quantity Failed" field and a failure location in one dialog.
  Validation sends the passed units on to stock.
- **Epicor**: the inspector picks the target bin at pass, so the putaway is part
  of the inspection. A fail issues a DMR.
- **Rationale**: a partial outcome is normal. One lot often yields both a
  passed quantity and a failed quantity.

### 6. Stores see a queue of waiting work

- **Oracle**: an "Awaiting Inspection" tab on the Inspect Receipts page.
- **D365**: a quality order status on the PO header and line, and quality work
  in the warehouse mobile work list.
- **SAP**: the QA32 worklist, and the EWM warehouse monitor node "Inspection".
- **Epicor**: `InspectionPending` on the receipt detail, and an Inspection
  Pending report.
- **Rationale**: stores and quality are two teams. Each team needs its own list
  of work, filtered to its state.

## Answers to Research Questions

1. **How does a product decide that a receipt needs inspection?** — By item, and
   then narrowed by supplier and location. SAP uses the inspection setup per
   material plus the quality info record per supplier. D365 and Business
   Central use first-match rules on item, item group, vendor and warehouse.
   Epicor sets the flag from the supplier, part class, PO line or inspection
   plan. Epicor snapshots the flag on the receipt line at receipt time.
2. **Where does held stock sit, and where is the default set?** — See pattern
   2. SAP, D365, Odoo and Epicor set the default per warehouse or site.
   Business Central and NetSuite set it in a rule or workflow, filtered by
   location.
3. **What statuses do they show, and does the receipt stay open?** — The
   statuses sit on the inspection lot, not on the receipt document. SAP:
   `CRTD`, `REL`, `UD`, `SPCO`, `LTCA`. D365: Open, Pass, Fail. NetSuite:
   Pending, In-Process, Pass, Fail, Hold, Cancel. Business Central keeps the
   status (Open / Finished) apart from the result (PASS / FAIL). D365 and
   Epicor also show the state on the PO line or receipt line. No product keeps
   the receipt unposted. Oracle and Epicor keep the stock off on hand instead.
4. **What does the hold block, and what enforces it?** — Issue, ship, pick and
   transfer. The enforcement point is one shared check: a stock type (SAP), a
   blocking record (D365), a material status (Oracle) or an inventory status
   (NetSuite). Every transaction reads it.
5. **What happens on pass, fail and partial?** — See pattern 5. D365, Oracle,
   NetSuite and Odoo make putaway a separate move after the pass. Epicor puts
   the stock away inside the pass. SAP WM often puts the stock away before the
   decision, and the decision only changes the stock category.
6. **What edge cases and extra features matter?** — Skip lot and frequency (SAP,
   D365, Oracle, Odoo, NetSuite). Putaway of the remainder while only the sample
   goes to QC (SAP, D365). A required certificate at receipt (Epicor). Urgent
   release before inspection (AS9100D 8.4.2). Cancelling a lot when a user
   reverses the receipt (SAP). Vendor score from GR inspections (SAP).

## Competitor-Specific Details

### SAP S/4HANA

- "Control InsLot" decides lot grouping: one lot per GR item, per material
  document, per batch, or per PO item.
- WM keeps the QI category and the lot number on the quant when the stock moves
  between bins. Early putaway of the remainder is the standard flow. Only the
  sample goes to the QC work center.
- MRP counts QI stock in net requirements. MD04 shows open lots as "QM lot"
  elements.
- A usage decision cannot be undone in S/4HANA.
- Vendor evaluation has a "GR inspection" criterion. It averages the quality
  scores of the supplier's lots.
- SAP Business One has no QM. Batch status (Released / Not Accessible / Locked)
  is the nearest feature.

### Microsoft Dynamics 365 Supply Chain Management

- The per-warehouse switch is **Enable quality order for warehouse processes**.
- Only the sample goes to the quality location. Example: receive 20, sample 1.
  The system creates 1 sampling work and 19 putaway work.
- "Full blocking" blocks the whole line or lot. Without it, D365 blocks only
  the sample quantity.
- The blocking record has "Expected receipts" set, so planning treats the held
  quantity as coming supply, not as missing stock.
- Flexible sampling plans add skip lot, rounds, and an alert role on failures.

### Microsoft Dynamics 365 Business Central

- Generation rules run in sort order. The first matching rule supplies the
  template.
- Failure actions run on a quantity basis: Entire Lot, Specific, Sample, Passed
  or Failed. They include Move Inventory, Create Internal Put-away, Create
  Purchase Return Order and Create Negative Adjustment.

### Oracle

- Receipt routing has 3 values: Direct Delivery (1 step), Standard Receipt (2
  steps) and Inspection Required (3 steps).
- The inspector accepts or rejects a quantity per line. To accept part of a
  line, the inspector splits it.
- WMS putaway rules read the inspection status: Not inspected, Accepted,
  Rejected.
- Skip lot works for receiving plans, grouped by item, supplier and inspection
  level.

### NetSuite

- The Specification Context filters by transaction type, vendor and location.
- "Transaction Frequency" gives a simple skip: 0 = every receipt, 1 = every
  other receipt.
- You can use a pre-inspection bin, a pre-inspection status, both or neither.
- A failed lot-tracked or serialized item can create an NCR automatically.

### Epicor Kinetic

- The receipt posts `PUR-INS`. The pass posts `INS-STK`. Each move has its own
  transaction type, so the history shows both.
- "Receipt Docs Required" on the part refuses a receipt until a user attaches a
  document of the named type.
- DMR outcomes: reject (scrap or return), debit memo, accept to stock, accept to
  job.

### Odoo

- The quality check states are To Do, Passed and Failed.
- An open check stops validation of the transfer. A failed check does not.
- Control frequency can be All, Randomly (a percentage), Periodically or
  On-Demand.

### Quality standards

- **ISO 9001:2015 8.5.2** requires the organization to identify the inspection
  status of its outputs.
- **AS9100D 8.4.2** allows release for production before verification only if
  the product is "identified and recorded to allow recall and replacement".
  Clause 8.6 requires a record of the person who authorized the release.
- **ISO 13485 7.5.8** allows the use of product only after it passes, or under
  an authorized concession. The FDA QMSR took effect on 2026-02-02 and
  incorporates ISO 13485. Former 21 CFR 820.80 and 820.86 are now reserved, so
  new work must cite ISO 13485.

## Carbon Today

| Area | What exists | Gap |
|---|---|---|
| Inspection required | `itemInspectionDocumentAssignment` with usage `Receipt`, per item | No per-supplier or per-location rule. No skip lot. |
| Lot creation | `postReceipt` (Purchase Order branch) creates one `inspection` per line in the same transaction | Sales Return Order, Inbound Transfer and purchase-invoice receipts create no lot. Outside-processing lines may get a lot with no stock. |
| Lot status | `inspectionStatusType` = `Pending`, `In Progress`, `Passed`, `Failed`, `Partial` | No `Cancelled`. A voided receipt leaves its lot `Pending`. |
| Receipt status | `receiptStatus` = `Draft`, `Pending`, `Posted`, `Voided` | No inspection or putaway state. The receipt is `Posted` before inspection ends. |
| Line storage unit default | PO line bin, else `pickMethod.defaultStorageUnitId` (`shared.service.ts:12027-12115`) | No inspection storage unit. No per-location storage default of any kind. |
| Serial and batch hold | `On Hold` at receipt, `Available` or `Rejected` at disposition | Stock transfer, adjustment bin move, inventory count and server-side `postPicking` do not check `On Hold`. Stock transfer unpick sets any unit to `Available` (`inventory.service.ts:9650-9662`). |
| Untracked hold | None | The stock is pickable, consumable and shippable as soon as the receipt posts. |
| MRP | Excludes stock in non-nettable storage units | `On Hold` stock in a nettable unit counts as supply. |
| Untracked reject | `post-nonconformance` writes the stock off | It books `storageUnitId: null` (`quality.service.ts:5884`). The receiving bin keeps its stock and the unassigned bin goes negative. |
| Receipt UI | `ReceiptLineInspectionMark` on the line, lots in `ReceiptDocuments` | No header flag, no list column, no filter. |
| Putaway | `warehouse.requiresPutAway` exists but nothing reads it | No putaway step. Stores use a manual stock transfer. |
| Location settings | Columns on `location` (`requiresStaffing`, `responsibleEmployee`), UI `ResponsibleEmployeeCard` | No settings page pairs a location with a storage unit picker. |

Non-nettable storage (PR #2075, `.claude/rules/inventory-system.md`) is the
best existing base. It keeps stock on hand and valued, and MRP and picking
ignore it. A stock transfer is its only exit today.

## Recommended Approach for Carbon

1. **Keep `receiptStatus` as it is. Add a separate inspection roll-up on the
   receipt.** Every product posts the receipt at once and puts the open state
   on the inspection lot (pattern 1). `Posted` drives the GL, the PO balance and
   the void logic. Add `receipt.inspectionStatus` with these values, rolled up
   from the receipt's lots:

   | Value | Rule |
   |---|---|
   | `Not Required` | No line has a lot |
   | `Pending Inspection` | Every lot is `Pending` |
   | `Inspection In Progress` | At least one lot is `In Progress`, or lots are mixed |
   | `Inspection Passed` | Every lot is `Passed`. Putaway can start. |
   | `Inspection Failed` | Every lot is `Failed` |
   | `Partially Passed` | Lots are terminal and at least one is `Partial`, or results are mixed |
   | `Put Away` | Every passed quantity has left the inspection storage unit |

   This matches the requested names. It also answers "the receipt stays open
   until the inspection passes" without unposting it.

2. **Add a per-location inspection storage unit (D365, SAP, Odoo, Epicor
   pattern).** Store it as `location.inspectionStorageUnitId`, the same way as
   `location.requiresStaffing`. Copy `ResponsibleEmployeeCard` for the settings
   card: one row per location, with the `StorageUnit` picker filtered to that
   location. Put the card on the Quality settings page. Refuse a storage unit
   from another location. Require the unit to be non-nettable, so MRP and
   picking ignore held stock with no new code.

3. **Default the receipt line to the inspection storage unit.** At line
   creation (`shared.service.ts:12110`), use this order:
   1. If the item has a `Receipt` assignment and the location has an
      inspection storage unit, use that unit.
   2. Else use the PO line's storage unit.
   3. Else use the `pickMethod` default.

   Apply the same order to Sales Return Order and Inbound Transfer lines once
   those create lots.

4. **Store `receiptLine.requiresInspection` as a snapshot (Epicor pattern).**
   Set it at line creation from the assignment. Then a later change to the
   item's plan does not rewrite a past receipt. Derive the header flag from the
   lines in the list query (`EXISTS`). Show a badge on each line next to
   `ReceiptLineInspectionMark` and in `ReceiptHeader`. Add an "Inspection"
   column and filter to `ReceiptsTable`.

5. **Make the open inspection lot the hold, and check it in one place (pattern
   4).** The rule: stock that an open lot holds cannot leave the inspection
   storage unit. Only these documents may move it:
   1. The putaway after an accepted or partial lot.
   2. The NCR disposition (scrap, return to supplier).
   3. A receipt void.

   For serial and batch stock, `On Hold` already marks it. Add the `On Hold`
   check to the 5 paths that miss it, and fix the unpick reset. For untracked
   stock, compute the held quantity per (item, storage unit) from the open
   lots. Refuse an outbound move that takes the bin below that quantity. One
   shared building block (`assertNotHeldForInspection`) called from each
   posting is easier to test than an `itemLedger` trigger. The trigger would
   have to allow voids, corrections and disposition write-offs.

6. **Make putaway a real step that reuses the stock transfer (Odoo, D365
   pattern).** When the inspector accepts a lot, or accepts part of it, create a
   Draft stock transfer. Its lines move the passed quantity from the inspection storage unit
   to the item's `pickMethod` default bin. Link it to the receipt. Stores
   complete it with the scan flow they already use. When it posts, the receipt
   roll-up moves to `Put Away`. This reuses an existing document instead of
   adding a new record type.

7. **Add an optional rejected storage unit per location (D365, NetSuite, Odoo
   pattern).** On a fail or a partial fail, move the failed quantity there for
   the MRB. Fix the untracked write-off so it books the inspection storage unit,
   not `null`.

8. **Add a stores queue (Oracle, SAP, D365 pattern).** Add saved views on the
   receipts list: "Pending inspection", "Ready for putaway" and "Failed". Add a
   count on the Inventory home. The quality team keeps the existing
   `/x/quality/inspections` list.

9. **Close the lot lifecycle gaps.** Add `Cancelled` to `inspectionStatusType`.
   Set it when a user voids the receipt (SAP `LTCA`). Create lots for Sales Return
   Order and Inbound Transfer receipts. Skip outside-processing lines.

10. **Later phases, in order of value:**
    1. **Urgent release (AS9100D 8.4.2).** A permitted user releases held stock
       before the decision. The lot stays open. Carbon records who released it
       and why, and the traceability graph can find every use of it.
    2. **Skip lot and supplier exemption** (SAP dynamic modification, D365
       flexible sampling, Odoo frequency). Store the rule per item and
       supplier.
    3. **Required certificate at receipt** (Epicor "Receipt Docs Required").
       Refuse the post until a user attaches a certificate of conformance.
    4. **Sample-only to QC** (SAP, D365). Send only the sample quantity to the
       inspection storage unit and put away the remainder under hold. This needs
       a status-based hold for untracked stock, so it comes after step 5.
    5. **MRP as expected supply** (D365 "Expected receipts"). Count held stock as
       supply due on the expected decision date, not as zero.
    6. **Dock-to-stock and ageing reports.** Measure from the receipt
       `postingDate` to the putaway post. Show the age of open lots. Add a
       supplier GR-inspection score (SAP vendor evaluation).
    7. **A "QC HOLD" label at receipt** through the printing system (ISO 9001
       8.5.2 status identification).

### Open questions for the spec

1. Can a user change a line's storage unit away from the inspection storage unit
   before posting? Options: refuse, allow only another non-nettable unit, or
   allow with a warning.
2. Must the inspection storage unit be non-nettable, or is a warning enough?
3. Who creates the putaway transfer: Accept itself, or a "Put away" action on
   the receipt?
4. On a partial pass, does the failed quantity move to the rejected storage unit
   at once, or at the NCR disposition?
5. Does `On Hold` stock in a nettable unit (no inspection storage unit set)
   stay MRP supply? Today it does.
6. Should the inspection roll-up be a stored column kept by a trigger, or a
   view column? A stored column is cheaper to filter in the list.

## Sources

- https://help.sap.com/doc/3f23bd534f22b44ce10000000a174cb4/3.6/en-US/fa55b853dcfcb44ce10000000a174cb4.html — SAP inspection setup, Control InsLot, skips
- https://help.sap.com/saphelp_46c/helpdata/en/be/00bbd8ca5311d2961800a0c930e04c/content.htm — SAP inspection type
- https://help.sap.com/saphelp_46c/helpdata/en/2d/35113c448c11d189420000e829fbbd/content.htm — SAP quality info record
- https://help.sap.com/saphelp_46c/helpdata/EN/58/1871a4e92111d3b29a0050da4ceab0/content.htm — SAP posting the goods receipt
- https://help.sap.com/saphelp_470/helpdata/en/c6/f83b924afa11d182b90000e829fbfe/content.htm — SAP stock category Q
- https://help.sap.com/saphelp_46c/helpdata/en/c6/f842ba4afa11d182b90000e829fbfe/content.htm — SAP inspection lot in the warehouse
- https://help.sap.com/saphelp_46c/helpdata/en/6e/a1c6b8e60f11d3b2980050da4ceab0/content.htm — SAP QM in WM, early putaway
- https://help.sap.com/saphelp_46c/helpdata/en/c6/f842fb4afa11d182b90000e829fbfe/content.htm — SAP posting change after UD
- https://help.sap.com/saphelp_46c/helpdata/en/c6/f842ad4afa11d182b90000e829fbfe/content.htm — SAP usage decision examples
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d27aa44af11d182b40000e829fbfe/content.htm — SAP MRP net requirements
- https://help.sap.com/saphelp_46c/helpdata/EN/58/1871a7e92111d3b29a0050da4ceab0/content.htm — SAP inspection lot processing
- https://help.sap.com/saphelp_46c/helpdata/en/8d/b97f17414511d188fc0000e8322f96/content.htm — SAP vendor evaluation GR inspection
- https://help.sap.com/saphelp_ewm2007/helpdata/en/8c/664841f60df723e10000000a155106/content.htm — SAP EWM work center
- https://help.sap.com/saphelp_ewm2007/helpdata/en/3e/05c941c43e6124e10000000a1550b0/content.htm — SAP EWM follow-up actions
- https://help.sap.com/saphelp_ewm2007/helpdata/en/84/2fc041a2236824e10000000a1550b0/content.htm — SAP EWM warehouse monitor
- https://learning.sap.com/courses/quality-management-in-sap-s-4hana-ewm/ensuring-product-quality — SAP embedded EWM QM
- https://learning.sap.com/courses/applying-sap-s-4hana-quality-management/executing-a-usage-decision_ba2ea755-2e7f-47fc-9aa2-97ae90e8a5be — SAP usage decision cannot be undone
- https://help.sap.com/saphelp_sbo92/helpdata/en/45/22b58e73c80108e10000000a114a6b/content.htm — SAP Business One batch status
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/quality-associations — D365 quality associations, blocking
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/quality-management-for-warehouses-processes — D365 quality location per warehouse
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/quality-orders — D365 quality orders
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-blocking — D365 inventory blocking
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-statuses — D365 inventory statuses
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/quality-flexible-sampling-plans — D365 flexible sampling
- https://learn.microsoft.com/en-us/dynamics365/business-central/qms-test-generation-rules — Business Central generation rules
- https://learn.microsoft.com/en-us/dynamics365/business-central/qms-lot-blocking-unblocking — Business Central lot blocking
- https://learn.microsoft.com/en-us/dynamics365/business-central/qms-non-compliant-processing — Business Central failure actions
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26d/famli/receipt-routing.html — Oracle receipt routing
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26d/faims/material-status-control.html — Oracle material status control
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26d/fauqm/skip-lot-inspections-explained.html — Oracle skip lot
- https://docs.oracle.com/en/cloud/saas/readiness/common/rrdem/inspect-receipts-using-a-redwood-page.html — Oracle Awaiting Inspection page
- https://docs.oracle.com/cd/E26401_01/doc.122/e48828/T210618T210768.htm — Oracle WMS inspection before putaway
- https://docs.oracle.com/cd/A60725_05/html/comnls/us/po/rcvinsp.htm — Oracle EBS inspection
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0713044724.html — NetSuite Enhanced Receipt Quarantine
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0520024952.html — NetSuite specification context
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158627331439.html — NetSuite inspection queue statuses
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1515696627.html — NetSuite inventory status
- https://epiusers.help/t/parts-going-into-inspection-processing/38826 — Epicor inspection as a state
- https://epiusers.help/t/purchased-inventory-parts-going-into-inspection-warehouse/63282 — Epicor PUR-INS, flag snapshot
- https://www.epiusers.help/t/inspection-required-po-receipt-entry/129447 — Epicor inspection-required flag, DMR
- https://www.epiusers.help/t/quality-assurance-receiving-material-with-inspection/59696 — Epicor pass to bin, DMR outcomes
- https://epiusers.help/t/receipt-docs-required-checkbox/86955 — Epicor Receipt Docs Required
- https://epiusers.help/t/quantity-in-inspection/94979 — Epicor InspectionPending
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/receipts_three_steps.html — Odoo 3-step receipts
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/quality/quality_management/quality_control_points.html — Odoo control points, frequency
- https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/quality/quality_management/failure_locations.html — Odoo failure locations
- https://fishbowlinventory.com/blog/looking-at-the-location-module — Fishbowl location types
- https://community.acumatica.com/distribution-6/what-s-the-difference-purpose-include-in-qty-available-and-sales-allowed-for-warehouse-locations-4659 — Acumatica location flags
- https://www.1factory.com/incoming-quality.html — 1factory incoming quality
- https://kb.highqa.com/docs/hqa-connect-supported-erp-systems-public — HighQA ERP integration
- https://www.isms.online/iso-9001/clause-8-5-production-and-service-provision/ — ISO 9001 8.5.2
- https://sites.google.com/view/pspiqms-001/qp-2-0-purchasing/as9100-purchasing — AS9100D 8.4.2 urgent release
- https://www.fda.gov/medical-devices/postmarket-requirements-devices/quality-management-system-regulation-qmsr — FDA QMSR
- https://sites.google.com/view/pspiqms-001/qp-3-0-production/iso-13485-production — ISO 13485 7.5.8 concession
- https://www.pureglobal.com/blog-posts/fda-21-cfr-part-820-to-iso-13485-qmsr-crosswalk-guide — 820.80 to ISO 13485 crosswalk

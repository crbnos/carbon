# Kanban Internal Replenishment with a Replenishment Level: Best Practices Survey

## Summary

This survey asks how 6 systems replenish a point-of-use bin from a bulk bin inside one site. It covers two triggers: a card scan, and the bin's quantity falling below a level. All 6 systems model the same 5 facts. The facts are the item, the source bin, the destination bin, a threshold, and a fixed replenish quantity. Every system that evaluates the threshold automatically counts open inbound transfers as supply, or it creates duplicates. Every system marks the automatic transfer with a structural origin field, not only a note. Two systems (SAP, Epicor) evaluate on the stock posting itself; three (D365 WMS, Odoo, NetSuite WMS) run a batch. The threshold has 3 common names: reorder point, minimum, and trigger quantity. The replenish quantity has 2: kanban quantity and reorder quantity.

## Competitors Surveyed

- **SAP S/4HANA (PP-KAB)** — the reference kanban model: control cycles, stock-transfer strategies, the quantity signal, and a 7-state kanban lifecycle.
- **Microsoft Dynamics 365 SCM** — lean withdrawal kanban (card-driven transfer jobs) and warehouse Min/Max replenishment (batch, per location).
- **Epicor Kinetic** — per-bin minimum on `PartBinInfo` with a cascading supply bin; the closest match to the request.
- **Odoo** — reordering rules on a sub-location with an Internal Transfers route; the simplest open-source model.
- **NetSuite WMS** — bin Replen Min/Max on a Preferred bin, fed from bulk bins by replenishment tasks.
- **Fishbowl** — location-group reorder point and order-up-to level; shows what a system without per-bin levels looks like.

## Key Consensus Patterns

### 1. The rule holds 5 facts: item, source bin, destination bin, threshold, fixed quantity

- **SAP**: the control cycle names the supply area (destination storage location), the supplying storage location, the kanban quantity, and for one-card kanban a trigger quantity.
- **D365 lean**: the transfer activity holds From location and To location; the rule holds Default quantity per kanban and a Fixed kanban quantity (number of cards).
- **Epicor**: `PartBinInfo` holds a bin minimum and a supply source bin per (part, site, warehouse, bin).
- **Odoo**: the reordering rule holds `location_id`, `product_min_qty`, `product_max_qty` and a Pull From route with a source location.
- **NetSuite WMS**: the bin record holds WMS Replen Min Qty, Max Qty, Replen Qty and Round Qty; the source is a bulk bin.
- **Rationale**: a replenishment loop is a fixed pair of bins for one item. No system puts the source bin on the item or on the destination bin alone.

### 2. Open inbound transfers count as supply before a new transfer is created

- **Odoo**: `qty_forecast = virtual_available + qty_in_progress`; `virtual_available` includes confirmed incoming moves, so the next run sees the open transfer and creates nothing.
- **Fishbowl**: `Needed = Order Up To Level − On Hand + On Order − Allocated − Not Available`; the Include Transfer Orders option adds open transfers to On Order.
- **D365 WMS**: demand replenishment first looks for open replenishment work with unreserved quantity and deducts it.
- **SAP**: a kanban that is EMPTY or IN PROCESS cannot be set EMPTY again (`PK155`), and a signal lock window ignores a repeated scan.
- **Epicor**: the trigger is edge-based: a bin "has to be above and then fall below" the minimum.
- **Rationale**: the destination bin's on-hand rises only when the transfer is picked. Without netting, every stock movement in between creates another transfer.

### 3. The automatic transfer carries a structural origin, not only free text

- **Odoo**: `stock.picking.origin = OP/00012` (the reordering rule's name); a manual internal transfer has an empty origin.
- **Epicor**: `MtlQueue.TranType` is `RAU-STK` for automatic and `RMN-STK` for manual replenishment.
- **D365 lean**: the document is a kanban transfer job with a kanban card id, a different object from a manual transfer.
- **D365 WMS**: the work carries `Work order type = Replenishment` and the template name.
- **SAP**: the kanban row (`PKPS`) stores the reservation or material document number; the board opens it from the kanban.
- **Rationale**: a filter, a report and a reverse link all need a column. A note is for the human who opens the document.

### 4. Two trigger styles: on the stock posting, or on a schedule

- **SAP quantity signal**: the withdrawal posting draws down the kanban's actual quantity; at zero the kanban becomes EMPTY and the strategy fires at once.
- **Epicor**: the posting transaction that drops the bin below its minimum creates the Material Queue record at once.
- **D365 WMS Min/Max**: a batch job, recommended once a day.
- **Odoo**: a daily cron, plus an immediate run when a sales order confirmation pushes the forecast below the minimum.
- **NetSuite WMS**: on-demand "Generate Replenishment" or a scheduled run with a frequency and run window.
- **Rationale**: a shop-floor kanban expects the card to behave like a scan: the signal fires when the bin empties. A daily batch suits a warehouse pick face, not a lineside bin.

### 5. The threshold is strict "below", and the replenish quantity is fixed per signal

- **NetSuite WMS**: "When an item's on-hand quantity in a bin is less than the quantity set in the WMS Replen Min Qty field, NetSuite WMS generates replenishment tasks."
- **Epicor**: "reduce the OH qty in a bin below THAT BIN's minimum".
- **SAP**: event-driven kanban has a fixed kanban quantity; a larger demand is split into several kanbans, each of the fixed quantity.
- **Odoo**: the exception. It orders max − forecast when forecast ≤ min, so the quantity varies.
- **Rationale**: a kanban is a container. A fixed quantity keeps the card, the label and the transfer in agreement.

### 6. Source = destination is refused

- **SAP**: the 311 posting refuses it with `M7 104` "Stock to be removed from storage same as stock to be placed into storage".
- **Odoo**: a parent location and its child cannot both be replenish locations.
- **Rationale**: a transfer into its own source bin moves nothing and loops forever under an automatic trigger.

## Answers to Research Questions

1. **Which entity holds the rule, and what are its fields?** — One rule per (item, destination bin). It holds a source bin, a threshold and a fixed quantity (Pattern 1). Examples: SAP control cycle, Epicor `PartBinInfo`, Odoo orderpoint, NetSuite bin record.
2. **What document does the trigger create, and when does stock move?** — A transfer document that a person picks later. SAP strategy `0001` creates a reservation and posts at FULL; strategy `0002` posts the 311 at once. D365 creates a transfer job, Odoo an Internal Transfers picking in state `confirmed`/`assigned`, Epicor a Material Queue row, NetSuite an RPLN open task. Only SAP `0002` moves stock at signal time.
3. **How does the system avoid a duplicate while a transfer is pending?** — Three ways. Odoo, Fishbowl and D365 WMS net open inbound transfers against the threshold. SAP refuses a second EMPTY signal on the same kanban. Epicor triggers only on the downward edge. See Pattern 2.
4. **How is the automatic transfer told apart from a manual one?** — By an origin field. Odoo uses `origin`, Epicor `TranType`, D365 the work order type or kanban card id. SAP stores the element number on the kanban row. See Pattern 3.
5. **Event or schedule, and what latency?** — SAP and Epicor fire on the posting. D365 WMS and Odoo run daily. NetSuite WMS runs on demand or on a schedule. See Pattern 4.
6. **Which term should Carbon use?** — "Reorder point" is the industry term for a location-level threshold and Carbon already uses it on `itemPlanning`. For a bin-level kanban threshold the systems use "minimum" (Epicor, NetSuite, D365 WMS) or "trigger quantity" (SAP one-card kanban). The user asked for "Replenishment level". See the recommendation.
7. **Does any system check the source bin's stock before it creates the transfer?** — Not found. SAP, D365 and Odoo create the element and let the pick fail or wait (Odoo state `confirmed` = Waiting). NetSuite reports a failed run only when no bin needs replenishment. Carried into the spec as an open question.

## Competitor-Specific Details

### SAP S/4HANA (PP-KAB)

- Stock-transfer strategies: `0001` and `0003` create a reservation and post the 311 at FULL. `0002` posts the 311 at EMPTY. `0006` creates a WM transfer requirement and posts at TO confirmation. Customizing `OM12`.
- The quantity signal (`PK22`) needs no customizing. The system draws down IN USE kanbans first, then the oldest FULL one. At zero the kanban becomes EMPTY and the control cycle's strategy fires. Stock-transfer strategies work with it.
- One-card kanban: a trigger quantity on the control cycle. Replenishment fires when the actual quantity "reaches or falls below" it.
- Statuses: WAIT, EMPTY, IN PROCESS, IN TRANSIT, FULL, IN USE, ERROR. EMPTY only from FULL, IN USE or WAIT (`PK155`). A signal lock in minutes (`AUSSP`) ignores a repeated scan.
- `PK31` kanban correction reverses the last signal: it flags the reservation for deletion and reverses the goods receipt document.
- Partial fill: the user overwrites the actual quantity at FULL.

### Microsoft Dynamics 365 SCM

- Lean: a withdrawal kanban rule's transfer activity holds From location and To location. A fixed-quantity rule creates a new transfer job only when a card is registered Empty, by scan or when the handling unit is received. Alert boundary minimum turns the board red; it creates nothing.
- Warehouse Min/Max: a replenishment template line holds Minimum quantity, Maximum quantity, Replenishment unit (rounding) and a Select products query with a location profile. Fixed locations let an empty location be replenished. The output is work of type Replenishment with a Pick line and a Put line. It runs as a daily batch.

### Epicor Kinetic

- `PartBinInfo` holds a bin minimum and a supply source bin, with cascading: "if bin A is low, pull from bin B; if B is low, pull from C; if C is low, buy or make".
- The posting that drops the bin below its minimum creates a `MtlQueue` row with `TranType = RAU-STK`, `FromWhse`/`FromBinNum`, `ToWhse`/`ToBinNum` and `RequestQty`. A handler selects it on the handheld and processing deletes the row.
- The trigger is edge-based: a bin already below minimum never fires again until it rises above and falls below.
- The Replenishment Workbench (AMM) is a manual pass; one site runs an hourly custom function instead.

### Odoo

- `stock.warehouse.orderpoint`: `location_id`, `product_min_qty`, `product_max_qty`, `route_id`, `trigger = auto | manual`.
- `stock.location.replenish_location` marks a sub-location as a replenishment target; a parent and a child cannot both be set.
- The Pull From route (Operation Type = Internal Transfers, Take From Stock) creates a `stock.picking` with `origin = OP/00012`. States: `draft`, `waiting`, `confirmed`, `assigned`, `done`, `cancel`.
- `qty_forecast` includes confirmed incoming moves, so the next scheduler run creates no duplicate.
- The cron runs daily; `auto` rules also fire on sales order confirmation.

### NetSuite WMS

- Bin fields: WMS Replen Min Qty, WMS Replen Max Qty, WMS Replen Qty, WMS Replen Round Qty. Target = the item's Preferred bin; source = a bulk bin.
- Required = Max − on-hand, rounded down to Round Qty, split into one task per Replen Qty.
- Triggers: a report, "Generate & Release", or a schedule record with frequency and run window. The task is a WMS Open Task of type RPLN; completion converts it to a closed task.
- Base NetSuite's Reorder Point and Preferred Stock Level are per location, never per bin.

### Fishbowl

- Reorder Point ("also known as min") and Order Up To Level ("also known as max") are per location group. No per-bin level exists.
- The Replenish wizard adds parts to one Transfer Order (types Ship, Move, Putaway; statuses Entered, Issued, Fulfilled). It is manual.
- No "created from" field marks a wizard-created transfer.

## Recommended Approach for Carbon

1. **Keep the rule on the `kanban` row.** Carbon's Transfer kanban already holds the item, the source bin (`fromStorageUnitId`), the destination bin (`storageUnitId`) and the fixed `quantity`. Add one column for the threshold. This follows Epicor's `PartBinInfo` and SAP's control cycle (Pattern 1).
2. **Name the threshold "Replenishment Level" in the UI, as the user asked.** Store it as `replenishmentLevel`. Do not reuse "reorder point": Carbon uses that term for the location-level `itemPlanning.reorderPoint`, and one word must keep one meaning. Define it as "a strict minimum: the kanban fires when the destination bin's projected quantity is below this level" (Pattern 5; NetSuite "less than", Epicor "below").
3. **Fire on the stock posting, with a scheduled backstop.** Evaluate the level when an `itemLedger` row lands on the destination bin for a kanban item. SAP's quantity signal and Epicor fire the same way (Pattern 4). Add a low-frequency sweep for the two cases a posting does not cover: a raised level and a deleted transfer.
4. **Net open inbound transfers.** Projected quantity at the destination bin = on-hand + outstanding quantity of Released and In Progress transfers into that bin for the item. Carbon's stock transfer wizard RPC already computes this sum. Create a transfer only when projected < level (Pattern 2; Odoo, Fishbowl).
5. **Replenish the fixed kanban `quantity` per signal.** Do not order up to a maximum. A kanban is a container, and the card's label states its quantity (Pattern 5; SAP, D365, NetSuite Replen Qty).
6. **Mark the transfer with a column and a note.** Add `stockTransfer.kanbanId` as the structural origin (Pattern 3; Odoo `origin`, Epicor `TranType`). Write the requested "Kanban replenishment" note for the person who opens the transfer.
7. **Refuse source = destination at the database.** The zod refine exists today; add a CHECK so an API write cannot create a self-feeding loop (Pattern 6; SAP `M7 104`).
8. **Create the transfer even when the source bin is short.** No surveyed system checks the source bin first; the pick reports the shortage. This matches Carbon's scan path today.

## Sources

- https://help.sap.com/saphelp_470/helpdata/en/cb/7f8e3143b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_470/helpdata/en/cb/7f8e0a43b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_470/helpdata/en/cb/7f8e1743b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_470/helpdata/en/2a/f8378defb711d188b80000e8214d78/content.htm
- https://help.sap.com/saphelp_470/helpdata/EN/cb/7f8ae243b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_470/helpdata/EN/cb/7f8ac843b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_470/helpdata/EN/cb/7f8ad543b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_470/helpdata/en/cb/7f8c9943b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_470/helpdata/en/cb/7f8c5843b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_470/helpdata/EN/cb/7f8d0e43b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_me60/helpdata/en/17/60bd534f22b44ce10000000a174cb4/content.htm
- https://learning.sap.com/courses/configuring-sap-s-4hana-cloud-public-edition-manufacturing-execution/configuring-replenishment-strategies_a88b2e91-7022-4c11-8424-8874468c9cb4
- https://leanx.eu/en/sap/table/pkps.html
- https://www.michaelmanagement.com/sap-error-messages/en/pk/pk155
- https://michaelmanagement.com/sap-error-messages/en/m7/m7104
- https://learn.microsoft.com/en-us/dynamicsax-2012/kanban-rules-form
- https://learn.microsoft.com/en-us/dynamicsax-2012/activity-details-form
- https://learn.microsoft.com/en-us/training/modules/create-process-fixed-kanbans-dyn365-supply-chain-mgmt/4-process
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/replenishment
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/tasks/set-up-min-max-replenishment-process
- https://www.epiusers.help/t/description-of-the-kanban-process/86758
- https://www.epiusers.help/t/stocking-kanban/136817
- https://epiusers.help/t/replenishment-workbench-not-capturing-everything/112040
- https://www.epiusers.help/t/material-queue-to-locations/126261
- https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html
- https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/use_locations.html
- https://raw.githubusercontent.com/odoo/odoo/17.0/addons/stock/models/stock_orderpoint.py
- https://raw.githubusercontent.com/odoo/odoo/17.0/addons/stock/models/stock_location.py
- https://raw.githubusercontent.com/odoo/odoo/17.0/addons/stock/models/stock_picking.py
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2278346.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1541441806.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1541442254.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0807023240.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1541442264.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156382533850.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2305626.html
- https://help.fishbowlinventory.com/advanced/s/article/Transfer-Order
- https://help.fishbowlinventory.com/advanced/s/article/Part
- https://help.fishbowlinventory.com/drive/s/article/Drive-Reorder-Report
- https://www.fishbowlinventory.com/blog/touring-the-transfer-order-module

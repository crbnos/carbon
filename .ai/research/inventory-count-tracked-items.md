# Inventory counts for serial- and batch-tracked items

Research for the Carbon inventory count redesign. Date: 2026-10-30.
Sources are vendor docs where they exist. If only forums or blogs cover a point, the point says "(community)". "Bin" here means a Carbon storage unit.

## 1. How serial lines appear on the count sheet

- **Business Central.** The physical inventory order has ONE line per item + variant + location + bin. The line has a `Use Item Tracking` flag. Expected serials and lots sit in a sub-page (`Item Tracking Lines`), not on the order line. On the recording (the counter's sheet), the docs tell you to `Copy Line` N times and pick one serial per line. So the printed sheet has one line per serial. https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-how-count-inventory-with-documents
- **NetSuite (native Inventory Count).** One line per item + bin. Serials and lots go in a `Count Detail` popup on that line, with a quantity per serial/lot. NetSuite takes the snapshot by bin and serial when the count starts. https://oracle.hydrogen.sagittarius.connect.product.adaptavist.com/en/cloud/saas/netsuite/ns-online-help/section_N2299731.html
- **SAP IM.** One PI document item per material + plant + storage location (+ batch). The counter enters serials on the item while recording the count (MI04). Not one item per serial. https://help.sap.com/saphelp_46C/helpdata/EN/91/cae498049a11d3b6e70000e82de955/content.htm
- **Odoo.** Flat list. Each lot or serial is its own line ("each uniquely-identified product is displayed on its own product line"). No grouping. https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html
- **Acumatica.** Count sheets print one line per serial. Users complain it runs to many pages for one item (community). https://community.acumatica.com/distribution-6/how-to-ignore-serial-numbers-on-physical-counts-20630

Takeaway: the systems that scale (BC order, NetSuite, SAP) hold one line per item+bin and put serials one level down. The flat one-row-per-serial view (Odoo, Acumatica sheets, BC printouts) is exactly the pain Carbon has today.

## 2. Recording serials; missing and unexpected serials

How the counter records:
- **Scan.** Acumatica scan-and-count: you "scan all lot or serial numbers of an item one by one"; each scan sets that line to Entered. https://help.myob.com.au/advanced/Docs/Published/UserGuide/WMS_LotSerial_Tracking_Scan_and_Count.html
- **BC mobile add-ons** prompt for the serial after the item scan (community). https://bc.help.be-terna.com/en-us/docs/business-central/mobile-solutions/reactor-mobile/mobile-physical-inventory/overview/
- **Enter quantity per serial.** NetSuite Count Detail, BC recording lines, Odoo counted quantity (0/1).
- **SAP rule:** serials are entered WITH the count result. "You cannot enter the serial numbers first and then deduce the counted quantity." SAP compares counted serials against stock serials separately from quantity.

Expected serial not found:
- Every system treats it as a negative adjustment for that serial. BC's lot example shows LOT1006 expected 10, recorded 0, posts -10.
- SAP posts a difference for that serial even when the item's total quantity matches. That happens when the counter finds a different serial in its place.

Serial found that was not expected:
- **BC.** If the recording line has no matching order line (item + variant + location + bin), `Allow Recording Without Order` adds a new order line flagged `Recorded Without Order`. Otherwise finishing the recording fails. A tracking value with no expected quantity posts as a positive adjustment (LOT1002 in the docs example: +12).
- **BC on misplaced stock.** "If the physical count reveals differences caused by items posted with incorrect locations, don't enter the differences in the physical inventory journal. Instead, use a reclassification journal or a transfer order." https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-how-count-adjust-reclassify
- **SAP.** If the serial is recorded against a different stock type or location than the material, posting is blocked. The fix is a transfer posting, then a new PI document. SAP never silently creates a serial elsewhere.
- **Odoo.** The adjustment line "can also be used to create or record lots and serial numbers". So an unknown serial becomes a new serial with a positive adjustment.
- **Fishbowl import.** "If the counted tracking doesn't match existing inventory, the import adds new inventory quantities under the supplied tracking." https://help.fishbowlinventory.com/advanced/s/exportCycleCount.html

Pattern: unknown serial = create it with a positive adjustment. Known serial in another bin = move it (transfer or reclass), not a +1/-1 pair.

## 3. Unnumbered units of a serial item

- **NetSuite Smart Count:** `Ignore Serial Number Until Variance`. You count the quantity only. NetSuite asks for serials only when the quantity has a variance. The same exists for lots. https://anchorgroup.tech/smart-count-preferences-and-spot-count
- **Acumatica:** depends on the serial class. With "when received" assignment, the counter must count every serial. With "when used" assignment, serials are not required on the count and the adjustment carries none (community).
- **Katana:** stock with no batch sits in a synthetic "Unbatched" batch. It holds a quantity and can go negative. https://support.katanamrp.com/en/articles/541-what-is-an-unbatched-batch
- **BC:** a dmsiworks blog says you can count lot items without lot detail. It is not in Microsoft's docs. https://dmsiworks.com/blog/count-without-lot-serial-detail-business-central

Pattern: untracked units are a quantity bucket on the item+bin, never N blank serial rows.

## 4. Batch / lot handling

- Every system counts per lot within item+bin (BC tracking lines, NetSuite Count Detail, Odoo line per lot, SAP PI item per batch).
- **Found lot not expected:** BC adds it as a new tracking value with a positive difference. Odoo and Fishbowl create the lot. Katana scanning a batch "not already on the stocktake list" adds a row for it. https://support.katanamrp.com/en/articles/5966970-using-a-barcode-scanner-to-count-stock
- **Missing lot:** negative for its full expected quantity.
- **Net view:** BC shows per-lot +/- and also the item-line totals (`Pos Qty.`, `Neg Qty.`). Lots that net to zero for the item still post both sides.

## 5. Importing count results

- **Fishbowl** (most complete): CSV with `PartNumber` (first column), `Location`, `Qty`, `Date`, `Note`, and one `Tracking-<Name>` column per tracking type (for example `Tracking-Lot Number`). Lots go in the tracking column. Serials go one per line directly under the parent row. Counts use the base UoM. Unknown tracking values create new inventory.
- **Odoo** (community): import into an inventory adjustment with Product, Lot/Serial Number, Location, Quantity, and an optional UoM. https://www.odoo.com/forum/help-1/import-sheet-for-products-273465
- **BC:** `Edit in Excel` on journals. Configuration packages can import order lines by item reference. https://learn.microsoft.com/en-us/dynamics365/release-plan/2023wave2/smb/dynamics365-business-central/improved-processes-inventory-counts-adjustments
- **MRPeasy:** no import of count results was found. Users type counts into the stocktake grid. https://www.mrpeasy.com/et/ressursid/juhend/stock/stocktakes/
- **Common key:** item + location/bin + tracking number (+ quantity). Flat rows (one row per serial, qty 1) are easier to produce than Fishbowl's nested rows.

## 6. Blind counts

- **NetSuite Smart Count:** `Force Blind Count` hides on-hand from the counter. Consultants say it "should almost always be checked". It is a count setting, so the counting screen hides expected quantities while managers still see the variance on approval.
- **Odoo:** no native blind mode. A count request can leave the prefilled quantity blank, but users still see on-hand elsewhere. Add-ons hide on-hand by group (community). https://github.com/odoo/documentation/pull/2556/files
- **BC:** the printed `Physical Inventory List` can omit the calculated quantity. The recording document has no expected quantity column; expected stays on the order.
- **Fishbowl:** the cycle count export includes Qty. Blindness is only by not printing it.

Pattern: blind hides expected quantity and expected serials/lots from the person counting (the recording or the counting screen). Reviewers and approvers see everything. Nobody hides it from everyone.

## 7. Recount on variance (brief)

- **NetSuite Smart Count:** tolerances by amount and/or percent, at location level, then company level. Within tolerance it can auto-approve. `Default Action for On-Hand Change During Count = FORCE RECOUNT` recounts items that moved during the count. Rejecting a native count takes a fresh snapshot and recalculates.
- **SAP:** recount creates a new PI document for the item. EWM tolerance groups limit which differences a user may post in the Difference Analyzer. https://blogs.sap.com/2022/06/17/compare-physical-inventory-im-wm-ewm/
- **BC:** a new recording for the same lines. A line counted twice in one finish raises an error.

## Consensus

- Count document = header + one line per item+bin. Serials and lots sit under that line, not as top-level rows.
- The system freezes the expected snapshot at start. Counters enter counted values against it.
- Missing tracked unit = negative for that unit. Unknown unit = positive that creates it. A unit known in another bin = transfer, not adjust (BC, SAP say so explicitly).
- Quantity and serial identity are separate checks. A serial can be wrong while the total is right (SAP).
- Untracked units of a tracked item are a quantity bucket (Katana "Unbatched", NetSuite "ignore until variance").
- Blind hides expected values from counters only. Approvers see variances.
- Import key is item + location/bin + tracking number + quantity.
- Variance over tolerance goes to recount or approval, not straight to posting.

## Recommendations for Carbon

- Group rows by item + storage unit. The parent row shows expected vs counted totals. Serials and batches expand beneath it. This matches BC, NetSuite and SAP, and removes the 9-identical-rows problem.
- Make scan the main way to count serials. Each scan marks a serial Found. Expected serials not scanned become Missing at completion. Scans of serials not in that bin become Unexpected.
- Resolve Unexpected serials by lookup. Serial exists in another storage unit → offer a transfer (and mark it Missing at the old place, as one move). Serial unknown → positive adjustment that creates the tracked entity. Do not post the in-company case as a -1/+1 pair.
- Give the item+bin group one "unnumbered" quantity field for units with no serial. Show today's "—" units there as a count, not as rows. Count it like an untracked item.
- Count batches per batch row, with "Add batch" for a found batch (new batch → create it on posting). A missing batch posts minus its full quantity.
- CSV import with flat rows: `item`, `storage unit`, `serial or batch` (blank = unnumbered), `counted quantity`. A serial row's quantity defaults to 1. Match on the snapshot. Rows that don't match become Unexpected and use the same resolve flow as scans. Skip Fishbowl's nested serial layout.
- Blind count as a per-count option. It hides expected quantity and expected serial/batch lists on the counting screen and the export for counters. People who review or post the count still see them.
- Later: a tolerance on the count (qty and/or %) that flags lines for recount before posting. Defer it until customers ask.

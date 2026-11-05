# Serial Service Cost Treatment Research: Capitalize or Expense

> Research date: 2026-10-08. Input to the field service spec (not yet written). Question from Brad: when a company services a serialized unit, does the cost raise the unit's inventory value, or is it expensed? Decision already made: shipped serials keep the status `Consumed` (no new status).

## Summary

The research covered two accounting frameworks and six ERPs:
- **Frameworks:** US GAAP (ASC 330, 360, 460, 606, 340-40), IFRS (IAS 2, IAS 16) and US tax (§263A).
- **ERPs:** SAP S/4HANA, Oracle (Depot Repair, Fusion maintenance), Microsoft Dynamics (Business Central, D365), NetSuite, Epicor Kinetic and IFS Cloud.

**The owner of the unit decides the treatment, not the user.** The standards and every ERP agree:

| Owner and classification | Treatment |
|---|---|
| The company owns the unit and holds it for sale (shelf unit, returned unit, exchange core, demo unit held as inventory) | **Capitalize** normal refurbishment and upgrades into the unit's cost, up to net realizable value (NRV). Write down any excess. Expense abnormal rework. |
| The customer owns the unit (shipped, in the field or returned for repair) | **Expense.** Charge the work against the warranty reserve, or to cost of service revenue when the customer pays. The unit never enters inventory value. |
| The company owns the unit as a fixed asset (rental fleet, demo unit held as PP&E) | **Expense** routine servicing. **Capitalize** overhauls, component replacements and betterments into the asset. |

Carbon has most of the parts:
- `trackedEntity` identifies each serial.
- `costLedger.trackedEntityId` (migration `20261006220601_serial-cost-layer.sql`) lets one serial carry its own cost layer.
- `calculateCOGS` relieves a leaving serial's own layer first.

Two parts are missing:
1. Job output and sales-return receipts write layers with no `trackedEntityId`.
2. No code adds cost to one serial.

## Competitors Surveyed

- **SAP S/4HANA**: the refurbishment order (order type PM04) with split valuation, rework in production, and In-House Repair for customer units.
- **Oracle**: Depot Repair repair types, and Fusion maintenance work orders that complete to inventory.
- **Microsoft Dynamics**: Business Central Service Management (service items as the installed base), and D365 return dispositions.
- **NetSuite**: work orders for a refurbished SKU, and specific costing per serial.
- **Epicor Kinetic**: an RMA dispositioned to a job, which keeps the serial.
- **IFS Cloud**: condition codes, cost levels (per part, per condition, per serial) and repair shop orders.

## Key Consensus Patterns

### 1. Refurbishing a unit the company owns is a conversion of inventory

- **SAP**:
  1. Movement 261 issues the defective unit (valuation type C3) to a PM04 order.
  2. Movement 101 receives it back as refurbished (C2).
  3. Settlement (KO88) moves the order's actual cost to the stock: the moving average changes, or a standard-price variance posts.
- **Oracle**: Depot Repair's internal Refurbishment type disables estimates and charges. The WIP job carries the cost into inventory. Fusion maintenance work orders that complete to inventory "debit the Work in Process accounting line type instead of the Maintenance Expense".
- **Business Central and D365**: a production order consumes the item and produces the same item ("we have consumed a bicycle to produce a bicycle with the addition of the new front wheel").
- **NetSuite and Epicor**: a work order or job takes the original serial as a component and produces the refurbished unit.
- **IFS**: a repair shop order reserves the serial and returns the same serial to stock. "Include Service Cost" adds the service cost to the part's value.
- **Rationale**: ASC 330-10-30-1 and IAS 2.10 count every cost "to bring the item to its existing condition and location". Refurbishment and upgrades meet that test. US tax agrees: Reg. 1.263A-2 defines "produce" to include "improve".

### 2. NRV caps the capitalized value

- **Standards**: ASC 330-10-35-1B (ASU 2015-11) and IAS 2.9 value inventory at the lower of cost and NRV. NRV is the selling price less the costs to complete, sell and transport.
  - US GAAP never reverses a write-down. IAS 2.33 allows a reversal.
- **ERPs**: none caps the value automatically. NRV is a separate review step.
- **Practice**:
  1. When a used unit arrives, write it down to its as-is NRV.
  2. Add the refurbishment cost.
  3. Test again against the NRV of the target grade.

### 3. Abnormal rework is an expense

- **Standards**: ASC 330-10-30-7 and IAS 2.16 expense abnormal waste, excess spoilage, double handling and idle capacity.
- **Practice**: normal rework goes into the unit. Abnormal rework goes to a variance account. The company judges where "normal" ends.
- **SAP and Oracle**: under standard cost, the difference between the actual cost and the standard goes to a rework or price-difference variance.

### 4. A customer's unit never enters inventory value

- **SAP**: In-House Repair posts the customer's unit to "non-valuated, customer-specific stock". Labor and parts post to controlling and settle against the invoice revenue. Warranty work settles to a cost center or warranty account.
- **Business Central**: a service item has no inventory value. "Ship and consume" posts warranty work that is not billed.
- **Oracle**: Repair and Return moves the customer's unit on return and ship lines. It is never valued stock.
- **Standards**:

| Case | Treatment | Standard |
|---|---|---|
| Assurance-type warranty | Accrue a reserve at the sale; charge repairs against it | ASC 606-10-55-32; ASC 460-10; ASC 450 |
| Service-type warranty | A separate performance obligation; cost as incurred | ASC 606-10-55-34; ASC 340-40-25-8 |
| Paid repair | Cost of service revenue as incurred; revenue over time. An open repair at period end is a contract asset, not inventory | ASC 606-10-25-27(b) (application not verified) |

- **Exception, exchange**: the customer gets a serviceable unit from stock. Their defective unit becomes company stock as a core, usually at a core value or zero. It then follows pattern 1.

### 5. The serial keeps its identity while its value changes

| Approach | Vendors | Accuracy per unit |
|---|---|---|
| One condition or valuation type per part; units of a condition share one price | SAP split valuation; IFS Cost per Condition | Low |
| A separate SKU for refurbished units; the original serial goes in as a component | NetSuite, Epicor (in practice) | Medium |
| The serial carries its own cost | NetSuite Specific costing; IFS Cost per Serial | High |

In every vendor the serial number stays the same. Only its condition, grade or SKU changes.

### 6. Fleet units follow the fixed asset rules

- **Standards**:
  - IAS 16.12 and ASC 360 expense day-to-day servicing.
  - IAS 16.13–14 and ASC 360 betterments capitalize replacements, major inspections and improvements, and derecognize the replaced part.
  - IAS 16.68A moves a fleet unit to inventory at book value when it leaves rental for sale. Refurbishment after that move follows pattern 1.
- **Carbon precedent**: the projects spec's "late cost after capitalization" rule adds cost to an active asset and depreciates it over the remaining life. A capitalized fleet overhaul is the same posting.

## Answers to Research Questions

1. **Does servicing a shelf serial raise its inventory value?** Yes, for normal refurbishment, repair and upgrades. Cap the value at NRV and write down the excess. Expense abnormal rework (SAP PM04, Oracle WIP completion, IFS Include Service Cost; ASC 330 and IAS 2).
2. **Does servicing a shipped serial raise any inventory value?** No. The customer owns it, and it stays `Consumed`. Cost goes to warranty (reserve or expense), to cost of service revenue, or to the contract project's covered branch (SAP In-House Repair, Business Central service items; ASC 460 and 606).
3. **What about a unit that comes back on an RMA?**
   - A return for credit or replacement makes it company stock again. ASC 606 values it at its former carrying amount less the expected costs to recover it. Refurbishment then raises its value, up to NRV.
   - A return for repair-and-return leaves it the customer's unit. Expense the repair.
4. **Who picks the treatment?** The system, from ownership and classification:
   - inventory owned by the company: capitalize;
   - a customer unit: expense;
   - a fixed asset: expense routine work, capitalize a betterment.

   The user chooses only whether the work on a fixed asset is routine or a betterment, and whether rework is abnormal.
5. **How should Carbon carry one serial's value?** With a stamped `costLedger` layer per serial (specific identification), like NetSuite Specific and IFS Cost per Serial. Carbon already relieves a stamped layer first. It does not need SAP-style split valuation.

## Competitor-Specific Details

### SAP S/4HANA
- **Refurbishment order setup:** order type PM04, created with IW81 and received with IW8W. Split valuation C1 new, C2 refurbished, C3 defective. Many companies value C3 at zero.
- **Rework in production:** add operations to the original order, or create a rework order that settles to the original order.
- **Customer repairs:** classic repair sales order RA/RAS with service order SM03. S/4 In-House Repair (2.0 from 2023 FPS02) runs on service orders and confirmations.
- **Serials:** an equipment record (EQUI) keeps the serial number across valuation types.

### Oracle
- **Repair types:** Repair and Return, Exchange, Advance Exchange, Replacement, Refurbishment.
- **Fusion completion costing:** average cost divides the total cost by the assets completed. Standard cost posts a Rework Variance.

### Microsoft Dynamics
- **Business Central:** a service item holds the serial, warranty dates, contracts and service history. It is created at shipment by the service item group.
- **D365 return dispositions:** Credit, Replace and credit, Return to customer, Scrap. A replacement order can create a production order to repair the returned item.

### NetSuite and Epicor
- **NetSuite:** keeps a refurbished SKU with the original serial, often with a suffix. Specific costing keeps the value per serial, per item and per location.
- **Epicor:** an RMA to a job issues the part "automatically with its existing SN". Users report average costing forced a separate part number for reworked parts.

### IFS Cloud
- **Condition codes:** New, Repaired, Overhauled, Core. A condition change moves value between conditions.
- **Cost per Serial:** each unit has its own value. IFS forces standard cost at this level.
- **Exchange:** single swap and double swap (an advance loaner).

## Carbon today

| Fact | Where | Effect |
|---|---|---|
| A serial's own cost layer | `costLedger.trackedEntityId`, migration `20261006220601_serial-cost-layer.sql` | Specific identification is possible |
| Relief order | `calculateCOGS` → `orderLayersForConsumption` (`packages/server-functions/src/lib/cost-layer-order.ts`) | A leaving serial's own layer goes first, then unstamped layers, then other serials' layers |
| Job output | `complete_job_to_inventory` writes one `Output` layer per completion, with no `trackedEntityId` | Job-made serials share one layer |
| Sales return receipt | `post-receipt` "Sales Return Order" writes one `Sale` layer with no `trackedEntityId`, at the original outbound cost, the current cost, or zero (`returnReason.inventoryValueZero`) | Returned serials share one layer |
| A child cost row on a layer | Purchase price variance (`post-purchase-invoice`, `allocateVarianceAcrossLayers`) inserts `adjustment: true` rows with `appliesToCostLedgerId` | The same pattern can add refurbishment cost to one serial's layer |
| `costLedgerType 'Revaluation'` | Enum only; no code writes it | Free for refurbishment rows |
| Serial-first order in SQL | `backflush_job_materials` has no serial ordering | A gap if refurbishment consumes through backflush |
| NRV and reserves | Account 1240 "Inventory Reserves / Allowances" exists in the seed chart; nothing uses it | No write-down path |
| Costing methods | Standard reads `standardCost`; Average reads `itemCost.unitCost`; FIFO/LIFO read layers | Only FIFO/LIFO can give one serial its own value |
| Warranty | Only a `Warranty` return reason label | No reserve, no warranty dates |

## Recommended Approach for Carbon

1. **Let ownership decide the treatment.** A service order reads its subject serial's ownership and classification:
   - company inventory → capitalize;
   - a `Consumed` serial at a customer → expense;
   - a fixed asset → routine expense or betterment.

   Follows the standards and every ERP surveyed.
2. **Refurbish own stock through a job that outputs the same serial.**
   1. Issue the serial to the job through `issue` with its `trackedEntityIds`.
   2. Complete the same `trackedEntity` as the output.
   3. Write the output layer **stamped** with `trackedEntityId`, at the relieved layer's cost + labor + materials + overhead.

   This is how SAP PM04, Oracle WIP completion, Business Central and IFS repair shop orders work. Without the stamp, the value goes into the shared FIFO pool, and the next shipment can take it.
3. **Stamp serial layers at job output and at sales-return receipt.** Today both are unstamped, so a returned or job-made serial has no layer of its own to add cost to. Stamping one layer per serial, at the same unit cost, changes no value.
4. **Check NRV at completion.**
   1. Compare the serial's new cost with its expected selling price less costs to sell (a value on the item, or entered on the service order).
   2. If the cost is higher, post a write-down: Dr an inventory write-down account / Cr inventory, stamped to the serial.

   This follows ASC 330-10-35-1B and IAS 2.9; no ERP automates it. Account 1240 or a new `accountDefault` holds the write-down.
5. **Allow "abnormal rework" on the service order.** When flagged, the cost posts to a rework variance account, not to the unit (ASC 330-10-30-7, IAS 2.16).
6. **Handle each costing method:**
   - FIFO/LIFO: the stamped layer carries the serial's value.
   - Average: re-average `itemCost.unitCost`. Average cannot keep a per-serial value, so the UI says so.
   - Standard: the unit stays at standard, and the difference posts to the rework variance (SAP, Oracle, IFS).
7. **Keep customer units out of valuation.**
   - A depot repair receives the customer's serial with no `itemLedger` value and no `costLedger` row. It stays `Consumed` and is never available to pick.
   - Labor and parts post to the service order: cost of service revenue when paid, warranty when covered. A contract's covered branch works through the projects charge number.
8. **Treat exchange as two lines.** The ship line relieves a serviceable serial at its own layer. The return line receives the customer's unit as company stock at a core value (default zero) and then follows recommendation 2. Follows SAP C3 valuation and Oracle and IFS exchange.
9. **Use the fixed asset path for fleet units.**
   - Routine service posts to maintenance expense (the existing maintenance account).
   - A betterment adds to the asset's cost through the "late cost after capitalization" posting in `.ai/specs/2026-10-03-projects.md`.

## Decisions (Brad, 2026-10-08)

- **No condition attribute** on `trackedEntity`. The serial's cost layer and its history tell its story.
- **No refurbished SKU.** A refurbished unit stays the same item and the same serial.
- **Warranty work is expensed** as it happens. Carbon does not accrue an ASC 460 warranty reserve at the sale in v1.
- **The NRV check uses the item's sale price** (`itemUnitSalePrice.unitSalePrice`), with no new item field. A service order can override it with an "expected selling price" when a refurbished unit will sell for less. If the item has no sale price and the order has no override, the check is skipped and the order shows a warning. Selling costs are not subtracted in v1. Chosen by the author at Brad's request ("the best option").

## Sources

Accounting
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/inventory/Inventory-Guide/Chapter-1-Inventory-costing/1_3_Cost.html
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/inventory/Inventory-Guide/Chapter-1-Inventory-costing/1_5_Other.html
- https://storage.fasb.org/fas151.pdf
- https://storage.fasb.org/ASU%202015-11.pdf
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/revenue_from_contrac/revenue_from_contrac_US/chapter_8_practical__US/82rights_of_return_US.html
- https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-5-step-2-identify-performance/5-5-warranties
- https://dart.deloitte.com/USDART/home/codification/liabilities/asc450-10/deloitte-s-roadmap-contingencies-loss-recoveries/chapter-5-guarantees/5-6-product-warranties
- https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-13-contract-costs/13-3-costs-fulfilling-a-contract
- https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2024/issued/ias16.html
- https://www.iasplus.com/en/standards/ias/ias2
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/property_plant_equip/property_plant_equip_US/chapter_1_capitaliza_US/11_overview__1_US.html
- https://www.ecfr.gov/current/title-26/chapter-I/subchapter-A/part-1/subject-group-ECFR210006225231fb0/section-1.263A-2
- https://www.law.cornell.edu/cfr/text/26/1.263(a)-3
- https://www.houseblend.io/articles/inventory-write-down-reversal-gaap-ifrs

ERPs
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/efc7922405fd4d56b7571930c5eaa798/44cab65334e6b54ce10000000a174cb4.html
- https://leantech.com/post/sap-pm-refurbishment-process
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/settlement-options-in-refurbishment-order/ba-p/13274723
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/9d794cbd48c648bc8a176e422772de7e/f437d220829a4334976cd81c3b055a04.html
- https://docs.oracle.com/cd/E26401_01/doc.122/e48965/T231848T344627.htm
- https://docs.oracle.com/en/cloud/saas/readiness/scm/24c/inv24c/24C-inventory-wn-f33528.htm
- https://learn.microsoft.com/en-us/dynamics365/business-central/service-service-posting
- https://archerpoint.com/rework-production-orders-microsoft-dynamics-nav/
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/sales-returns
- https://netsuiteprofessionals.com/blog/answer/re-work-orders-for-refurbished-products/
- https://www.techfino.com/blog/netsuite-lot-tracking-costing-methods
- https://www.epiusers.help/t/serial-number-from-rma-to-job/121054
- https://docs.ifs.com/ifsclouddocs/25r2/lang/en/MaintainInventory/AboutConditionCodes.htm
- https://docs.ifs.com/ifsclouddocs/26r1/MaintainInventory/AboutValuationMethodsAndCostLevels.htm
- https://wssifshelp.wilhelmsen.com/ifsdoc/documentation/en/WorkProcessing/AboutExternalRepairOrders.htm

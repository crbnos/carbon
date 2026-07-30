# Inventory Value Report Research: Best Practices Survey

## Summary

Surveyed how SAP (S/4HANA + Business One), NetSuite, Dynamics 365 Business Central,
Fishbowl, and Odoo build inventory valuation reports — grouping by location and item,
as-of-date valuation, costing-method handling, GL tie-out, and interactivity. The
industry consensus: valuation reports are built by **replaying an immutable
quantity/value ledger** (never a snapshot table alone), the canonical drill hierarchy
is **two levels (summary by location or item → transaction detail)**, every vendor
ships a **GL tie-out** view because item-subledger vs GL divergence is the #1 support
issue, and there is a well-understood industry split between **accurate historical
valuation (replay ledger values)** and **fast approximate valuation (historical qty ×
current cost)** — SAP ships both and documents the difference. Carbon already has the
raw materials: `itemLedger` (quantity), `costLedger` (value + `costPostedToGL`),
`itemCost.unitCost`, and an existing-but-unused `get_inventory_value_by_location` RPC
(migration `20260325031223_inventory-value-report.sql`) that no app code calls today.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference: MB52/MB5B/MB5L transaction family, Fiori F1422 apps, Material Ledger.
- **SAP Business One** — SMB manufacturing reference: Inventory Audit Report (OINM transaction replay), Valuation Simulation report.
- **NetSuite** — cloud mid-market reference: Inventory Valuation Summary/Detail pair, Stock Ledger.
- **Dynamics 365 Business Central** — the cleanest ledger data model (item ledger + value entries); its Inventory Valuation report (1001) and Power BI by-Item/by-Location apps map almost 1:1 to Carbon's ledger design.
- **Fishbowl** — SMB inventory point solution; notable for Location/Item as the exactly-two Group By options (matching this feature request verbatim) and costing-method-as-report-parameter.
- **Odoo** — open-source reference: stock valuation layers (SVLs), "Valuation at Date", per-category costing method. Notably **cannot** value by location in core — a documented gap users complain about.

## Key Consensus Patterns

### 1. Two parallel ledgers: quantity and value are separate records
- **SAP**: material documents (MSEG) carry quantity; valuation (MBEW/ACDOCA Material Ledger) carries value. Value exists only at plant level; storage-location "value" is derived qty × plant price.
- **Business Central**: Item Ledger Entries carry quantity; Value Entries carry cost. One item ledger entry has many value entries (direct cost, revaluation, variance, adjustment).
- **Odoo**: stock moves carry quantity; stock valuation layers carry value.
- **Carbon equivalent**: `itemLedger` (quantity, has `locationId`/`storageUnitId`) + `costLedger` (cost, `costPostedToGL` — but **no `locationId`**). Carbon's value ledger is company-grained; per-location value must be derived as qty × unit cost. (See the Per-Location Costing addendum below — SAP is location-blind only *below* the plant; it does cost per plant.)
- **Rationale**: cost corrections (late invoices, revaluations, variances) arrive after the physical movement; separating them keeps quantity history immutable while value history accretes.

### 2. Grouping: location and item are THE two primary dimensions
- **Fishbowl**: Inventory Valuation Summary has exactly two Group By options — **Location** (default) and **Item** — each with group subtotals.
- **Business Central**: Power BI app ships "Inventory Valuation by Item" and "Inventory Valuation by Location" as separate pages.
- **NetSuite**: item-grained by default; location added via report customization ("Group With Previous Column") or the Stock Ledger.
- **SAP MB52**: hierarchical display plant → storage location → material with totals per level.
- **Rationale**: finance asks "what's the value at each site" (balance-sheet by warehouse); operations asks "where is this item and what's it worth". Both views over the same rows.

### 3. Summary → Detail is the canonical drill-down
- **NetSuite**: Valuation Summary (one row per item: qty, value, % of total) → click through to Valuation Detail (per-transaction costing rows).
- **SAP B1**: Inventory Audit Report rows drill to the originating document via link arrows.
- **BC**: Inventory – G/L Reconciliation matrix drills from any total to the underlying value entries.
- **Odoo**: valuation list grouped by product expands to the individual valuation layers; reference links open the stock move.
- **Rationale**: the summary answers "how much"; the detail answers "why" — troubleshooting bad costs requires seeing the transactions that produced the number.

### 4. As-of-date valuation: replay the ledger, with a documented fast/accurate split
- **BC** (gold standard): sum `Cost Amount (Actual)` value entries with a posting-date filter — exact and reproducible because value entries are immutable, dated facts; corrections are new entries, never updates.
- **SAP MB5B**: replays material documents backwards from current stock; period-end snapshot tables (MBEWH) accelerate it. Fiori apps instead use **historical qty × current price** for speed, and SAP documents that both semantics exist.
- **NetSuite**: can run for a past date but replays *current* transaction state — documented limitation that historical average cost is not reproduced.
- **Odoo**: "Valuation at Date" filters SVLs by date (with quirks: remaining-qty columns stay current).
- **Fishbowl**: as-of date filters costing layers but "cost values are based on today's costs" in the base report.
- **Rationale**: only ledger replay is audit-grade; qty-at-date × current-cost is the accepted cheap approximation. Vendors that conflate the two without documenting it generate support tickets.

### 5. GL tie-out is a first-class feature, not an afterthought
- **SAP MB5L**: three columns — MM value, GL stock-account balance, variance (should be 0).
- **BC**: report shows `Cost Posted to G/L` next to `Ending Value` ("should be equal; if not, run Post Inventory Cost to G/L"); a dedicated Inventory – G/L Reconciliation matrix explains discrepancies.
- **NetSuite**: documented reconciliation procedure (GL detail filtered to Item = empty finds item-less JEs).
- **Fishbowl**: valuation report explicitly framed as "THE report to compare to your QuickBooks balance sheet".
- **Rationale**: the universal failure mode is transactions hitting the inventory GL account without touching the item subledger (manual JEs), or subledger movements not yet posted. Carbon's `costLedger.costPostedToGL` column exists for exactly this comparison.

### 6. Costing method is a per-item posting-time property; the report displays, it doesn't choose
- **NetSuite/BC/SAP**: method lives on the item (or material master / product category in Odoo); one report freely mixes FIFO/Average/Standard items; the displayed unit value ≈ value ÷ qty regardless of method.
- **Fishbowl** is the outlier: costing method is a *report parameter* (render the same stock under any method) — a what-if tool, like SAP B1's Valuation Simulation report.
- **Standard-cost items**: variances post to variance GL accounts and are excluded from inventory value everywhere.
- **Carbon equivalent**: `itemCost.costingMethod` per item; `itemCost.unitCost` is the current cost used for valuation; `calculateCOGS` walks `costLedger` for FIFO/LIFO at shipment.

### 7. Standard column set
Across all five vendors the summary columns converge on: **item (id + description), quantity on hand, unit of measure, unit cost, total value**, plus optionally **% of total value** (NetSuite) and group subtotals. Period-movement variants add **beginning value + increases − decreases = ending value** (BC 1001, NetSuite Stock Ledger).

## Answers to Research Questions

1. **What grouping dimensions, and what drill hierarchy?** Location and item are the two primary groupings (Fishbowl offers exactly these two; BC ships one Power BI page per dimension). Secondary dimensions: item category/posting group (BC subtotals by Inventory Posting Group; SAP by valuation class → GL account), lot/serial (Odoo opt-in). Hierarchy: group summary → item rows → transaction detail.
2. **How is as-of-date valuation computed?** Ledger replay with posting-date filter (BC value entries, SAP MB5B, Odoo SVLs) is the accurate method; historical qty × current cost (SAP Fiori, Fishbowl) is the documented fast approximation. Snapshots (SAP MBEWH, Carbon's `itemLedgerSnapshot` materialized view) are an acceleration, not the source of truth.
3. **How do costing methods shape the report?** Method is a per-item property; the report shows value ÷ qty as unit cost for all methods. Standard-cost items show frozen standard; variances live in GL variance accounts, not inventory value. Only Fishbowl/SAP B1 offer method-as-parameter simulation reports.
4. **How does the report tie out to GL?** A dedicated comparison of subledger value vs GL inventory-account balance (SAP MB5L's Materials/Stock Account/Variance columns; BC's Cost Posted to G/L column + reconciliation matrix). Documented discrepancy causes everywhere: manual JEs to inventory accounts, unposted subledger costs, date/period mismatches.
5. **What interactivity is standard?** Filters (location, item, category, date), group-by toggle, expand/collapse groups, drill-through to source transactions/documents, CSV/Excel export, saved customization. Modern implementations (Fiori, Power BI, Odoo pivot) add free pivoting and charts.
6. **Terminology and columns?** "Inventory Valuation" is the universal report name (NetSuite/BC/Fishbowl all use it; SAP B1 says "Inventory Audit"). Columns: item, description, qty on hand, UoM, unit cost, total value, % of total; movement variants add beginning/increase/decrease/ending.

## Competitor-Specific Details

### SAP S/4HANA
- MB52 (stock on hand w/ value), MB5B (stocks for posting date — replay), MB5L (GL tie-out, period-granular only), CKM3 (Material Ledger price analysis). Fiori F1422 "Material Inventory Values – Balance Summary".
- Value only exists at valuation-area (plant) level; storage-location value is qty × plant price — precedent for Carbon deriving storage-unit value the same way.
- Ships both historical-accurate (MB5B) and current-price-fast (Fiori) semantics, documented.

### SAP Business One
- Inventory Audit Report replays OINM rows: posting date, doc, item, warehouse, receipt/issue qty, cost, **cumulative qty, cumulative value** — running-balance presentation. Explicitly "does not recalculate costs; displays what was posted."
- Group by Warehouse is a checkbox; warned against when item cost is managed at company level (Carbon's cost is company-level too — same caveat applies).
- Valuation Simulation report = what-if under any method for a key date.

### NetSuite
- Valuation Summary columns: Item, Description, Value ($), % of Total Value, Qty On Hand, Unit Value (landed cost included). Click qty → Detail report (per-transaction costing).
- Past-date runs replay current transaction state; average cost not recalculated as-of — documented limitation. Backdated transactions trigger forward cost recalculation (hourly engine).
- Valuation report runs on transaction **date**; Balance Sheet on **period** — documented source of tie-out mismatch.

### Dynamics 365 Business Central
- Value-entry model is the cleanest precedent for Carbon: quantity ledger + value ledger, `Cost Amount (Actual)` vs `Cost Amount (Expected)` (received-not-invoiced), summed by posting date → exact retroactive valuation.
- Report 1001 columns: beginning qty/value + increases − decreases = ending qty/value, plus **Cost Posted to G/L** ("should equal Ending Value").
- "Adjust Cost – Item Entries" batch job must run before the report is trusted — cost corrections are forwarded to consumers as new adjustment value entries; closed periods never change (adjustments land in the next open period).
- NA-localized report 10139 adds "Breakdown by Location" / "Breakdown by Variants" and "As of Date".

### Fishbowl
- Inventory Valuation Summary: Group By = **Location | Item** (exactly the two axes requested for Carbon); Location Total / Item Total subtotal bands; "Show Location Details" toggles child-location rollup.
- Costing method is a report parameter — same stock rendered under Average/FIFO/LIFO/Standard.
- Columns: Item, Qty, UOM, Unit Cost, Asset Value (= qty × unit cost).

### Odoo
- Stock valuation layers (immutable value records per validated move); list/pivot/graph views; "Valuation at Date" popup.
- **No location dimension on valuation in core** — the most-complained-about gap; community modules fill it. Carbon can beat this out of the box because `itemLedger` is location-grained.
- Costing method per product category; changing it posts revaluation layers (negative + positive pair).

## Recommended Approach for Carbon

1. **Name it "Inventory Valuation"** and put it under the Inventory module's reporting area — the term is universal across NetSuite, BC, and Fishbowl.
2. **Follow Fishbowl's exactly-two-groupings model for v1**: a single report with a Group By toggle — **by Location → item rows** (default) and **by Item → location rows** — each with group subtotals and a grand total. This matches the user's ask verbatim and is the industry-minimal viable shape.
3. **Current-value computation: qty × `itemCost.unitCost`** (the SAP-Fiori/Fishbowl semantics), building on the existing `get_inventory_value_by_location` RPC (`20260325031223_inventory-value-report.sql` — currently dead code, no app callers) but fixing its known gaps: make it status-aware (exclude Rejected tracked entities, matching `get_inventory_quantities`), and use the `itemLedgerSnapshot` + delta pattern from `20260713235406` for performance. Carbon's cost is company-level (like SAP B1), so per-location value is qty × company unit cost — same documented caveat.
4. **Standard column set**: item readableId, name, qty on hand, UoM, unit cost, total value, % of total (NetSuite), with subtotal rows per group and a grand total.
5. **Defer as-of-date valuation to a follow-up** unless required now: audit-grade as-of requires BC-style replay of `costLedger` by `postingDate` (Carbon's costLedger lacks `locationId`, so historical *by-location* value would need qty-at-date × current-cost approximation — the documented SAP Fiori semantics). If shipped, label the semantics explicitly like SAP does.
6. **Interactivity v1**: location filter, item-group/search filter, group-by toggle, expand/collapse groups, CSV export (Carbon has `.ai/rules/table-csv-export.md` conventions), drill-through from an item row to its item ledger / inventory detail page.
7. **Plan for (not necessarily build now) a GL tie-out panel**: `SUM(costLedger.costPostedToGL)` vs the inventory GL account balance, following the AR/AP workbench precedent (`receivables.tsx` tie-out panel) — every surveyed vendor treats this as the companion feature, and Carbon's AR/AP aging reports already established the workbench UI pattern.
8. **UI precedent**: clone the AR/AP workbench pattern (`apps/erp/app/routes/x+/invoicing+/receivables.tsx` — loader with `requirePermissions` + service functions + workbench component), not a new design from concepts.

## Addendum: Per-Location Costing (2026-07-14 follow-up)

Follow-up question raised during the feature run: *should Carbon add `locationId` to
`costLedger`?* Answered from competitor practice plus a read of Carbon's actual
posting code.

### What competitors do

- **SAP S/4HANA**: costs **per plant**. Valuation is keyed to the valuation area
  (normally the plant); the material master carries a separate moving-average or
  standard price per material per plant (MBEW). Below the plant, storage locations
  carry quantity only — their "value" is derived qty × plant price. Mapping: SAP
  plant ≈ Carbon `location`; SAP storage location ≈ Carbon `storageUnit`. So at
  Carbon's `location` grain, SAP *is* location-costed.
- **NetSuite**: costs **per location** with Multi-Location Inventory — MLI "tracks
  purchasing costs, stock levels, and valuation for each item in each location";
  average cost is a separate weighted average per location; cost-layer behavior
  depends on a preference for cost held per item vs per location. **Group Average**
  exists to opt a set of locations back into one shared average.
- **SAP Business One**: configurable — item cost at company level *or* per warehouse.
- **Business Central**: average cost calculated "per item" or "per item + location +
  variant"; value entries carry a Location Code.
- **Odoo**: the outlier — no location dimension on valuation in core.
- **Carbon today**: company-level (`itemCost.unitCost` per item per company) — like
  SAP B1's company-level mode and Fishbowl.

### What Carbon's costing engine actually does (code-grounded)

- `costLedger` rows are **FIFO/LIFO cost layers**, not just journal-style entries:
  they carry `remainingQuantity` (drawn down on consumption), `nominalCost`, and
  `appliesToCostLedgerId` (variance adjustment children created by purchase
  invoices). Writers: `post-receipt`, `post-shipment`, `post-purchase-invoice`,
  `post-sales-invoice`, `issue`, `update-purchased-prices`,
  `shared/purchase-cost-adjustment.ts`.
- **Layer consumption is company-wide.** `calculateCOGS`
  (`packages/database/supabase/functions/shared/calculate-cogs.ts:65`) selects
  layers by item + company with **no location filter** — a shipment from Location B
  can consume a layer created by a receipt into Location A.
- **Transfers move quantity, not value.** `post-stock-transfer` writes only
  `itemLedger` rows; zero `costLedger` entries.
- **Revaluations are company-scoped.** `update-purchased-prices` and invoice
  variance adjustments reprice layers with no location allocation.

### Decision (recorded for the spec)

**Do not add `locationId` to `costLedger` for this feature.** Stamping the column
without redesigning the engine would produce per-location sums that never balance
(cross-location layer consumption → phantom value at the receiving location,
negative at the shipping one; transfers would silently strand value at the source).
The "informational-only" middle ground was also rejected: partially-populated data
(old rows null, transfers absent) invites people to sum and trust it.

- **v1 report semantics**: per-location value = on-hand qty by location (from
  `itemLedger`, which is location-grained and exact) × company-level
  `itemCost.unitCost`. Same semantics as SAP below-plant, SAP B1 company-level mode,
  and Fishbowl. Historical company-level value remains exact via
  `costLedger.postingDate` replay.
- **Deferred, industry-validated follow-up**: true per-location costing as its own
  spec — per-item-per-location cost master, location-scoped layer consumption in
  `calculateCOGS`, paired cost entries on transfers, and a revaluation allocation
  policy (`costLedger.locationId` falls out of that design naturally). The report's
  data contract should keep a per-row `unitCost` so a location-specific cost can
  slot in later without reshaping the UI.

### Addendum sources

- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2303574.html (NetSuite Multi-Location Inventory)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2194541.html (NetSuite LIFO/FIFO and Advanced Receiving)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2191818.html (NetSuite Costing Methods)
- https://help.sap.com/docs/SAP_ERP/56f7319a9048445eb86221af73cab72b/6a5eb6531de6b64ce10000000a174cb4.html (SAP price control / valuation area)
- https://learning.sap.com/courses/managing-logistics-in-sap-business-one/exploring-the-inventory-valuation-methods-in-sap-business-one (SAP B1 per-warehouse item cost)
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-average-cost (BC average cost per item/location/variant)

## Sources

### SAP
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/5e23dc8fe9be4fd496f8ab556667ea05/6c1f050e52914a3bb46717ef4f807e86.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/91b21005dded4984bcccf4a69ae1300c/59bf7e548af58e4ce10000000a4450e5.html
- https://help.sap.com/docs/SAP_ERP/56f7319a9048445eb86221af73cab72b/6a5eb6531de6b64ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/4522e91373c80108e10000000a114a6b.html
- https://help.sap.com/docs/SAP_BUSINESS_ONE/87e1767ca7584b8f8d60775347637b07/f241a76a746f497699eed703763a9f0b.html
- https://fioriappslibrary.hana.ondemand.com/sap/fix/externalViewer/?appId=F1422
- https://userapps.support.sap.com/sap/support/knowledge/en/3211374
- https://community.sap.com/t5/enterprise-resource-planning-q-a/mb5b-valuated-stock-report-by-sloc-material-storage-location-will-be-reset/qaq-p/9269164
- https://community.sap.com/t5/enterprise-resource-planning-q-a/mb5l-transaction-list-of-stock-values-balances/qaq-p/2688453
- https://community.sap.com/t5/application-development-and-automation-blog-posts/how-to-get-stock-on-posting-date-manually-and-programmatically/ba-p/13580392
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/working-with-inventory-audit-report/ba-p/13369410
- https://community.sap.com/t5/technology-blog-posts-by-members/a-comprehensive-guide-to-sap-s-4hana-material-ledger-amp-integrated/ba-p/14224569
- https://blogs.sap.com/2012/11/30/getting-opening-and-closing-quantities-of-stock-with-accuracy-of-mb5b/
- https://www.erpgreat.com/materials/variances-between-material-and-account-of-stock-when-you-use-mb5l.htm
- https://www.profzilla.com/articles/post/sap-t-code-mb5l-closing-inventory-report-in-value-quantity-terms
- https://softat.co.in/mb52-tcode-in-sap/
- https://blog.vision33.com/how-to-leverage-the-inventory-audit-report-in-sap-business-one
- https://www.sap-business-one-tips.com/en/inventory-audit-report-not-match-with-gl-account-balance/
- https://sap-b1-blog.com/en/glossary/inventory-valuation-simulation-report-sap-business-one/
- https://learning.sap.com/courses/managing-logistics-in-sap-business-one/exploring-the-inventory-valuation-methods-in-sap-business-one

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2358933.html (Inventory Valuation Summary)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2359248.html (Inventory Valuation Detail)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2191818.html (Costing Methods)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2197365.html (Inventory Costing Recalculations)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N720282.html (Report Footer Options)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4521145431.html (Stock Ledger)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1456591.html (Period Close inventory tasks)
- http://www.netsuiterp.com/2018/09/reconcile-inventory-valuation-report.html
- https://www.houseblend.io/articles/netsuite-inventory-costing-methods
- https://www.anchorgroup.tech/blog/netsuite-average-cost-method-inventory-valuation
- https://technologyblog.rsmus.com/technologies/netsuite/netsuite-reporting-dates-or-periods-part-1/

### Dynamics 365 Business Central
- https://learn.microsoft.com/en-us/dynamics365/business-central/reports/report-1001
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-inventory-valuation
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-expected-cost-posting
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-reconciliation-with-the-general-ledger
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-cost-adjustment
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-costing-methods
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-to-post-inventory-costs-to-the-general-ledger
- https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-valuation-powerbi-app
- https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-valuation-powerbi-inventory-valuation-by-item
- https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-valuation-powerbi-inventory-valuation-by-location
- https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-valuation-powerbi-kpis
- https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/d95f870441365db61f6456ed36b2609c3f1c0fad/BaseApp/Source/Base%20Application/Inventory/Reports/InventoryValuation.Report.al
- https://usedynamics.com/business-central/finance/reconcile-inventory/

### Fishbowl
- https://help.fishbowlinventory.com/drive/s/article/Drive-Inventory-Valuation-Summary-Report
- https://help.fishbowlinventory.com/drive/s/article/Drive-Costing-Methods
- https://tarabyte.com/fishbowl-inventory/controllers-toolbox-the-valuation-reports/
- https://fishbowlhelp.com/files/Reconciling-Discrepancies.pdf

### Odoo
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/using_inventory_valuation.html
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/inventory_valuation_config.html
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/reporting/aging.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/cheat_sheet.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/reporting/locations.html
- https://www.odoo.com/forum/help-1/odoo-16-location-wise-report-at-particular-inventory-date-261818

# Project Items View Research: Best Practices Survey

## Summary

This survey asks one question: how does an ERP show the items of a project? It covers SAP S/4HANA, IFS Cloud, Dynamics 365, Business Central, Acumatica, Deltek Costpoint, NetSuite and Epicor Kinetic. Five of them (SAP, IFS, Dynamics 365, Business Central, Acumatica) give a project-wide item list. In each of the five, one row is one item on one task. The list shows the lifecycle as quantity columns side by side: required, ordered, received, issued and open. The list shows the task as a column or as a tree.

Carbon already stores all of this data in about 10 tables. But no Carbon page lists the items of a project. The item page does not list its projects either. The recommendation is a new **Materials** page on the project, built on the plan lines (`projectElementMaterial`). The page also shows the issues that have no plan line. The item's Used In tab gets a **Projects** group.

This file says "task" for a competitor's activity, project task or WBS element. Carbon calls the same thing an element.

The data model (WBS, project stock, grouping, pegging) is in `.ai/research/projects-wbs-pmmo.md`. This file covers only the view.

## Competitors Surveyed

- **SAP S/4HANA (PS, ProMan)** — the enterprise reference. ProMan (`CNMM`) is the best-known project material monitor.
- **IFS Cloud** — a leader in project-based manufacturing. It has a material list per activity and one per project.
- **Dynamics 365 Finance & SCM** — item requirements on a project, with a reference to the covering order.
- **Business Central** — the simplest model: planning lines of type Item under a project task.
- **Acumatica** — Project Materials (`PM306500`, 2026 R1) is the newest purpose-built screen in the survey.
- **Deltek Costpoint** — the government-contracting reference. Every stock row has a project.
- **NetSuite** — the mid-market reference. It tracks project purchasing only at transaction level.
- **Epicor Kinetic** — a discrete-manufacturing reference. Its public sources are community posts only.

## Key Consensus Patterns

### 1. One row is one item on one task

- **SAP**: ProMan shows one material component (reservation item) per row. CN52N lists the same rows.
- **IFS**: Project Materials and Services shows one demand line per row. Each line sits on one activity.
- **Business Central**: Project Planning Lines shows one line of type Item per row, under a project task.
- **D365**: Item requirements shows one line per row. Each line has an Activity number.
- **Acumatica**: Project Materials shows one item for one project task per row.
- **Rationale**: The plan says what each task needs. A row per item and task keeps the link to the task. The task owns the budget and the cost.

### 2. The lifecycle shows as quantity columns, not as one status

- **SAP**: ProMan puts requirement, PR, PO, stock and withdrawn quantities side by side. SAP gives no single status for the line. The "open" quantity comes from required minus withdrawn.
- **Acumatica**: The row has Required Qty., Qty. on Orders, Qty. Awaiting Delivery, Qty. Procured, Qty. Dispatched and Qty. Used. It also has a derived Status with 6 values: Pending Procurement, Awaiting Delivery, Ready for Dispatch, On Hold, Completed, Canceled.
- **Business Central**: The row has Quantity, Qty. Posted, Remaining Qty., Reserved Quantity and Qty. Picked.
- **D365**: The row has Quantity, Reservation, Picked, Delivered, Consumed and Remaining consumption.
- **IFS**: The row has Required Quantity and Issued Quantity, with committed and used cost.
- **Rationale**: One item can be partly ordered, partly received and partly issued at the same time. Only quantity columns show that state. A derived status helps the user sort and filter.

### 3. Each row links to its supply document

- **SAP**: ProMan has an Orders/Documents overview with PR, PO and material document numbers.
- **D365**: Reference type and Reference number name the covering purchase order or production order.
- **Acumatica**: Provisioning Source and Provisioning Doc. Ref. Nbr. name the supply. A Linked Documents side panel lists the receipts and issues.
- **IFS**: Activity Monitoring – Project Connections lists every connected object with its status and cost.
- **Rationale**: The user asks "where is my part?" The answer is a PO line or a job. A link answers it in one click.

### 4. A project-wide list, with the task as a column or a tree

- **IFS**: Activity Materials and Services shows one activity. Project Materials and Services shows the whole project.
- **Business Central**: Each task has its lines. The project card opens all lines across all tasks.
- **SAP**: ProMan shows a tree of WBS elements and activities on the left. The material lists show on the right.
- **Acumatica**: Project Materials is a flat list with a Project Task column.
- **Rationale**: A buyer or a planner works across the whole project. An engineer works on one task. Both views use the same rows.

### 5. Unplanned use still shows in the list

- **Business Central**: If Apply Usage Link is on and the usage line has Line Type Billable, posting adds a new planning line.
- **Acumatica**: An issue of an item with no budget line adds a new cost budget line.
- **D365**: The project item journal posts use that has no item requirement.
- **IFS**: The issue needs a demand line. A forum answer says an issue on a work task does not update the demand line's Issued Quantity.
- **Rationale**: Actual cost includes items that nobody planned. A list without them understates the project and hides the variance.

### 6. Project stock and unassigned stock show apart

- **Acumatica**: The availability footer shows 2 quantities: this project and task, and free stock plus project stock.
- **Costpoint**: Each stock row has a project. A Common Inventory project holds the unassigned stock.
- **SAP**: Special stock Q is project stock. MB52 and MBBS list it per WBS element. ProMan does not count plant stock.
- **IFS**: An issue from project inventory adds no cost, because the project paid at receipt. An issue from standard inventory adds cost.
- **Rationale**: A project may hold stock that it already paid for. The user must see it before they order more.

### 7. The reverse view starts from the item

- **Costpoint**: View Part Inventory with an empty Project filter shows one row for each project that holds the part. The Requirements subtask shows reservations across all projects.
- **Acumatica**: The All Project Inventory side panel lists project stock across all projects.
- **SAP**: MD04 shows one segment per WBS element for the material.
- **D365**: Inventory transactions list item requirements as reference documents.
- **Rationale**: A buyer or an engineer starts from the part. Then they ask which projects need it or hold it.

## Answers to Research Questions

1. **What is one row of a project item list?** — One item on one task. SAP, IFS, Business Central, D365 and Acumatica all use this row. NetSuite shows one transaction per row instead. NetSuite's public help shows no item list.
2. **Which columns does the row have?** — Item, task, required quantity, ordered quantity, received quantity, issued quantity, open quantity, required date, unit cost and supply document. Acumatica and SAP ProMan have the most complete sets (Pattern 2).
3. **Is there one status per line?** — SAP has none. It shows quantity columns. Acumatica derives 6 statuses from the quantities. Business Central has a planning status (Planning, Quote, Order, Completed), not a supply status. Derive the status from the quantities. Do not store it.
4. **Flat list or grouped by task?** — Both. IFS and Business Central have a per-task list and a project list over the same rows. SAP ProMan shows a task tree beside the list. Acumatica uses a Task column. SAP rolls one material up across WBS elements only for MRP (grouping WBS element), not in the list.
5. **How do the products handle items that nobody planned?** — Business Central and Acumatica add a plan line when the issue posts. D365 posts them through the project item journal. Carbon should not write plan lines from a posting. Plan lines are plan-layer rows, and a posting would skip the change request and the plan lock. Show unplanned issues as read-only rows from the project ledger instead (Recommendation 4).
6. **Is there a reverse view, item to projects?** — Costpoint and Acumatica have one for project stock. SAP has MD04 project segments. Business Central, IFS and NetSuite have no documented item-to-projects page.
7. **Is there a standard term?** — Three products say "materials". Acumatica uses Project Materials, IFS uses Project Materials and Services, and SAP uses material components. Business Central and D365 say "item" on the line. Carbon's element page already calls these rows plan lines.

## Competitor-Specific Details

### SAP S/4HANA

- Material components sit on network activities. Item category L creates a reservation. Item category N creates a purchase requisition.
- The procurement indicator decides what a component creates: a reservation for the network, a reservation for the WBS element, or a requisition.
- CN33 copies components from a material BOM to activities. It matches the BOM's reference points with the activities.
- **ProMan (`CNMM`)** has overviews for Components, Quantities, Dates, Orders/Documents, Stock and Deliveries. An exception profile sets red or yellow traffic lights.
- CN52N lists material components. It misses PRs and POs that a user made by hand. ME5J and ME2J list those.
- Fiori: Manage Project Procurement (`F2930`), Missing Parts for Project, and Open Reservations for Project.
- No public source describes a Fiori app named "Monitor Project Material".

### IFS Cloud

- A Project Miscellaneous Demand line sits on an activity. It has 3 tabs: Misc. Parts, Misc. No Parts and Misc. Rental Parts.
- Each line has one supply option: Purchase, Shop Order, DOP, Project MRP or MRP.
- IFS reserves the line when the supply arrives. Reservation reports committed cost. Issue reports used cost.
- Material demand lines move Planned → Released → Reserved → Closed. A partial issue gives Partially Delivered.

### Dynamics 365 Finance & SCM

- An item requirement is a sales-order document with Order type = Item requirements.
- Line status moves Open order → Delivered → Invoiced. The packing slip is the consumption. It posts the project cost.
- With Item consumption on, the product receipt of a project PO posts the item requirement's packing slip.
- Standard D365 has no project-owned stock. It uses reservations on standard stock.

### Business Central

- A Project Planning Line has a Line Type: Budget, Billable, or Both Budget and Billable.
- The Create Purchase Orders action buys the items that the project is short of.
- All stock is common stock. BC writes off received project items at once with a Negative Adjustment.

### Acumatica

- Inventory Tracking on the project has 3 methods: Track by Project Quantity, Track by Project Quantity and Cost, Track by Location.
- Project Materials (`PM306500`) users enter Qty. Used by hand.
- The PO View Demand dialog links a PO line back to its material line.
- Transfer Project Inventory to Free Stock (`PM508000`) returns leftover stock.

### Deltek Costpoint

- Every stock row has a project. Part, warehouse, location and inventory abbreviation key the row.
- View Part Inventory columns: On Hand, Reserved, On Order, Requisition, Owed, Planned Reserved and Net Available quantity.
- Owed Quantity shows stock that one project owes another after a transfer. This matches Carbon's `projectBorrow`.

### NetSuite

- Each PO item line takes Customer (the project) and Project Task. The PO header has no project field.
- The project's Procurement subtab lists POs and vendor bills with amounts, not quantities.
- The help says that inventory items are not part of the supplier costs in Project Cost Budget vs. Actual.

### Epicor Kinetic

- Materials sit as JobMtl rows on jobs linked to a project phase. PO releases carry Project and Phase.
- Project Tracker shows cost totals only. Users build their own BAQs or dashboards for an item list.

## Carbon Today

Carbon stores every link that the competitors show. No page joins them.

| Link | Table and column | Where Carbon shows it | Gap |
|---|---|---|---|
| Part on an element | `projectElement.itemId`, `trackedEntityId` | Element sidebar (`PartLink.tsx`) | The Plan list and tree do not show it |
| Plan line | `projectElementMaterial` (`itemId`, `quantity`, `quantityIssued`, `methodType`, `jobId`, `purchaseOrderLineId`, `requiredDate`, `unitCost`) | Element page, Estimated tab (`ElementPlanLines.tsx`) | One element at a time |
| Open demand | view `openProjectMaterialLines` (quantity − issued − covered PO quantity) | MRP only | No screen reads it |
| Project stock | `itemLedger.projectId`, `itemStockQuantities.projectId` | Stock page (`ProjectStock.tsx`), if `projectStock` is on | On-hand quantity only |
| Actual cost by item | `projectLedger.itemId` | Costs drill-down, one element subtree (`ProjectLedgerTable.tsx`) | No total per item |
| Jobs, PO lines | `job.projectId`, `purchaseOrderLine.projectId` + `projectElementId` | Element page (`ElementJobs.tsx`, `ElementPurchaseOrderLines.tsx`) | One element at a time |
| Pegs | `projectPeg.itemId` | Pegging page, grouped by item | Pegged supply only |
| Item → projects | none | Item Used In (`UsedIn.tsx`) has no projects group | No reverse view |

The `getProjectElementPage` loader reads `itemHistory` (`get_element_history_by_item`). No component shows it.

## Recommended Approach for Carbon

1. **Add a Materials page to the project.** Put it in the project nav after Plan. Show one row per plan line (`projectElementMaterial`). This follows Patterns 1 and 4 (IFS Project Materials and Services, Acumatica Project Materials).
2. **Show the lifecycle as quantity columns.** This follows Pattern 2 (SAP ProMan, Acumatica). Use these columns:

   | Column | Source |
   |---|---|
   | Item | `projectElementMaterial.itemId` |
   | Element | `projectElementId`, with `readableId` and WBS code |
   | Method | `methodType` (Purchase to Order, Make to Order, Pull from Inventory) |
   | Required | `quantity` |
   | Ordered | the PO line's `purchaseQuantity` × `conversionFactor`, or the job quantity |
   | Received | the PO line's `quantityReceived` × `conversionFactor`, or the job's completed quantity |
   | Issued | `quantityIssued` |
   | Open | the same rule as `openProjectMaterialLines` |
   | Required date | `requiredDate`, else the element start date, else the project start date |
   | Supply | a link to the job or the PO line |

3. **Derive a status from the quantities.** Do not store a status. Use 5 values: Not covered, On order, Received, Partly issued, Issued. This follows Acumatica's derived status and SAP's quantity model.
4. **Show unplanned issues as read-only rows.** Read `projectLedger` rows that have an `itemId` and no plan line. Show them with Required = 0 and a label "Unplanned". Do not write a plan line from a posting. This follows Pattern 5 (Business Central, Acumatica), but keeps the plan unchanged.
5. **Give 2 groupings over the same rows.** Group by element by default. Add "Group by item" to total one item across all elements. This follows Pattern 4 and SAP's roll-up of one material across WBS elements.
6. **Show project stock on each row.** If `project.projectStock` is on, add an On hand (project) column from `itemStockQuantities.projectId`. Add an Unassigned column for stock with no project (`itemStockQuantities.projectId` = `''`). This follows Pattern 6 (Acumatica's availability footer, Costpoint).
7. **Add a Projects group to the item's Used In tab.** List each project that needs or holds the item. A project needs the item if it has a plan line or an open peg for it. A project holds the item if it has project stock of it. This follows Pattern 7 (Costpoint View Part Inventory, Acumatica All Project Inventory).
8. **Read the page through one view or RPC.** Read every source by `projectId` in one query. Never query per row. `get_project_cost_summary` and `openProjectMaterialLines` are the precedents.
9. **Do 2 small fixes on the way.** Show the linked part (`projectElement.itemId`) in the Plan list. Show the `itemHistory` hint on the element budget, as spec `2026-10-03-projects.md` plans.

### Open questions for the spec

1. Is the page title "Materials" or "Items"? Acumatica, IFS and SAP say materials. The user's request says items. Carbon's element page says plan lines.
2. Does the page include jobs and PO lines that carry the project but match no plan line? Recommendation 4 covers only issues.
3. Does the page let the user act on a row: create a PO line, create a job, issue material? The element page already has these actions.
4. Does the item's Used In include closed projects?

## Sources

- https://learning.sap.com/courses/project-logistics-control-in-sap-s-4hana/processing-material-procurement
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/assigning-material-components-to-a-project
- https://learning.sap.com/courses/project-logistics-control-in-sap-s-4hana/monitoring-logistical-data-and-procurement-processes
- https://learning.sap.com/courses/project-logistics-control-in-sap-s-4hana/grouping-material-requirements
- https://help.sap.com/saphelp_470/helpdata/en/44/706439d559793ce10000000a11402f/content.htm
- https://help.sap.com/saphelp_46C/helpdata/EN/4c/227b8d46e611d189470000e829fbbd/content.htm
- https://help.sap.com/saphelp_46C/helpdata/EN/a2/cd153805a49a5ce10000009b38f842/content.htm
- https://help.sap.com/doc/b5cfb65334e6b54ce10000000a174cb4/2.6/en-US/b7ceb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/doc/b5cfb65334e6b54ce10000000a174cb4/2.6/en-US/76cfb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/doc/b5cfb65334e6b54ce10000000a174cb4/2.6/en-US/02cfb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/saphelp_hba/helpdata/en/7b/663952f8b2a91ae10000000a445394/content.htm
- https://help.sap.com/fiori_bs2013/helpdata/en/d9/663952f8b2a91ae10000000a445394/content.htm
- https://help.sap.com/fiori_bs2013/helpdata/en/6a/25cd522774bd66e10000000a441470/content.htm
- https://sapinsider.org/effective-management-of-project-based-procurement-using-proman/
- https://userapps.support.sap.com/sap/support/knowledge/en/2622070
- https://userapps.support.sap.com/sap/support/knowledge/en/3280031
- https://userapps.support.sap.com/sap/support/knowledge/en/3418633
- https://userapps.support.sap.com/sap/support/knowledge/en/3203714
- https://userapps.support.sap.com/sap/support/knowledge/en/3644848
- https://archive.sap.com/discussions/thread/3400226
- https://blogs.sap.com/2022/10/12/sap-s-4hana-2022-release-project-manufacturing-management-and-optimization-whats-new/
- https://docs.ifs.com/ifsclouddocs/24r2/ProjectManagement/ProcessExcecuteProjectMiscellaneousDemand.htm
- https://docs.ifs.com/ifsclouddocs/23r2/ProjectManagement/ActivityRegisterProjectDemand.htm
- https://docs.ifs.com/ifsclouddocs/24r1/ProjectManagement/ActivityIssueFromInventoryToProject.htm
- https://docs.ifs.com/ifsclouddocs/25r2/ProjectManagement/AboutActivityConnections.htm
- https://docs.ifs.com/ifsclouddocs/24r1/Planning/AboutPmrp.htm
- https://wssifshelp.wilhelmsen.com/ifsdoc/documentation/en/MaintainInventory/AboutProjectInventory.htm
- https://community.ifs.com/projects-based-contract-resource-management-project-management-engineering-design-deliverables-250/issuing-material-on-a-project-connected-work-task-project-misc-demand-not-showing-material-issuing-67761
- https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-pma/project-item-requirements
- https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-pma/stkprojectcostinventoryconsumption
- https://learn.microsoft.com/en-us/previous-versions/dynamicsax-2012/item-requirements-form
- https://learn.microsoft.com/en-us/dynamics365/business-central/projects-how-manage-project-supplies
- https://learn.microsoft.com/en-us/dynamics365/business-central/projects-how-record-job-usage
- https://microsoft.github.io/BCApps/reference/base-application/Table/Microsoft.Projects.Project.Planning.Job-Planning-Line.html
- https://microsoft.github.io/BCApps/reference/base-application/Enum/Microsoft.Projects.Project.Planning.Job-Planning-Line-Status.html
- https://help.myob.com.au/advanced/Docs/Published/UserGuide/PM_30_65_00.html
- https://help.myob.com.au/advanced/Docs/Published/ReleaseNotes/RN_2026_R1_ProjectsConstr_Material_Management.html
- https://help.myob.com.au/advanced/Docs/Published/UserGuide/Projects_Inventory_Tracking_GeneralInfo.html
- https://help.myob.com.au/advanced/Docs/Published/ReleaseNotes/RN_2025_R1_ProjectsConstr_Inventory_Tracking_Side_Panels.html
- https://help.myob.com.au/advanced/Docs/Published/UserGuide/Projects_Inventory_Tracking_ItemAvailability.html
- https://help.deltek.com/Product/Costpoint/8.0/GA/inx_inventory_projects_and_abbreviations.htm
- https://help.deltek.com/PRODUCT/COSTPOINT/8.2/GA/INMPROJ_Inventory_Material_Planning_Tab.html
- https://et.norc.org/CPWeb/helpfiles/costpoint/INQPINV_Contents_of_the_View_Part_Inventory_Screen.html
- https://help.deltek.com/PRODUCT/COSTPOINT/8.2/GA/MRQPINV_Requirements_Subtask.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160318376007.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160327228862.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3751160832.html
- https://www.epiusers.help/t/project-costs-material-summary/89695
- https://www.epiusers.help/t/project-job-questions/98356

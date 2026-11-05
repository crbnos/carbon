# Bill of Material and Bill of Process Page Layout Research: Best Practices Survey

## Summary

This survey asks where the detail of one routing operation should open, and how a list, a tree and a properties panel share one page. No surveyed product gives a minimum pixel width for a form or a table. Consensus exists on two points. The operation list is a grid or a tab on the parent record. The link between a part and an operation sits on the component line, and a blank value means the first operation in SAP and Dynamics 365. Placement of the detail differs: a right panel in SAP PEO, a pop-up in Odoo, a separate form in Infor CSI.

## Evidence Limits

- SAP design pages returned 403. `[snippet]` marks a fact from search-result text only.
- NN/G, Tulip, Fusion Operations and Manufacturo pages did not open. Their facts are search excerpts.
- Epicor official help did not open. Epicor layout is not verified.
- Nobody tested these layouts with users. This file holds no usability data.

## Competitors Surveyed

- **SAP S/4HANA and PEO**: the enterprise reference.
- **Microsoft Dynamics 365 SCM**: a mainstream ERP with a BOM designer.
- **NetSuite, Odoo, Infor CSI, Infor LN, Katana**: mainstream ERPs with public documentation.
- **First Resonance ION, Tulip, Fusion Operations, Manufacturo**: tools for steps and work instructions.
- **Epicor Kinetic**: required by the domain table, but not verified.

## Key Consensus Patterns

### 1. The part-to-operation link sits on the component line

- **SAP**: one BOM item goes to one operation. Unassigned items default to the first operation.
- **Dynamics 365**: the field is **Oper. No.** A blank value means the first operation.
- **Odoo**: the optional column is **Consumed in Operation**.
- **Infor CSI**: the user selects an operation in the **Materials** grid.
- **NetSuite**: the exception. It uses a **Component per Operation** subtab on the routing.
- **Rationale**: the planner reads the link while reading the part list.

### 2. The operation list is a grid or a tab on the parent record

- **Dynamics 365**: the **Route details** page has a top grid with one row per operation.
- **NetSuite**: the **Routing Steps** subtab.
- **Odoo**: the **Operations** tab on the BOM form.
- **Infor CSI**: the **Operations** grid in the right pane.
- **Katana**: the **Production operations** tab, with Operation, Type, Resource, Cost per Hour, Time and Cost.

### 3. Detail placement differs by product

- **SAP PEO**: Details opens on the right and follows the selected row. `[snippet]`
- **Odoo**: a pop-up window.
- **Infor CSI**: a separate **Operations** form.
- **Dynamics 365 BOM designer**: a tree and a details section. Selection updates the details.

### 4. Steps have a list on the left and configuration on the right

- **Tulip**: the Steps List on the left and the Context Pane on the right.
- **ION**: a step queue and a right rail for assigned parts.

## Answers to Research Questions

1. Where does one operation open? See pattern 3. No single standard exists.
2. How wide should a detail panel be? No source gives a minimum. Published sizes: Fluent 320, 592, 940 px. IBM Carbon 256 to 1280 px. SAP Dynamic Side Content 25% or 33%.
3. When is a panel wrong? Fluent: for longer tasks, "consider a more focused surface". IBM Carbon: use a dedicated page for "more complex, lengthier or multistep" work.
4. How do list and detail split? SAP Flexible Column Layout uses 67/33 and 33/67. SAP allows 3 columns at 1280 px or more. Do not use it for workbench or tools layouts. `[snippet]`
5. Does the list stay visible? NN/G: a modal "will cover adjacent records". A nonmodal side panel keeps the table in view.
6. Do tools preview the operator view beside the editor? Tulip opens a separate window. ION has a print preview. A live side-by-side preview is not verified in any surveyed product.

## Competitor-Specific Details

### SAP

- PEO operation tabs: Interoperation Times, Splitting/Overlapping, General Data, Components, Inspection Characteristics, PRTs, OA Documents, Operation Documents. `[snippet]`
- PEO attaches work instructions per activity. Operators see their logon language.
- PEO has a Component Assignment workspace with components on the left and the routing on the right. `[snippet]`

### NetSuite

- A separate **Work Instructions** subtab holds Operation Name, Process Notes, Work Instructions, URL and Print Image.

### Odoo

- The operation pop-up holds Operation, Work Center, Duration Computation, Default Duration and a **Work Sheet** tab.

### Infor CSI

- A left tree pane and a right pane hold **Operations** and **Materials** grids.

## Carbon Facts (measured or read on 2026-11-05)

| Fact | Value | Evidence |
|---|---|---|
| Properties on the part page | Declared `w-96`. Renders 282, 291, 310 px at 1280, 1440, 1920 viewport | Measured in the browser |
| Properties on the Procedure page | Declared `w-[450px]`. Renders 315, 326 px at 1280, 1440 viewport | Measured in the browser |
| Files that declare each width | 21 use `w-96`, 4 use `w-[450px]` | grep in `modules/` |
| Explorer | Resizable, default 20% of the panel group | `components/Layout/Panels.tsx:388` |
| Properties | Not resizable. It toggles open and closed | `components/Layout/Panels.tsx:402` |
| Drawer widths at `lg` and up | sm 1/4, md 1/3, lg 1/2, xl 2/3, full 100% | `packages/react/src/Drawer.tsx` |
| Procedure page | Explorer has Steps and Parameters. Content is the editor. Properties is on the right | `routes/x+/procedure+/$id.tsx` |

## Recommended Approach for Carbon

1. Keep **Operation** as a column on Bill of Material lines. This follows SAP, Dynamics 365, Odoo and Infor.
2. Compare 4 placements with users before a decision: the content pane, a wider right panel, a split, a drawer.
3. Start the walkthrough with the content pane. It follows the Procedure page and leaves Properties unchanged.
4. Set `shrink-0` if a wider panel is chosen. The measured panels shrink below their declared width.

## Sources

- https://raw.githubusercontent.com/SAP/openui5/master/src/sap.f/src/sap/f/FlexibleColumnLayout.js
- https://raw.githubusercontent.com/SAP/openui5/master/src/sap.f/src/sap/f/library.js
- https://raw.githubusercontent.com/SAP/openui5/master/src/sap.ui.layout/src/sap/ui/layout/DynamicSideContent.js
- https://learning.sap.com/courses/ui-development-with-sap-fiori/working-with-sap-fiori-design-guidelines_ab11c169-54de-4f51-87b9-f61c8a5198be
- https://learning.sap.com/courses/exploring-basic-data-for-manufacturing-and-product-management-in-sap-s-4hana/creating-material-assignments-and-component-allocations
- https://learning.sap.com/courses/s-4hana-peo-foundational-setup-and-basic-processes/defining-simple-work-instructions-for-operation-activities
- https://help.sap.com/docs/PRODUCT_ID/9c4986bda35f4840ae438960ffbef64d/d62624aaae154ccdbd40d06a793b139e.html
- https://help.sap.com/saphelp_470/helpdata/en/03/bb1d06a6e811d189010000e8323492/content.htm
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/scrap-calculations
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/bom-designer-functionality
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/routes-operations
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2345383.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0620083301.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1498757185.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/bill_configuration.html
- https://docs.infor.com/csi/9.01.x/en-us/csbiolh/lsm1454144436495.html
- https://docs.infor.com/ln/10.6/en-us/lnolh/help/ti/onlinemanual/000017.html
- https://support.katanamrp.com/en/articles/5967108-how-to-create-production-operations
- https://docs.firstresonance.io/build-hardware/procedures.md
- https://docs.firstresonance.io/build-hardware/procedures/installation-requirements-beta.md
- https://support.tulip.co/docs/app-editor
- https://support.tulip.co/docs/test-apps-in-developer-mode
- https://www.nngroup.com/articles/data-tables/
- https://fluent2.microsoft.design/components/web/react/core/drawer/usage
- https://raw.githubusercontent.com/microsoft/fluentui/master/packages/react-components/react-drawer/library/src/shared/useDrawerBaseStyles.styles.ts
- https://carbondesignsystem.com/patterns/forms-pattern/
- https://raw.githubusercontent.com/carbon-design-system/ibm-products/main/packages/ibm-products-styles/src/components/SidePanel/_side-panel-variables.scss
- http://v1.lightningdesignsystem.com/components/split-view/
- https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts

# Customer Part Number Display Research: Best Practices Survey

## Summary

This survey covers how 6 ERPs show a customer's own part number on customer-facing documents, and which setting controls it. Every product stores the customer part number in a cross-reference record keyed by customer and item. 5 of the 6 products copy the customer part number onto the order line when the user creates the line. 4 products control printing only through the form template or report layout. Epicor Kinetic is the only product with a print option per customer. Only Epicor stores a customer revision on the order line.

## Competitors Surveyed

- **SAP S/4HANA**: the enterprise reference. Customer-material info record (CMIR).
- **Oracle NetSuite**: Sales and CRM leader. Customer Part Number feature of the Supply Chain Management SuiteApp.
- **Epicor Kinetic**: discrete manufacturing leader. Customer Part Cross Reference.
- **Microsoft Dynamics 365 Business Central**: mid-market ERP. Item references. Findings come from its source code (microsoft/BCApps, W1 layer, commit de807a07).
- **Acumatica**: mid-market ERP. Cross-references with the alternate type "Customer Part Number".
- **Infor CloudSuite Industrial (SyteLine)**: discrete manufacturing ERP. Partial: its online help was mostly unreadable.

## Key Consensus Patterns

### 1. One cross-reference record per customer and item

- **SAP**: the CMIR maps a customer material number to a material for one customer.
- **NetSuite**: the item record holds a list of customer and customer part number pairs. Each pair is unique per item in a subsidiary.
- **Epicor**: the `CustXPrt` table maps one customer part to one internal part per customer.
- **Business Central**: an item reference with Reference Type = Customer.
- **Rationale**: the customer's number belongs to the relation between a customer and an item, not to either record alone.

### 2. The order line keeps its own copy

- **SAP**: copies CMIR data into the sales document item (`VBAP-KDMAT`).
- **NetSuite**: fills the line column when the user adds the line. A later change of customer does not update the lines.
- **Epicor**: fills `OrderDtl.XPartNum` when the user picks the part. The shipment line takes its value from the order line.
- **Business Central**: writes Item Reference No. onto the sales line. Posted shipment and invoice lines keep the field.
- **Acumatica**: `SOLine.AlternateID` keeps the value from line entry. A later cross-reference does not change existing orders.
- **Rationale**: a document that a customer already received must not change when someone edits the master data later.

### 3. The user can find the item by the customer's number

- **SAP, NetSuite, Epicor, Business Central, Acumatica**: each product accepts the customer's number in the line's item field and finds the item.
- **Rationale**: the customer's purchase order states the customer's number, so order entry starts from it.

### 4. Print control lives in the template, except in Epicor

- **SAP**: the form template of the output type decides. The standard Cloud billing form does not print the customer material number.
- **NetSuite**: 2 special forms add a Customer Part Number column next to Item. They are "SCM Sales Order - Customer Part No" and "SCM Invoice - Customer Part No.".
- **Business Central**: 5 standard sales reports carry Item Reference No. in their data. The default layouts do not print it. A company can pick a layout per customer (Customer Card > Document Layouts).
- **Epicor**: the per-customer field `Customer.CustPartOpts` decides, with 4 values: Main Part Reference (default), Secondary Part Reference, Only Part Reference Printed, Customer Part Not Printed. The forms read this field.
- **Rationale**: products with flexible layouts leave the choice to the layout. Epicor adds a data-level option because the same customer gets the same rule on every document.

## Answers to Research Questions

1. Which documents print the customer part number? NetSuite: sales order and invoice. Epicor: quote, sales order acknowledgment, packing slip and invoice. Business Central: quote, order confirmation, invoice, credit memo and shipment carry the field in their data, but the default layouts do not print it. SAP and Acumatica: not confirmed.
2. Is there a setting for ours only, theirs only, or both? Only Epicor has one, per customer. SAP, NetSuite, Business Central and Acumatica use the template or the layout.
3. When both numbers print, which comes first? NetSuite prints a separate column to the right of Item. Epicor prints one number in the part column, chosen by the option. No product prints "OUR (CUSTOMER)" on one line.
4. Snapshot or live? Snapshot in SAP, NetSuite, Epicor, Business Central and Acumatica. Infor reads the customer item number from the order line when it reprints an invoice.
5. How do products handle customer revisions? Only Epicor stores a customer revision on lines (`XRevisionNum`). SAP, NetSuite, Business Central and Acumatica have no revision field on the cross-reference.
6. Standard terms: SAP "customer material number", NetSuite "Customer Part Number", Epicor "Customer Part", Business Central "Item Reference No.", Acumatica "Alternate ID".

## Competitor-Specific Details

### SAP S/4HANA

- CMIR data has priority over customer and material master data on the sales document item.
- Sales scheduling agreements carry the customer's engineering change status into the delivery. The CMIR itself has no revision field.
- Not confirmed: which standard order confirmation and delivery note forms print the customer material number.

### Oracle NetSuite

- An administrator turns on the feature for the company and for each role.
- The feature covers inventory items and assembly items only.
- A user can select only the customer's active part numbers on a line.

### Epicor Kinetic

- If the user types a new customer part on a quote or order line, Epicor creates the cross-reference record.
- A part change on the line clears the customer part.
- The user can change the customer part on an AR invoice line.
- Not confirmed: where the other number prints under Main and Secondary.

### Microsoft Dynamics 365 Business Central

- If the reference has a description, it replaces the line description.
- A typed reference must exist, or the user sees "There are no items with reference %1."
- Starting and ending dates limit when a reference is valid.

### Acumatica

- The order line shows the customer's number in the Alternate ID column.
- To print it, a user adds `SOLine.AlternateID` to the report in Report Designer.

### Infor CloudSuite Industrial

- The Order Verification Report can include item numbers and customer item numbers. The option name is not confirmed.

## Recommended Approach for Carbon

1. Keep `customerPartToItem` as the cross-reference. It matches the record shape in all 6 products.
2. Add a print option with a company default and a customer override. Epicor sets this option per customer. The company default is a Carbon addition, because Carbon has no layout per customer.
3. Apply the option to every customer-facing sales document: quote, sales order, sales invoice and packing slip. Epicor covers the same set.
4. Keep both numbers as the default. Carbon prints both today, and a quiet change would surprise existing companies.
5. Add separate merge fields for our part number and the customer part number. NetSuite and Business Central give the layout separate fields.
6. Keep the customer revision. Carbon already stores it, like Epicor.
7. Consider a copy of the customer part number on the sales order line. All 5 products that answer this question keep a copy on the line. This changes the data model, so it is a separate decision.

## Sources

- https://help.sap.com/saphelp_470/helpdata/en/dd/55f940545a11d1a7020000e829fd11/content.htm
- https://help.sap.com/saphelp_46c/helpdata/en/dd/55fad2545a11d1a7020000e829fd11/content.htm
- https://userapps.support.sap.com/sap/support/knowledge/en/3045564
- https://userapps.support.sap.com/sap/support/knowledge/en/2679030
- https://help.sap.com/saphelp_46c/helpdata/en/93/743b1e546011d1a7020000e829fd11/content.htm
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4575965810.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4575970034.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4575980825.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4576023346.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4576003899.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4576582361.html
- https://www.epiusers.help/t/quote-part-description/136747?page=2
- https://epiusers.help/t/calc-custpartopts-in-quotform-rdd-abandoned-the-need-for-this/114522
- https://www.epiusers.help/t/issue-finding-customerview-custpartops-field-to-query/75564
- https://epiusers.help/t/auto-populate-customer-part-number/66715
- https://www.epiusers.help/t/miscellaneous-packing-slip-doesnt-pull-customer-part/100432
- https://epiusers.help/t/customer-revision-with-internal-revision/83770
- https://www.ssh.com.mx/ftp_fiel/EPICOR%20Manuales/EpicorApplication_UserGuide_Part2of2_100700.pdf
- https://www.ssh.com.mx/ftp_fiel/EPICOR%20Manuales/EpicorApplication_UserGuide_Part1of2_100700.pdf
- https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-how-use-item-cross-refs
- https://learn.microsoft.com/en-us/dynamics365/release-plan/2023wave2/smb/dynamics365-business-central/identify-track-items-easier-item-references
- https://microsoft.github.io/BCApps/reference/base-application/Table/Microsoft.Sales.History.Sales-Invoice-Line.html
- https://github.com/microsoft/BCApps/tree/main/src/Layers/W1/BaseApp/Sales
- https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Inventory/Item/Catalog/ItemReferenceManagement.Codeunit.al
- https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Inventory/Item/Catalog/ItemReference.Table.al
- https://learn.microsoft.com/en-us/dynamics365/business-central/ui-define-customer-vendor-document-layouts
- https://help.myob.com.au/advanced/Docs/Published/UserGuide/IN__con_Item_Cross-References.html
- https://community.acumatica.com/configuration-and-installation-114/understanding-alternate-id-resolution-in-acumatica-37217
- https://docs.infor.com/csi/10.x/en-us/csbiolh/customer_svc_user_cl_sl/unt1529003970547.html
- https://docs.infor.com/csi/9.01.x/en-us/csbiolh/lsm1454144031725.html

# Keyboard-nav polish — menu shortcut rollout

Every menu item across `apps/erp` and `apps/mes` that got a key in Task 6 of `2026-09-29-keyboard-nav-polish.md`. Keys are `MENU_ITEM_SHORTCUTS.<key>`. Delete items are listed separately at the end (added 2026-09-30).

**205 items.**

| file | label | key |
|---|---|---|
| apps/erp/app/components/DefaultAttachmentsPanel.tsx | Download | download |
| apps/erp/app/components/Documents.tsx | Download | download |
| apps/erp/app/components/Documents.tsx | Download | download |
| apps/erp/app/components/Documents.tsx | View | view |
| apps/erp/app/components/RecordDocuments.tsx | Download | download |
| apps/erp/app/components/RecordDocuments.tsx | View in new tab | view |
| apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTree.tsx | Edit (account menu) | edit |
| apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTree.tsx | Edit Group | edit |
| apps/erp/app/modules/accounting/ui/CostCenters/CostCenterNode.tsx | Edit | edit |
| apps/erp/app/modules/accounting/ui/CostCenters/CostCentersListView.tsx | Edit | edit |
| apps/erp/app/modules/accounting/ui/Dimensions/DimensionsTable.tsx | Edit Dimension | edit |
| apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRatesTable.tsx | Edit Currency | edit |
| apps/erp/app/modules/accounting/ui/FixedAssets/AssetClassesTable.tsx | Edit Asset Class | edit |
| apps/erp/app/modules/accounting/ui/FixedAssets/DepreciationRunTable.tsx | View Run | view |
| apps/erp/app/modules/accounting/ui/FixedAssets/FixedAssetsTable.tsx | Edit Asset / View Asset (ternary) | edit / view (same ternary) |
| apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntriesTable.tsx | Edit Journal Entry / View Journal Entry (ternary) | edit / view (same ternary) |
| apps/erp/app/modules/accounting/ui/PaymentTerms/PaymentTermsTable.tsx | Edit Payment Term | edit |
| apps/erp/app/modules/accounting/ui/Periods/PeriodsTable.tsx | View Period (only when Closed; else Close Period) | view when closed, else none |
| apps/erp/app/modules/accounting/ui/Projects/ProjectsTable.tsx | Edit Project | edit |
| apps/erp/app/modules/documents/ui/Documents/DocumentsTable.tsx | Download | download |
| apps/erp/app/modules/documents/ui/Documents/DocumentsTable.tsx | Edit | edit |
| apps/erp/app/modules/inventory/ui/Batches/BatchPropertiesConfig.tsx | Edit | edit |
| apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountsTable.tsx | Edit Count / View Count | edit |
| apps/erp/app/modules/inventory/ui/Kanbans/KanbansTable.tsx | Edit | edit |
| apps/erp/app/modules/inventory/ui/Kanbans/KanbansTable.tsx | View Item Master | view |
| apps/erp/app/modules/inventory/ui/PickingLists/PickingListsTable.tsx | View Picking List / Edit Picking List | view |
| apps/erp/app/modules/inventory/ui/Receipts/ReceiptsTable.tsx | View Receipt / Edit Receipt | view |
| apps/erp/app/modules/inventory/ui/Shipments/ShipmentsTable.tsx | View Shipment / Edit Shipment | view |
| apps/erp/app/modules/inventory/ui/ShippingMethods/ShippingMethodsTable.tsx | Edit Shipping Method | edit |
| apps/erp/app/modules/inventory/ui/StockTransfers/StockTransferLines.tsx | Edit Line | edit |
| apps/erp/app/modules/inventory/ui/StockTransfers/StockTransfersTable.tsx | View Stock Transfer / Edit Stock Transfer | view |
| apps/erp/app/modules/inventory/ui/StorageRules/StorageRulesGroups.tsx | Edit Rule | edit |
| apps/erp/app/modules/inventory/ui/StorageRules/StorageRulesTable.tsx | Edit Rule | edit |
| apps/erp/app/modules/inventory/ui/StorageTypes/StorageTypesTable.tsx | Edit Storage Type | edit |
| apps/erp/app/modules/inventory/ui/StorageUnits/StorageUnitsTable.tsx | Edit Storage Unit | edit |
| apps/erp/app/modules/inventory/ui/Traceability/TrackedEntitiesTable.tsx | Edit Expiry | edit |
| apps/erp/app/modules/inventory/ui/Traceability/TrackedEntitiesTable.tsx | View Traceability Graph | view |
| apps/erp/app/modules/inventory/ui/WarehouseTransfers/WarehouseTransferLines.tsx | Edit | edit |
| apps/erp/app/modules/inventory/ui/WarehouseTransfers/WarehouseTransfersTable.tsx | View Transfer / Edit Transfer | view |
| apps/erp/app/modules/invoicing/ui/Memo/MemosTable.tsx | Edit Memo / View Memo (conditional) | edit / view by status |
| apps/erp/app/modules/invoicing/ui/Payment/PaymentsTable.tsx | Edit Payment / View Payment (conditional) | edit / view by status |
| apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceExplorer.tsx | View Item Master | view |
| apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx | Edit | edit |
| apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer.tsx | View Item Master | view |
| apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx | Edit | edit |
| apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeExplorer.tsx | View Item Master | view |
| apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticesTable.tsx | Edit Change Notice | edit |
| apps/erp/app/modules/items/ui/ChangeNoticeActions/ChangeNoticeRequiredActionsTable.tsx | Edit Action | edit |
| apps/erp/app/modules/items/ui/ChangeNoticeTypes/ChangeNoticeTypesTable.tsx | Edit Type | edit |
| apps/erp/app/modules/items/ui/Consumables/ConsumablesTable.tsx | Edit ConsumableListItem | edit |
| apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx | Duplicate | duplicate |
| apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/items/ui/Item/CustomerParts/CustomerParts.tsx | Edit Customer Part | edit |
| apps/erp/app/modules/items/ui/Item/ItemDocuments.tsx | Download | download |
| apps/erp/app/modules/items/ui/Item/ItemDocuments.tsx | Download | download |
| apps/erp/app/modules/items/ui/Item/ItemDocuments.tsx | View | view |
| apps/erp/app/modules/items/ui/Item/ItemForm.tsx | View Item Master | view |
| apps/erp/app/modules/items/ui/Item/MakeMethodTools.tsx | Duplicate Version | duplicate |
| apps/erp/app/modules/items/ui/Item/PickMethodForm.tsx | Open Audit Log | open |
| apps/erp/app/modules/items/ui/Item/UsedIn.tsx | Edit | edit |
| apps/erp/app/modules/items/ui/ItemPostingGroups/ItemPostingGroupsTable.tsx | Edit Item Group | edit |
| apps/erp/app/modules/items/ui/MaterialDimensions/MaterialDimensionsTable.tsx | Edit Material Dimension | edit |
| apps/erp/app/modules/items/ui/MaterialFinishes/MaterialFinishesTable.tsx | Edit Material Finish | edit |
| apps/erp/app/modules/items/ui/MaterialGrades/MaterialGradesTable.tsx | Edit Material Grade | edit |
| apps/erp/app/modules/items/ui/MaterialShapes/MaterialShapesTable.tsx | Edit Material Shape | edit |
| apps/erp/app/modules/items/ui/MaterialSubstances/MaterialSubstanceTable.tsx | Edit Substance | edit |
| apps/erp/app/modules/items/ui/MaterialTypes/MaterialTypesTable.tsx | Edit Material Type | edit |
| apps/erp/app/modules/items/ui/Materials/MaterialsTable.tsx | Edit Material | edit |
| apps/erp/app/modules/items/ui/Parts/ConfigurationParameters.tsx | Edit | edit |
| apps/erp/app/modules/items/ui/Parts/ConfigurationParameters.tsx | Edit | edit |
| apps/erp/app/modules/items/ui/Parts/PartsTable.tsx | Edit Part | edit |
| apps/erp/app/modules/items/ui/Services/ServicesTable.tsx | Edit Service | edit |
| apps/erp/app/modules/items/ui/Tools/ToolsTable.tsx | Edit Tool | edit |
| apps/erp/app/modules/items/ui/UnitOfMeasure/UnitOfMeasuresTable.tsx | Edit Unit of Measure | edit |
| apps/erp/app/modules/people/ui/Attributes/AttributeCategoriesTable.tsx | Edit Category | edit |
| apps/erp/app/modules/people/ui/Attributes/AttributeCategoriesTable.tsx | View Attributes | view |
| apps/erp/app/modules/people/ui/Attributes/AttributeCategoryDetail.tsx | Edit Attribute | edit |
| apps/erp/app/modules/people/ui/Departments/DepartmentNode.tsx | Edit | edit |
| apps/erp/app/modules/people/ui/Departments/DepartmentsListView.tsx | Edit | edit |
| apps/erp/app/modules/people/ui/Departments/DepartmentsTable.tsx | Edit Department | edit |
| apps/erp/app/modules/people/ui/Holidays/HolidaysTable.tsx | Edit Holiday | edit |
| apps/erp/app/modules/people/ui/People/PeopleTable.tsx | Edit Employee | edit |
| apps/erp/app/modules/people/ui/Shifts/ShiftsTable.tsx | Edit Shift | edit |
| apps/erp/app/modules/people/ui/Timecards/TimecardsTable.tsx | Edit Timecard | edit |
| apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionHeader.tsx | View Item Master | view |
| apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionsTable.tsx | Edit Instruction | edit |
| apps/erp/app/modules/production/ui/Batches/BatchDetailDrawer.tsx | View on schedule board | view |
| apps/erp/app/modules/production/ui/Batches/BatchesTable.tsx | View Batch | view |
| apps/erp/app/modules/production/ui/DemandProjection/DemandProjectionTable.tsx | Edit | edit |
| apps/erp/app/modules/production/ui/InspectionDocument/InspectionDocumentEditor.tsx | Download PDF | download |
| apps/erp/app/modules/production/ui/InspectionDocument/InspectionDocumentEditor.tsx | View Item Master | view |
| apps/erp/app/modules/production/ui/InspectionDocument/InspectionDocumentTable.tsx | Edit Diagram | edit |
| apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx | Duplicate | duplicate |
| apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/production/ui/Jobs/JobDocuments.tsx | Download | download |
| apps/erp/app/modules/production/ui/Jobs/JobDocuments.tsx | Download | download |
| apps/erp/app/modules/production/ui/Jobs/JobDocuments.tsx | View | view |
| apps/erp/app/modules/production/ui/Jobs/JobsTable.tsx | Edit Job | edit |
| apps/erp/app/modules/production/ui/Jobs/ProductionEventsTable.tsx | Edit Event | edit |
| apps/erp/app/modules/production/ui/Jobs/ProductionQuantitiesTable.tsx | Edit Quantity | edit |
| apps/erp/app/modules/production/ui/Procedures/ProcedureExplorer.tsx | Edit Parameter | edit |
| apps/erp/app/modules/production/ui/Procedures/ProcedureExplorer.tsx | Edit Step | edit |
| apps/erp/app/modules/production/ui/Procedures/ProceduresTable.tsx | Edit Procedure | edit |
| apps/erp/app/modules/production/ui/Schedule/Kanban/components/BatchItemCard.tsx | Open in MES | open |
| apps/erp/app/modules/production/ui/Schedule/Kanban/components/ItemCard.tsx | Edit Operation | edit |
| apps/erp/app/modules/production/ui/Schedule/Kanban/components/ItemCard.tsx | Open in MES | open |
| apps/erp/app/modules/production/ui/Schedule/Kanban/components/JobCard.tsx | Edit Job | edit |
| apps/erp/app/modules/production/ui/ScrapReasons/ScrapReasonsTable.tsx | Edit Scrap Reason | edit |
| apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderExplorer.tsx | View Item Master | view |
| apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx | Duplicate | duplicate |
| apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx | Edit | edit |
| apps/erp/app/modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrdersTable.tsx | Edit | edit |
| apps/erp/app/modules/purchasing/ui/PurchasingRfq/PurchasingRFQsTable.tsx | Edit | edit |
| apps/erp/app/modules/purchasing/ui/Supplier/SupplierBankAccounts.tsx | Edit | edit |
| apps/erp/app/modules/purchasing/ui/Supplier/SupplierProcesses.tsx | Edit Process | edit |
| apps/erp/app/modules/purchasing/ui/Supplier/SuppliersTable.tsx | Edit Supplier | edit |
| apps/erp/app/modules/purchasing/ui/SupplierInteraction/SupplierInteractionDocuments.tsx | Download | download |
| apps/erp/app/modules/purchasing/ui/SupplierInteraction/SupplierInteractionLineDocuments.tsx | Download | download |
| apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteExplorer.tsx | View Item Master | view |
| apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuotesTable.tsx | Edit | edit |
| apps/erp/app/modules/purchasing/ui/SupplierTypes/SupplierTypesTable.tsx | Edit Supplier Type | edit |
| apps/erp/app/modules/purchasing/ui/SupplierTypes/SupplierTypesTable.tsx | View Suppliers | view |
| apps/erp/app/modules/quality/ui/Actions/ActionsTable.tsx | View Issue | view |
| apps/erp/app/modules/quality/ui/Calibrations/GaugeCalibrationRecordsTable.tsx | Edit Record | edit |
| apps/erp/app/modules/quality/ui/Documents/QualityDocumentsTable.tsx | Edit Document | edit |
| apps/erp/app/modules/quality/ui/Gauge/GaugeForm.tsx | View | view |
| apps/erp/app/modules/quality/ui/Gauge/GaugesTable.tsx | Edit Gauge | edit |
| apps/erp/app/modules/quality/ui/GaugeTypes/GaugeTypesTable.tsx | Edit Type | edit |
| apps/erp/app/modules/quality/ui/Issue/IssuesTable.tsx | Edit Issue | edit |
| apps/erp/app/modules/quality/ui/IssueTypes/IssueTypesTable.tsx | Edit Type | edit |
| apps/erp/app/modules/quality/ui/IssueWorkflows/IssueWorkflowsTable.tsx | Edit Template | edit |
| apps/erp/app/modules/quality/ui/RequiredActions/RequiredActionsTable.tsx | Edit Action | edit |
| apps/erp/app/modules/quality/ui/RiskRegister/RiskRegistersTable.tsx | Edit Risk | edit |
| apps/erp/app/modules/resources/ui/Abilities/AbilitiesTable.tsx | View Ability | view |
| apps/erp/app/modules/resources/ui/Abilities/AbilityEmployeesTable.tsx | Edit Employee Ability | edit |
| apps/erp/app/modules/resources/ui/Contractors/ContractorsTable.tsx | Edit Contractor | edit |
| apps/erp/app/modules/resources/ui/FailureModes/FailureModesTable.tsx | Edit Failure Mode | edit |
| apps/erp/app/modules/resources/ui/Locations/LocationsTable.tsx | Edit Location | edit |
| apps/erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchExplorer.tsx | Edit | edit |
| apps/erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchNotes.tsx | Download | download |
| apps/erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchesTable.tsx | Edit Dispatch | edit |
| apps/erp/app/modules/resources/ui/MaintenanceSchedule/MaintenanceSchedulesTable.tsx | Edit Schedule | edit |
| apps/erp/app/modules/resources/ui/Partners/PartnersTable.tsx | Edit Partner | edit |
| apps/erp/app/modules/resources/ui/Processes/ProcessForm.tsx | Edit Process | edit |
| apps/erp/app/modules/resources/ui/Processes/ProcessesTable.tsx | Edit Process | edit |
| apps/erp/app/modules/resources/ui/Suggestions/SuggestionsTable.tsx | View Suggestion | view |
| apps/erp/app/modules/resources/ui/Training/TrainingExplorer.tsx | Edit Question | edit |
| apps/erp/app/modules/resources/ui/Training/TrainingsTable.tsx | Edit Training | edit |
| apps/erp/app/modules/resources/ui/WorkCenters/WorkCentersTable.tsx | Edit Work Center | edit |
| apps/erp/app/modules/sales/ui/Customer/CustomerBankAccounts.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/CustomerPortals/CustomerPortalsTable.ee.tsx | Edit Portal | edit |
| apps/erp/app/modules/sales/ui/CustomerStatuses/CustomerStatusesTable.tsx | Edit Customer Status | edit |
| apps/erp/app/modules/sales/ui/CustomerStatuses/CustomerStatusesTable.tsx | View Customers | view |
| apps/erp/app/modules/sales/ui/CustomerTypes/CustomerTypesTable.tsx | Edit Customer Type | edit |
| apps/erp/app/modules/sales/ui/CustomerTypes/CustomerTypesTable.tsx | View Customers | view |
| apps/erp/app/modules/sales/ui/Customers/CustomersTable.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/NoQuoteReasons/NoQuoteReasonsTable.tsx | Edit Reason | edit |
| apps/erp/app/modules/sales/ui/Opportunity/OpportunityDocuments.tsx | Download | download |
| apps/erp/app/modules/sales/ui/Opportunity/OpportunityLineDocuments.tsx | Download | download |
| apps/erp/app/modules/sales/ui/Opportunity/OpportunityLineDocuments.tsx | Download | download |
| apps/erp/app/modules/sales/ui/Opportunity/OpportunityLineDocuments.tsx | View | view |
| apps/erp/app/modules/sales/ui/Pricing/PriceOverrideForm.tsx | View History | view |
| apps/erp/app/modules/sales/ui/Pricing/PriceOverridesTable.tsx | Duplicate to... | duplicate |
| apps/erp/app/modules/sales/ui/Pricing/PriceOverridesTable.tsx | Edit Pricing / Set Pricing (conditional) | edit (only when label is edit pricing) |
| apps/erp/app/modules/sales/ui/Pricing/PricingRulesTable.tsx | Duplicate Pricing Rule | duplicate |
| apps/erp/app/modules/sales/ui/Pricing/PricingRulesTable.tsx | Edit Pricing Rule | edit |
| apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/Quotes/QuoteExplorer.tsx | View Item Master | view |
| apps/erp/app/modules/sales/ui/Quotes/QuoteHeader.tsx | Copy Quote | copy |
| apps/erp/app/modules/sales/ui/Quotes/QuoteLineForm.tsx | View Item Master | view |
| apps/erp/app/modules/sales/ui/Quotes/QuotesTable.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/ReturnReasons/ReturnReasonsTable.tsx | Edit Reason | edit |
| apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderExplorer.tsx | View Item Master | view |
| apps/erp/app/modules/sales/ui/SalesOrder/SalesOrdersTable.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQsTable.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx | Edit | edit |
| apps/erp/app/modules/sales/ui/SalesRules/SalesRulesTable.tsx | Edit Rule | edit |
| apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysTable.tsx | Edit API Key | edit |
| apps/erp/app/modules/settings/ui/Approvals/ApprovalRuleCard.ee.tsx | Edit Rule | edit |
| apps/erp/app/modules/settings/ui/CustomFields/CustomFieldsTable.tsx | View Custom Fields | view |
| apps/erp/app/modules/settings/ui/CustomFields/CustomFieldsTableDetail.tsx | Edit Custom Field | edit |
| apps/erp/app/modules/settings/ui/Printing/PrintJobsTable.tsx | View | view |
| apps/erp/app/modules/settings/ui/Sequences/SequencesTable.tsx | Edit Sequence | edit |
| apps/erp/app/modules/settings/ui/SerialNumbers/ItemSerialSequencesTable.tsx | Edit | edit |
| apps/erp/app/modules/settings/ui/Webhooks/WebhooksTable.tsx | Edit Webhook | edit |
| apps/erp/app/modules/users/ui/EmployeeTypes/EmployeeTypesTable.ee.tsx | Edit Employee Type | edit |
| apps/erp/app/modules/users/ui/EmployeeTypes/EmployeeTypesTable.ee.tsx | View Employees | view |
| apps/erp/app/modules/users/ui/Employees/EmployeesTable.tsx | Edit Permissions (bulk actions) | edit |
| apps/erp/app/modules/users/ui/Employees/EmployeesTable.tsx | Edit Permissions (row menu) | edit |
| apps/erp/app/modules/users/ui/Groups/GroupsTable.tsx | Edit Group | edit |
| apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx | Open Workflow | open |
| apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx | Rename Workflow | rename |
| apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.tsx | Edit | edit |
| apps/erp/app/routes/x+/person+/$personId.timecard.tsx | Edit | edit |
| apps/erp/app/routes/x+/resources+/assignments.tsx | Edit Assignment | edit |
| apps/erp/app/routes/x+/resources+/assignments.tsx | View Status | view |
| apps/mes/app/components/JobOperation/JobOperation.tsx | Download | download |
| apps/mes/app/components/JobOperation/JobOperation.tsx | Download | download |
| apps/mes/app/routes/x+/timecard.tsx | Edit | edit |

## Delete (Backspace) — added 2026-09-30

Wired only where choosing the item opens a confirmation first; items that delete immediately are skipped. Line numbers are from before the edit.

**190 wired.**

| file:line | label | wired/skipped | reason |
|---|---|---|---|
| apps/erp/app/modules/sales/ui/Customers/CustomersTable.tsx:295 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/CustomerPortals/CustomerPortalsTable.ee.tsx:106 (pre-edit line) | Delete... | wired | opens delete route (ConfirmDelete modal page) |
| apps/erp/app/modules/sales/ui/NoQuoteReasons/NoQuoteReasonsTable.tsx:70 (pre-edit line) | Delete... | wired | opens delete route (ConfirmDelete modal page) |
| apps/erp/app/modules/sales/ui/ReturnReasons/ReturnReasonsTable.tsx:95 (pre-edit line) | Delete... | wired | opens delete route (ConfirmDelete modal page) |
| apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderHeader.tsx:158 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx:210 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/CustomerTypes/CustomerTypesTable.tsx:80 (pre-edit line) | Delete... | wired | opens delete route (ConfirmDelete modal page) |
| apps/erp/app/modules/sales/ui/Quotes/QuoteExplorer.tsx:676 (pre-edit line) | Delete... | wired | opens DeleteXLine ConfirmDelete |
| apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderExplorer.tsx:350 (pre-edit line) | Delete... | wired | opens DeleteXLine ConfirmDelete |
| apps/erp/app/modules/sales/ui/Quotes/QuotesTable.tsx:304 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx:1407 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx:1631 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx:2657 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/Quotes/QuoteLineForm.tsx:385 (pre-edit line) | Delete... | wired | opens DeleteXLine ConfirmDelete |
| apps/erp/app/modules/sales/ui/SalesOrder/SalesOrdersTable.tsx:559 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/Quotes/QuoteHeader.tsx:187 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx:358 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/CustomerStatuses/CustomerStatusesTable.tsx:80 (pre-edit line) | Delete... | wired | opens delete route (ConfirmDelete modal page) |
| apps/erp/app/modules/sales/ui/SalesRules/SalesRulesTable.tsx:153 (pre-edit line) | Delete... | wired | opens delete route (ConfirmDelete modal page) |
| apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQLineForm.tsx:244 (pre-edit line) | Delete... | wired | opens DeleteXLine ConfirmDelete |
| apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderExplorer.tsx:440 (pre-edit line) | Delete... | wired | opens DeleteXLine ConfirmDelete |
| apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQsTable.tsx:254 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQExplorer.tsx:458 (pre-edit line) | Delete... | wired | opens DeleteXLine ConfirmDelete |
| apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQHeader.tsx:134 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/Pricing/PricingRulesTable.tsx:453 (pre-edit line) | Delete... | wired | opens delete route (ConfirmDelete modal page) |
| apps/erp/app/modules/sales/ui/Customer/CustomerBankAccounts.tsx:218 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/Pricing/PriceOverrideForm.tsx:412 (pre-edit line) | Delete... | wired | opens pending-delete confirm dialog |
| apps/erp/app/modules/sales/ui/Customer/CustomerHeader.tsx:119 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/invoicing/ui/Payment/PaymentsTable.tsx:86 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceExplorer.tsx:382 (pre-edit line) | Delete... | wired | opens DeleteXLine ConfirmDelete |
| apps/erp/app/modules/invoicing/ui/Payment/PaymentForm.tsx:160 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx:314 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx:321 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/invoicing/ui/Memo/MemosTable.tsx:104 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx:321 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx:312 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer.tsx:331 (pre-edit line) | Delete... | wired | opens DeleteXLine ConfirmDelete |
| apps/erp/app/modules/invoicing/ui/Memo/MemoForm.tsx:123 (pre-edit line) | Delete... | wired | opens ConfirmDelete modal |
| apps/erp/app/modules/sales/ui/Opportunity/OpportunityDocuments.tsx:179 | Delete | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/sales/ui/Opportunity/OpportunityLineDocuments.tsx:521 | Delete | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/sales/ui/Opportunity/OpportunityLineDocuments.tsx:650 | Delete | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/inventory/ui/StorageTypes/StorageTypesTable.tsx:68 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx:477 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/Receipts/ReceiptForm/ReceiptForm.tsx:169 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/Shipments/ShipmentLines.tsx:470 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/Shipments/ShipmentsTable.tsx:354 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/Receipts/ReceiptsTable.tsx:339 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/WarehouseTransfers/WarehouseTransfersTable.tsx:219 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/Shipments/ShipmentForm/ShipmentForm.tsx:179 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/StorageUnits/StorageUnitsTable.tsx:558 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/Kanbans/KanbansTable.tsx:592 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountsTable.tsx:168 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/ShippingMethods/ShippingMethodsTable.tsx:117 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/StorageRules/StorageRulesTable.tsx:144 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/StockTransfers/StockTransfersTable.tsx:226 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/StockTransfers/StockTransferHeader.tsx:151 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/StockTransfers/StockTransferLines.tsx:222 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/WarehouseTransfers/WarehouseTransferForm.tsx:143 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/WarehouseTransfers/WarehouseTransferLines.tsx:208 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/PickingLists/PickingListsTable.tsx:185 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/PickingLists/PickingListHeader.tsx:141 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/StorageRules/StorageRulesGroups.tsx:263 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/inventory/ui/Batches/BatchPropertiesConfig.tsx:452 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/MaterialTypes/MaterialTypesTable.tsx:147 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Tools/ToolsTable.tsx:628 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Materials/MaterialsTable.tsx:713 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Tools/ToolHeader.tsx:104 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeHeader.tsx:142 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/MaterialSubstances/MaterialSubstanceTable.tsx:125 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticesTable.tsx:291 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/MaterialDimensions/MaterialDimensionsTable.tsx:132 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/MaterialFinishes/MaterialFinishesTable.tsx:133 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/MaterialShapes/MaterialShapesTable.tsx:125 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Parts/ConfigurationParameters.tsx:784 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Parts/ConfigurationParameters.tsx:1013 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Services/ServiceHeader.tsx:91 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/ItemPostingGroups/ItemPostingGroupsTable.tsx:73 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/UnitOfMeasure/UnitOfMeasuresTable.tsx:68 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Materials/MaterialHeader.tsx:94 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Parts/PartsTable.tsx:670 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Services/ServicesTable.tsx:522 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx:2878 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx:3477 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx:4036 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/ChangeNoticeActions/ChangeNoticeRequiredActionsTable.tsx:71 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/MaterialGrades/MaterialGradesTable.tsx:132 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Consumables/ConsumablesTable.tsx:562 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/ChangeNoticeTypes/ChangeNoticeTypesTable.tsx:59 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Consumables/ConsumableHeader.tsx:91 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Item/CustomerParts/CustomerParts.tsx:70 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Parts/PartHeader.tsx:104 | Delete... | wired | opens ConfirmDelete / navigates to ConfirmDelete delete route / custom confirm modal |
| apps/erp/app/modules/items/ui/Item/ItemDocuments.tsx:195 | Delete | skipped | deleteModel() immediate |
| apps/erp/app/modules/items/ui/Item/ItemDocuments.tsx:274 | Delete | skipped | deleteFile(file) immediate |
| apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeExplorer.tsx:205 | Delete | skipped | fetcher submit, no confirm |
| apps/erp/app/modules/items/ui/Item/MakeMethodTools.tsx:335 | Delete Version | skipped | commented-out code |
| apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntriesTable.tsx:257 | <Trans>Delete Journal Entry</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/Periods/PeriodsTable.tsx:164 | {t`Delete Period`} | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/PaymentTerms/PaymentTermsTable.tsx:114 | <Trans>Delete Payment Term</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryForm.tsx:224 | Delete Journal Entry | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/FixedAssets/FixedAssetsTable.tsx:197 | <Trans>Delete Asset</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/FixedAssets/DepreciationRunTable.tsx:107 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/CostCenters/CostCenterNode.tsx:86 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/FixedAssets/AssetClassesTable.tsx:136 | <Trans>Delete Asset Class</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/CostCenters/CostCentersListView.tsx:101 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/Dimensions/DimensionsTable.tsx:116 | <Trans>Delete Dimension</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/Projects/ProjectsTable.tsx:74 | <Trans>Delete Project</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTree.tsx:417 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTree.tsx:391 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/accounting/ui/Reports/PivotControlBar.tsx:460 | <Trans>Delete view</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteHeader.tsx:189 | <Trans>Delete Supplier Quote</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteLineForm.tsx:278 | <Trans>Delete Line</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrderHeader.tsx:148 | <Trans>Delete Supplier Return</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchasingRfq/PurchasingRFQsTable.tsx:257 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderExplorer.tsx:392 | <Trans>Delete Line</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteExplorer.tsx:338 | <Trans>Delete Line</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrdersTable.tsx:212 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchasingRfq/PurchasingRFQLineForm.tsx:192 | <Trans>Delete Line</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx:498 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx:437 | <Trans>Delete Purchase Orders</Trans> | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuotesTable.tsx:249 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchasingRfq/PurchasingRFQHeader.tsx:145 | <Trans>Delete RFQ</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderHeader.tsx:287 | <Trans>Delete Purchase Order</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchasingRfq/PurchasingRFQExplorer.tsx:312 | <Trans>Delete Line</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrderExplorer.tsx:355 | <Trans>Delete Line</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/Supplier/SupplierBankAccounts.tsx:218 | <Trans>Delete</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/SupplierInteraction/SupplierInteractionLineDocuments.tsx:322 | <Trans>Delete</Trans> | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/purchasing/ui/Supplier/SuppliersTable.tsx:432 | <Trans>Delete Supplier</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/Supplier/SupplierHeader.tsx:173 | <Trans>Delete Supplier</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/Supplier/SupplierProcesses.tsx:121 | <Trans>Delete Process</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/purchasing/ui/SupplierInteraction/SupplierInteractionDocuments.tsx:166 | <Trans>Delete</Trans> | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/purchasing/ui/SupplierTypes/SupplierTypesTable.tsx:80 | <Trans>Delete Supplier Type</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Procedures/ProcedureHeader.tsx:93 | <Trans>Delete Procedure</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/ScrapReasons/ScrapReasonsTable.tsx:67 | Delete Scrap Reason | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/DemandProjection/DemandProjectionTable.tsx:178 | Delete | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionHeader.tsx:167 | Delete Instruction | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionsTable.tsx:267 | Delete Instruction | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionExplorer.tsx:1171 | <Trans>Delete Step</Trans> | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/InspectionDocument/InspectionDocumentTable.tsx:156 | Delete Diagram | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/InspectionDocument/InspectionDocumentEditor.tsx:2800 | {t`Delete Inspection Plan`} | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/InspectionDocument/InspectionDocumentEditor.tsx:2607 | {t`Delete`} | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx:283 | Delete Job | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Procedures/ProcedureExplorer.tsx:688 | Delete Parameter | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Procedures/ProcedureExplorer.tsx:597 | Delete Step | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Procedures/ProceduresTable.tsx:210 | Delete Procedure | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Jobs/ProductionQuantitiesTable.tsx:204 | Delete Quantity | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx:4061 | Delete | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx:2762 | Delete | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx:2400 | Delete | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Jobs/JobsTable.tsx:735 | Delete Job | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Jobs/JobDocuments.tsx:574 | Delete | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/production/ui/Jobs/JobDocuments.tsx:443 | Delete | skipped | deletes immediately, no confirm |
| apps/erp/app/modules/production/ui/Jobs/ProductionEventsTable.tsx:223 | Delete Event | wired | opens ConfirmDelete/confirm dialog (modal, disclosure, state or delete route) |
| apps/erp/app/modules/production/ui/Jobs/JobsTable.tsx:707 | Delete Jobs (bulk) | skipped | onBulkUpdate submits immediately |
| erp/app/components/Layout/Navigation/GroupedContentSidebar.tsx:278 | Delete View | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/components/Configurator/ConfigurationEditor/ConfigurationEditor.tsx:349 | Delete Rule | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/settings/ui/SerialNumbers/ItemSerialSequencesTable.tsx:134 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/settings/ui/ApiKeys/ApiKeysTable.tsx:209 | Delete API Key | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/settings/ui/Printing/PrintersCard.tsx:163 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/settings/ui/Webhooks/WebhooksTable.tsx:189 | Delete Webhook | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/settings/ui/Approvals/ApprovalRuleCard.ee.tsx:129 | Delete Rule | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/settings/ui/CustomFields/CustomFieldsTableDetail.tsx:164 | Delete Custom Field | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/settings/ui/Companies/CompaniesListView.tsx:123 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/settings/ui/Companies/CompanyNode.tsx:100 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/Calibrations/GaugeCalibrationRecordsTable.tsx:378 | Delete Record | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/IssueTypes/IssueTypesTable.tsx:69 | Delete Type | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/GaugeTypes/GaugeTypesTable.tsx:69 | Delete Type | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/Gauge/GaugesTable.tsx:365 | Delete Gauge | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/Issue/IssueAssociations.tsx:290 | Delete Association | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/Issue/IssueHeader.tsx:118 | Delete Issue | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/Documents/QualityDocumentHeader.tsx:151 | Delete Document | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/Issue/IssuesTable.tsx:335 | Delete Issue | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/RiskRegister/RiskRegistersTable.tsx:262 | Delete Risk | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/IssueWorkflows/IssueWorkflowsTable.tsx:112 | Delete Template | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/Documents/QualityDocumentsTable.tsx:211 | Delete Document | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/quality/ui/RequiredActions/RequiredActionsTable.tsx:86 | Delete Action | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Processes/ProcessForm.tsx:383 | Delete Process | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Partners/PartnersTable.tsx:122 | Delete Partner | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Processes/ProcessesTable.tsx:376 | Delete Process | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Training/TrainingsTable.tsx:224 | Delete Training | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchesTable.tsx:362 | Delete Dispatch | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Training/TrainingExplorer.tsx:449 | Delete Question | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchExplorer.tsx:404 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Suggestions/SuggestionsTable.tsx:153 | Delete Suggestion | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/MaintenanceSchedule/MaintenanceSchedulesTable.tsx:262 | Delete Schedule | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Locations/LocationsTable.tsx:155 | Delete Location | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/FailureModes/FailureModesTable.tsx:82 | Delete Failure Mode | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/workflows/ui/WorkflowsTable.tsx:235 | tDelete Workflow | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Training/TrainingHeader.tsx:96 | Delete Training | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchHeader.tsx:99 | Delete Dispatch | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/resources/ui/Contractors/ContractorsTable.tsx:145 | Delete Contractor | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/users/ui/EmployeeTypes/EmployeeTypesTable.ee.tsx:79 | Delete Employee Type | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/people/ui/Timecards/TimecardsTable.tsx:230 | Delete Timecard | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/people/ui/Attributes/AttributeCategoriesTable.tsx:163 | Delete Category | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/people/ui/Attributes/AttributeCategoryDetail.tsx:136 | Delete Attribute | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/people/ui/Holidays/HolidaysTable.tsx:96 | Delete Holiday | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/people/ui/Departments/DepartmentNode.tsx:80 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/people/ui/Shifts/ShiftsTable.tsx:197 | Delete Shift | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/users/ui/Groups/GroupsTable.tsx:128 | Delete Group | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/people/ui/Departments/DepartmentsTable.tsx:91 | Delete Department | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/modules/people/ui/Departments/DepartmentsListView.tsx:95 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/routes/x+/fixed-asset+/$fixedAssetId.tsx:161 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/routes/x+/depreciation-run+/$depreciationRunId.tsx:148 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/routes/x+/person+/$personId.timecard.tsx:748 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| mes/app/routes/x+/timecard.tsx:457 | Delete | wired | opens confirm (modal state/disclosure or delete route ConfirmDelete/Confirm) |
| erp/app/components/RecordDocuments.tsx:203 | Delete | skipped | deleteAttachment removes storage file immediately |
| erp/app/components/DefaultAttachmentsPanel.tsx:243 | Delete | skipped | onDelete removes storage file immediately |
| erp/app/components/Documents.tsx:334 | Delete | skipped | deleteModel mutates immediately |
| erp/app/components/Documents.tsx:414 | Delete | skipped | deleteFile removes storage file immediately |
| erp/app/modules/settings/ui/Printing/PrintJobsTable.tsx:422 | Delete | skipped | fetcher.submit delete immediately |
| erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchNotes.tsx:348 | Delete | skipped | deleteFile removes storage file immediately |
| erp/app/routes/x+/resources+/assignments.tsx:248 | Delete Assignment | skipped | fetcher.submit immediately |
| erp/app/modules/documents/ui/Documents/DocumentsTable.tsx:482 | Permanently Delete | skipped | label does not start with Delete (out of scope; it does open a confirm) |
| erp/app/modules/resources/ui/WorkCenters/WorkCentersTable.tsx:330 | Deactivate Work Center | skipped | out of scope label |
| mes/app/components/JobOperation/JobOperation.tsx | (none) | skipped | no Delete menu item; only DeleteStepRecordModal |

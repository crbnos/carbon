import { getAppUrl, getMESUrl, SUPABASE_URL } from "@carbon/auth";
import { generatePath } from "react-router";

const x = "/x"; // from ~/routes/x+ folder
const api = "/api"; // from ~/routes/api+ folder
const file = "/file"; // from ~/routes/file+ folder
const share = "/share"; // from ~/routes/shared+ folder
const onboarding = "/onboarding"; // from ~/routes/onboarding+ folder
const selectCompany = "/select-company"; // from ~/routes/select-company+ folder
export const MES_URL = getMESUrl();
export const ERP_URL = getAppUrl();

export const path = {
  to: {
    abilities: `${x}/resources/abilities`,
    ability: (id: string) => generatePath(`${x}/resources/ability/${id}`),
    account: `${x}/account`,
    accounting: `${x}/accounting`,
    accountingDefaults: `${x}/accounting/defaults`,
    accountingGroupsBankAccounts: `${x}/accounting/groups/bank-accounts`,
    accountingGroupsFixedAssets: `${x}/accounting/groups/fixed-assets`,
    accountingGroupsInventory: `${x}/accounting/groups/inventory`,
    accountingGroupsPurchasing: `${x}/accounting/groups/purchasing`,
    accountingGroupsSales: `${x}/accounting/groups/sales`,
    accountingJournals: `${x}/accounting/journals`,
    accountingPeriodClose: (id: string) =>
      generatePath(`${x}/accounting/periods/${id}/close`),
    accountingPeriodDelete: (id: string) =>
      generatePath(`${x}/accounting/periods/${id}/delete`),
    accountingPeriods: `${x}/accounting/periods`,
    accountingPeriodsGenerate: `${x}/accounting/periods/generate`,
    accountingRoot: `${x}/accounting`,
    accountingSettings: `${x}/settings/accounting`,
    accountPassword: `${x}/account/password`,
    accountPersonal: `${x}/account/personal`,
    accountSecurity: `${x}/account/security`,
    acknowledge: `${x}/acknowledge`,
    activateGauge: (id: string) =>
      generatePath(`${x}/quality/gauges/activate/${id}`),
    activeMethodVersion: (id: string) =>
      generatePath(`${x}/items/methods/versions/activate/${id}`),
    addAndIssueMaintenanceDispatchItem: (dispatchId: string) =>
      generatePath(`${x}/maintenance/${dispatchId}/add-and-issue`),
    api: {
      abilities: `${api}/resources/abilities`,
      accounts: `${api}/accounting/accounts`,
      assetClasses: `${api}/accounting/asset-classes`,
      assign: `${api}/assign`,
      batchNumbers: (itemId: string) =>
        generatePath(`${api}/inventory/batch-numbers?itemId=${itemId}`),

      billOfMaterials: (methodId: string, withOperations: boolean = false) =>
        generatePath(
          `${api}/items/methods/${methodId}/bom?withOperations=${withOperations}`
        ),
      billOfMaterialsCsv: (methodId: string, withOperations: boolean = false) =>
        generatePath(
          `${api}/items/methods/${methodId}/bom.csv?withOperations=${withOperations}`
        ),
      chat: `${api}/ai/chat`,
      costCenters: `${api}/accounting/cost-centers`,
      countries: `${api}/countries`,
      createCsvLookup: `${api}/csv/create-lookup`,
      currencies: `${api}/accounting/currencies`,
      customerContacts: (id: string) =>
        generatePath(`${api}/sales/customer-contacts/${id}`),
      customerLocations: (id: string) =>
        generatePath(`${api}/sales/customer-locations/${id}`),
      customerStatuses: `${api}/sales/customer-statuses`,
      customerTypes: `${api}/sales/customer-types`,
      customFieldOptions: (table: string, fieldId: string) =>
        generatePath(`${api}/settings/custom-fields/${table}/${fieldId}`),
      departments: `${api}/people/departments`,
      digitalQuote: (id: string) =>
        generatePath(`${api}/sales/digital-quote/${id}`),
      digitalSupplierQuote: (id: string) =>
        generatePath(`${api}/purchasing/digital-quote/${id}`),
      docs: `${api}/docs`,
      employeeTypes: `${api}/users/employee-types`,
      emptyPermissions: `${api}/users/empty-permissions`,
      failureModes: `${api}/resources/failure-modes`,
      gauges: `${api}/quality/gauges`,
      generateCsvColumns: (table: string) =>
        generatePath(`${api}/ai/csv/${table}/columns`),
      inspectionDocumentBalloonAnalyze: (inspectionDocumentId: string) =>
        generatePath(
          `${api}/quality/inspection-document/${inspectionDocumentId}/balloon-analyze`
        ),
      item: (type: string) => generatePath(`${api}/item/${type}`),
      itemConfigurable: `${api}/items/configurable`,
      itemCostRecalculate: (itemId: string) =>
        generatePath(`${api}/items/${itemId}/recalculate-cost`),
      itemDrawing: `${api}/item/drawing`,
      itemForecast: (itemId: string, locationId: string) =>
        generatePath(`${api}/items/${itemId}/${locationId}/forecast`),
      itemMakeMethodStatus: (itemId: string) =>
        generatePath(`${api}/items/${itemId}/make-method-status`),
      itemMpns: `${api}/items/mpns`,
      itemPostingGroups: `${api}/items/groups`,
      itemRecipeProcesses: (itemId: string) =>
        generatePath(`${api}/items/${itemId}/recipe-processes`),
      jiraCreateIssue: `${api}/integrations/jira/issue/create`,
      jiraLinkExistingIssue: `${api}/integrations/jira/issue/link`,
      jiraSyncNotes: `${api}/integrations/jira/issue/sync-notes`,
      jobBillOfMaterials: (id: string, withOperations: boolean = false) =>
        generatePath(
          `${api}/production/methods/${id}/bom?withOperations=${withOperations}`
        ),
      jobBillOfMaterialsCsv: (id: string, withOperations: boolean = false) =>
        generatePath(
          `${api}/production/methods/${id}/bom.csv?withOperations=${withOperations}`
        ),
      jobs: `${api}/production/jobs`,
      kanban: (id: string) => generatePath(`${api}/kanban/${id}`),
      kanbanCollision: (id: string) =>
        generatePath(`${api}/kanban/collision/${id}`),
      kanbanComplete: (id: string) =>
        generatePath(`${api}/kanban/complete/${id}`),
      kanbanJobLink: (id: string) => generatePath(`${api}/kanban/link/${id}`),
      kanbanStart: (id: string) => generatePath(`${api}/kanban/start/${id}`),
      linearCreateIssue: `${api}/integrations/linear/issue/create`,
      linearLinkExistingIssue: `${api}/integrations/linear/issue/link`,
      linearSyncNotes: `${api}/integrations/linear/issue/sync-notes`,
      locations: `${api}/resources/locations`,
      maintenanceDispatches: `${api}/resources/maintenance`,
      maintenanceSchedules: `${api}/resources/scheduled-maintenance`,
      materialDimensions: (formId: string) =>
        generatePath(`${api}/items/dimensions/${formId}`),
      materialFinishes: (substanceId: string) =>
        generatePath(`${api}/items/finishes/${substanceId}`),
      materialForms: `${api}/items/forms`,
      materialGrades: (substanceId: string) =>
        generatePath(`${api}/items/grades/${substanceId}`),
      materialSubstances: `${api}/items/substances`,
      materials: (materialFormId?: string) =>
        generatePath(
          `${api}/items/materials${
            materialFormId ? `?materialFormId=${materialFormId}` : ""
          }`
        ),
      materialTypes: (substanceId: string, formId: string) =>
        generatePath(`${api}/items/types/${substanceId}/${formId}`),
      messagingNotify: `${api}/messaging/notify`,
      modelConvertStatus: (modelUploadId: string) =>
        generatePath(`${api}/model/convert-status/${modelUploadId}`),
      modelUpload: `${api}/model/upload`,
      mrp: (locationId?: string) =>
        generatePath(
          `${api}/mrp${locationId ? `?location=${locationId}` : ""}`
        ),
      onShapeBom: (documentId: string, versionId: string, elementId: string) =>
        generatePath(
          `${api}/integrations/onshape/d/${documentId}/v/${versionId}/e/${elementId}/bom`
        ),
      onShapeDocuments: `${api}/integrations/onshape/documents`,
      onShapeElements: (documentId: string, versionId: string) =>
        generatePath(
          `${api}/integrations/onshape/d/${documentId}/v/${versionId}/elements`
        ),
      onShapeSync: `${api}/integrations/onshape/sync`,
      onShapeVersions: (documentId: string) =>
        generatePath(`${api}/integrations/onshape/d/${documentId}/versions`),
      outsideOperations: (jobId: string) =>
        generatePath(`${api}/production/outside-operations/${jobId}`),
      outstandingTrainings: `${api}/resources/trainings`,
      paymentTerms: `${api}/accounting/payment-terms`,
      procedures: `${api}/production/procedures`,
      processes: `${api}/resources/processes`,
      productionKpi: (key: string) =>
        generatePath(`${api}/production/kpi/${key}`),
      purchaseInvoice: (id: string) =>
        generatePath(`${api}/purchase-invoice/${id}`),
      purchasingKpi: (key: string) =>
        generatePath(`${api}/purchasing/kpi/${key}`),
      qualityKpi: (key: string) => generatePath(`${api}/quality/kpi/${key}`),
      quoteBillOfMaterials: (
        methodId: string,
        withOperations: boolean = false
      ) =>
        generatePath(
          `${api}/sales/quote/line/${methodId}/bom?withOperations=${withOperations}`
        ),
      quoteBillOfMaterialsCsv: (
        methodId: string,
        withOperations: boolean = false
      ) =>
        generatePath(
          `${api}/sales/quote/line/${methodId}/bom.csv?withOperations=${withOperations}`
        ),
      quoteLines: (quoteId: string) =>
        generatePath(`${api}/sales/quotes/${quoteId}/lines`),
      quotes: `${api}/sales/quotes`,
      resourcesKpi: (key: string) =>
        generatePath(`${api}/resources/kpi/${key}`),
      rollback: (table: string, id: string) =>
        generatePath(
          `${api}/settings/sequence/rollback?table=${table}&currentSequence=${id}`
        ),
      salesCustomerOverride: `${api}/sales/customer-override`,
      salesKpi: (key: string) => generatePath(`${api}/sales/kpi/${key}`),
      salesOrders: `${api}/sales/orders`,
      salesResolvePrice: `${api}/sales/resolve-price`,
      salesRfq: (id: string) => generatePath(`${api}/sales-rfq/${id}`),
      scrapReasons: `${api}/production/scrap-reasons`,
      search: `${api}/search`,
      seedQualityDocuments: `${api}/quality/documents/seed`,
      sequences: (table: string) => `${api}/settings/sequences?table=${table}`,
      serialNumbers: (itemId: string, isReadOnly: boolean) =>
        generatePath(
          `${api}/inventory/serial-numbers?itemId=${itemId}&isReadOnly=${isReadOnly}`
        ),
      services: `${api}/items/services`,
      shifts: (id: string) =>
        generatePath(`${api}/people/shifts?location=${id}`),
      shippingMethods: `${api}/inventory/shipping-methods`,
      storageTypes: `${api}/inventory/storage-types`,
      storageUnitChildren: (parentId: string) =>
        generatePath(
          `${api}/inventory/storage-unit-children?parentId=${parentId}`
        ),
      storageUnitDescendants: (id: string) =>
        generatePath(`${api}/inventory/storage-unit-descendants?id=${id}`),
      storageUnits: (id: string) =>
        generatePath(`${api}/inventory/storage-units?locationId=${id}`),
      storageUnitsTree: (id: string) =>
        generatePath(`${api}/inventory/storage-units-tree?locationId=${id}`),
      storageUnitsWithQuantities: (locationId: string, itemId?: string) =>
        generatePath(
          `${api}/inventory/storage-units-with-quantities?locationId=${locationId}${
            itemId ? `&itemId=${itemId}` : ""
          }`
        ),
      supplierContacts: (id: string) =>
        generatePath(`${api}/purchasing/supplier-contacts/${id}`),
      supplierLocations: (id: string) =>
        generatePath(`${api}/purchasing/supplier-locations/${id}`),
      supplierProcesses: (id?: string) =>
        generatePath(`${api}/purchasing/supplier-processes/${id}`),
      supplierTypes: `${api}/purchasing/supplier-types`,
      tags: (table?: string) =>
        generatePath(`${api}/shared/tags?table=${table}`),
      timecard: `${api}/people/timecard`,
      unitOfMeasures: `${api}/items/uoms`,
      userSelectGroupEmails: (groupId: string) =>
        generatePath(`${api}/users/select/groups/${groupId}/emails`),
      userSelectGroupMembers: (groupId: string) =>
        generatePath(`${api}/users/select/groups/${groupId}/members`),
      userSelectGroups: (
        type: string | undefined,
        offset: number,
        limit = 25
      ) =>
        generatePath(
          `${api}/users/select/groups?type=${type ?? ""}&offset=${offset}&limit=${limit}`
        ),
      userSelectResolve: (ids: string[]) =>
        generatePath(`${api}/users/select/resolve?ids=${ids.join(",")}`),
      userSelectSearch: (q: string, type?: string) =>
        generatePath(
          `${api}/users/select/search?q=${encodeURIComponent(q)}&type=${type ?? ""}`
        ),
      webhookStripe: `${api}/webhook/stripe`,
      webhookTables: `${api}/webhook/tables`,
      workCenters: `${api}/resources/work-centers`,
      workCentersByLocation: (id: string) =>
        generatePath(`${api}/resources/work-centers?location=${id}`)
    },
    apiDocs: "https://docs.carbon.ms/api-reference",
    apiKey: (id: string) => generatePath(`${x}/settings/api-keys/${id}`),
    apiKeys: `${x}/settings/api-keys`,
    approvalRule: (id: string) =>
      generatePath(`${x}/settings/approval-rules/${id}`),
    approvalRules: `${x}/settings/approval-rules`,
    assemblyInstruction: (id: string) => generatePath(`${x}/assembly/${id}`),
    assemblyInstructionStatus: (id: string) =>
      generatePath(`${x}/assembly/${id}/status`),
    assemblyInstructionStep: (id: string, stepId: string) =>
      generatePath(`${x}/assembly/${id}/steps/${stepId}`),
    assemblyInstructionStepComponents: (id: string, stepId: string) =>
      generatePath(`${x}/assembly/${id}/steps/components/${stepId}`),
    assemblyInstructionStepComponentsReassign: (id: string) =>
      generatePath(`${x}/assembly/${id}/steps/components/reassign`),
    assemblyInstructionStepMotion: (id: string, stepId: string) =>
      generatePath(`${x}/assembly/${id}/steps/motion/${stepId}`),
    assemblyInstructionStepOrder: (id: string) =>
      generatePath(`${x}/assembly/${id}/steps/order`),
    assemblyInstructionStepStatus: (id: string, stepId: string) =>
      generatePath(`${x}/assembly/${id}/steps/status/${stepId}`),
    assemblyInstructions: `${x}/production/assemblies`,
    assemblyJobsCancel: (id: string) =>
      generatePath(`${x}/assembly/${id}/jobs/cancel`),
    assemblyModelConvert: (id: string) =>
      generatePath(`${x}/assembly/${id}/model/convert`),
    assemblyModelInvalidate: (id: string) =>
      generatePath(`${x}/assembly/${id}/model/invalidate`),
    assemblyPlanRerun: (id: string) =>
      generatePath(`${x}/assembly/${id}/plan/rerun`),
    assemblyStandardNote: (noteId: string) =>
      generatePath(`${x}/assembly/standard-notes/${noteId}`),
    assemblyStepMaterial: (id: string, materialId: string) =>
      generatePath(`${x}/assembly/${id}/materials/${materialId}`),
    assemblyStepMaterialOrder: (id: string) =>
      generatePath(`${x}/assembly/${id}/materials/order`),
    assemblyStepRequirement: (id: string, requirementId: string) =>
      generatePath(`${x}/assembly/${id}/requirements/${requirementId}`),
    assemblyStepRequirementOrder: (id: string) =>
      generatePath(`${x}/assembly/${id}/requirements/order`),
    assetClass: (id: string) =>
      generatePath(`${x}/accounting/asset-class/${id}`),
    assetClasses: `${x}/accounting/asset-classes`,
    assignIssueItemEntities: `${x}/issue/item/assign-entities`,
    attribute: (id: string) => generatePath(`${x}/people/attribute/${id}`),
    attributeCategory: (id: string) =>
      generatePath(`${x}/people/attributes/${id}`),
    attributeCategoryList: (id: string) =>
      generatePath(`${x}/people/attributes/list/${id}`),
    attributes: `${x}/people/attributes`,
    auditLog: `${x}/settings/audit-logs`,
    auditLogDetails: `${x}/settings/audit-logs/details`,
    authenticatedRoot: x,
    autoMatchAssemblyComponents: (id: string) =>
      generatePath(`${x}/assembly/${id}/component-mappings/auto`),
    backups: `${x}/settings/backups`,
    balanceSheet: `${x}/accounting/balance-sheet`,
    balanceSheetLedger: (id: string) =>
      generatePath(`${x}/accounting/balance-sheet/${id}`),
    batchProperty: (itemId: string) =>
      generatePath(`${x}/inventory/batch-property/${itemId}/property`),
    batchPropertyOrder: (itemId: string) =>
      generatePath(`${x}/inventory/batch-property/${itemId}/property/order`),
    billing: `${x}/settings/billing`,
    bulkEditPermissions: `${x}/users/bulk-edit-permissions`,
    bulkUpdateIssue: `${x}/issue/update`,
    bulkUpdateIssueWorkflow: `${x}/issue-workflow/update`,
    bulkUpdateItems: `${x}/items/update`,
    bulkUpdateJob: `${x}/job/update`,
    bulkUpdateProcedure: `${x}/procedure/update`,
    bulkUpdateProductionPlanning: `${x}/production/planning/update`,
    bulkUpdatePurchaseInvoice: `${x}/purchase-invoice/update`,
    bulkUpdatePurchaseOrder: `${x}/purchase-order/update`,
    bulkUpdatePurchasingPlanning: `${x}/purchasing/planning/update`,
    bulkUpdatePurchasingRfq: `${x}/purchasing-rfq/update`,
    bulkUpdateQualityDocument: `${x}/quality-document/update`,
    bulkUpdateQuote: `${x}/quote/update`,
    bulkUpdateReceiptLine: `${x}/receipt/lines/update`,
    bulkUpdateSalesInvoice: `${x}/sales-invoice/update`,
    bulkUpdateSalesOrder: `${x}/sales-order/update`,
    bulkUpdateSalesRfq: `${x}/sales-rfq/update`,
    bulkUpdateShipmentLine: `${x}/shipment/lines/update`,
    bulkUpdateStockTransferLine: `${x}/stock-transfer/lines/update`,
    bulkUpdateSupplierQuote: `${x}/supplier-quote/update`,
    bulkUpdateTraining: `${x}/training/update`,
    calibrations: `${x}/quality/calibrations`,
    cancelPurchasingRfq: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/cancel`),
    changeOrder: (id: string) => generatePath(`${x}/items/change-order/${id}`),
    changeOrderAction: (id: string) =>
      generatePath(`${x}/items/change-order/${id}/action`),
    changeOrderActionOrder: (id: string) =>
      generatePath(`${x}/items/change-order/${id}/action/order`),
    changeOrderActionStatus: (id: string, actionId: string) =>
      generatePath(`${x}/items/change-order/${id}/action/${actionId}/status`),
    // Change Order content (Phase 2): BOM change rows + per-assembly targets, and
    // freeform actions. Top-to-bottom: affected items selected first, then
    // per-item staged BOM/BOP/attributes edited in place.
    changeOrderAffected: (id: string) =>
      generatePath(`${x}/items/change-order/${id}/affected`),
    changeOrderAffectedChangeType: (id: string, affectedId: string) =>
      generatePath(
        `${x}/items/change-order/${id}/affected/${affectedId}/change-type`
      ),
    changeOrderAffectedCutover: (id: string, affectedId: string) =>
      generatePath(
        `${x}/items/change-order/${id}/affected/${affectedId}/cutover`
      ),
    // Each affected item is its own line-item detail route (mirrors the sales
    // order line detail `${x}/sales-order/${orderId}/${lineId}/details`). The URL
    // drives selection — refresh + back/forward reselect it.
    changeOrderAffectedItem: (id: string, affectedId: string) =>
      generatePath(`${x}/items/change-order/${id}/${affectedId}/details`),
    // Delete action for a supplier part managed on a CO line (Buy Revision/New
    // Part). Create/edit are reached relatively from the SupplierParts grid.
    changeOrderDeleteSupplierPart: (
      id: string,
      affectedId: string,
      supplierPartId: string
    ) =>
      generatePath(
        `${x}/items/change-order/${id}/${affectedId}/details/${supplierPartId}/delete`
      ),
    changeOrderDetails: (id: string) =>
      generatePath(`${x}/items/change-order/${id}/details`),
    changeOrderRequiredAction: (id: string) =>
      generatePath(`${x}/items/change-order-actions/${id}`),
    // Change Order Actions config (the changeOrderRequiredAction default-action
    // templates) — a sibling of the CO list, like change-order-types above.
    changeOrderRequiredActions: `${x}/items/change-order-actions`,
    changeOrderStatus: (id: string) =>
      generatePath(`${x}/items/change-order/${id}/status`),
    // Change Orders — a sub-area of the Items module. List + config live under
    // /x/items/change-orders; the detail record lives under /x/items/change-order/:id.
    changeOrders: `${x}/items/change-orders`,
    changeOrderType: (id: string) =>
      generatePath(`${x}/items/change-order-types/${id}`),
    // Change Order Types — a sibling of the CO list (not nested under it), so the
    // Items sidebar doesn't highlight both entries via prefix matching.
    changeOrderTypes: `${x}/items/change-order-types`,
    chartOfAccount: (id: string) =>
      generatePath(`${x}/accounting/charts/${id}`),
    chartOfAccounts: `${x}/accounting/charts`,
    chartOfAccountsLedger: (id: string) =>
      generatePath(`${x}/accounting/charts/ledger/${id}`),
    closeIssue: (id: string) => generatePath(`${x}/issue/${id}/close`),
    companies: `${x}/settings/companies`,
    company: `${x}/settings/company`,
    companySwitch: (companyId: string) =>
      generatePath(`${x}/settings/company/switch/${companyId}`),
    completeTrainingAssignment: (id: string) =>
      generatePath(`${share}/training/${id}`),
    configurationParameter: (itemId: string) =>
      generatePath(`${x}/part/${itemId}/parameter`),
    configurationParameterGroup: (itemId: string) =>
      generatePath(`${x}/part/${itemId}/parameter/group`),
    configurationParameterGroupOrder: (itemId: string) =>
      generatePath(`${x}/part/${itemId}/parameter/group/order`),
    configurationParameterOrder: (itemId: string) =>
      generatePath(`${x}/part/${itemId}/parameter/order`),
    configurationRule: (itemId: string) =>
      generatePath(`${x}/part/${itemId}/rule`),
    consumable: (id: string) => generatePath(`${x}/consumable/${id}`),
    consumableCosting: (id: string) =>
      generatePath(`${x}/consumable/${id}/costing`),
    consumableDetails: (id: string) =>
      generatePath(`${x}/consumable/${id}/details`),
    consumableInventory: (id: string) =>
      generatePath(`${x}/consumable/${id}/inventory`),
    consumableInventoryLocation: (id: string, locationId: string) =>
      generatePath(`${x}/consumable/${id}/inventory?location=${locationId}`),
    consumablePlanning: (id: string) =>
      generatePath(`${x}/consumable/${id}/planning`),
    consumablePlanningLocation: (id: string, locationId: string) =>
      generatePath(`${x}/consumable/${id}/planning?location=${locationId}`),
    consumablePurchasing: (id: string) =>
      generatePath(`${x}/consumable/${id}/purchasing`),
    consumableQuality: (id: string) =>
      generatePath(`${x}/consumable/${id}/quality`),
    consumableRoot: `${x}/consumable`,
    consumableRules: (id: string) =>
      generatePath(`${x}/consumable/${id}/rules`),
    consumableSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/consumable/${itemId}/purchasing/${id}`),
    consumableSuppliers: (id: string) =>
      generatePath(`${x}/consumable/${id}/suppliers`),
    consumables: `${x}/items/consumables`,
    contact: `${x}/people/contact`,
    contractor: (id: string) =>
      generatePath(`${x}/resources/contractors/${id}`),
    contractors: `${x}/resources/contractors`,
    convertQuoteToOrder: (id: string) =>
      generatePath(`${x}/quote/${id}/convert`),
    convertSupplierQuoteToOrder: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/convert`),
    costCenter: (id: string) =>
      generatePath(`${x}/accounting/cost-centers/${id}`),
    costCenters: `${x}/accounting/cost-centers`,
    customer: (id: string) => generatePath(`${x}/customer/${id}`),
    customerAccounting: (id: string) =>
      generatePath(`${x}/customer/${id}/accounting`),
    customerAccounts: `${x}/users/customers`,
    customerContact: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/contacts/${id}`),
    customerContacts: (id: string) =>
      generatePath(`${x}/customer/${id}/contacts`),
    customerDetails: (id: string) =>
      generatePath(`${x}/customer/${id}/details`),
    customerLocation: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/locations/${id}`),
    customerLocations: (id: string) =>
      generatePath(`${x}/customer/${id}/locations`),
    customerPart: (id: string, customerPartToItemId: string) =>
      generatePath(
        `${x}/part/${id}/sales/customer-parts/${customerPartToItemId}`
      ),
    customerPayment: (id: string) =>
      generatePath(`${x}/customer/${id}/payments`),
    customerPortal: (id: string) =>
      generatePath(`${x}/sales/customer-portals/${id}`),
    customerPortals: `${x}/sales/customer-portals`,
    customerRisks: (id: string) => generatePath(`${x}/customer/${id}/risks`),
    customerRoot: `${x}/customer`,
    customerShipping: (id: string) =>
      generatePath(`${x}/customer/${id}/shipping`),
    customerStatus: (id: string) =>
      generatePath(`${x}/sales/customer-statuses/${id}`),
    customerStatuses: `${x}/sales/customer-statuses`,
    customers: `${x}/sales/customers`,
    customerTax: (id: string) => generatePath(`${x}/customer/${id}/tax`),
    customerType: (id: string) =>
      generatePath(`${x}/sales/customer-types/${id}`),
    customerTypes: `${x}/sales/customer-types`,
    customField: (tableId: string, id: string) =>
      generatePath(`${x}/settings/custom-fields/${tableId}/${id}`),
    customFieldList: (id: string) =>
      generatePath(`${x}/settings/custom-fields/${id}`),
    customFields: `${x}/settings/custom-fields`,
    customFieldsTable: (table: string) =>
      generatePath(`${x}/settings/custom-fields/${table}`),

    deactivateUsers: `${x}/users/deactivate`,
    defaultRevision: (id: string) =>
      generatePath(`${x}/items/revisions/default/${id}`),
    deleteAbility: (id: string) =>
      generatePath(`${x}/resources/abilities/delete/${id}`),
    deleteAccountingCharts: (id: string) =>
      generatePath(`${x}/accounting/charts/delete/${id}`),
    deleteApiKey: (id: string) =>
      generatePath(`${x}/settings/api-keys/delete/${id}`),
    deleteApprovalRule: (id: string) =>
      generatePath(`${x}/settings/approval-rules/${id}/delete`),
    deleteAssemblyComponentMapping: (id: string, mappingId: string) =>
      generatePath(
        `${x}/assembly/${id}/component-mappings/delete/${mappingId}`
      ),
    deleteAssemblyInstruction: (id: string) =>
      generatePath(`${x}/assembly/delete/${id}`),
    deleteAssemblyInstructionStep: (id: string, stepId: string) =>
      generatePath(`${x}/assembly/${id}/steps/delete/${stepId}`),
    deleteAssemblyStandardNote: (noteId: string) =>
      generatePath(`${x}/assembly/standard-notes/delete/${noteId}`),
    deleteAssemblyStepMaterial: (id: string, materialId: string) =>
      generatePath(`${x}/assembly/${id}/materials/delete/${materialId}`),
    deleteAssemblyStepRequirement: (id: string, requirementId: string) =>
      generatePath(`${x}/assembly/${id}/requirements/delete/${requirementId}`),
    deleteAssemblyUnit: (id: string, unitId: string) =>
      generatePath(`${x}/assembly/${id}/units/delete/${unitId}`),
    deleteAssetClass: (id: string) =>
      generatePath(`${x}/accounting/asset-class/${id}/delete`),
    deleteAttribute: (id: string) =>
      generatePath(`${x}/people/attribute/delete/${id}`),
    deleteAttributeCategory: (id: string) =>
      generatePath(`${x}/people/attributes/delete/${id}`),
    deleteBatchProperty: (itemId: string, id: string) =>
      generatePath(
        `${x}/inventory/batch-property/${itemId}/property/delete/${id}`
      ),
    deleteChangeOrder: (id: string) =>
      generatePath(`${x}/items/change-order/delete/${id}`),
    deleteChangeOrderAction: (id: string, actionId: string) =>
      generatePath(`${x}/items/change-order/${id}/action/delete/${actionId}`),
    deleteChangeOrderAffected: (id: string, affectedId: string) =>
      generatePath(
        `${x}/items/change-order/${id}/affected/delete/${affectedId}`
      ),
    deleteChangeOrderRequiredAction: (id: string) =>
      generatePath(`${x}/items/change-order-actions/delete/${id}`),
    deleteChangeOrderType: (id: string) =>
      generatePath(`${x}/items/change-order-types/delete/${id}`),
    deleteCompany: (id: string) =>
      generatePath(`${x}/settings/companies/delete/${id}`),
    deleteConfigurationParameter: (itemId: string, id: string) =>
      generatePath(`${x}/part/${itemId}/parameter/delete/${id}`),
    deleteConfigurationParameterGroup: (itemId: string, id: string) =>
      generatePath(`${x}/part/${itemId}/parameter/group/delete/${id}`),
    deleteConfigurationRule: (itemId: string, field: string) =>
      generatePath(`${x}/part/${itemId}/rule/delete/${field}`),
    deleteConsumableSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/consumable/${itemId}/purchasing/${id}/delete`),
    deleteContractor: (id: string) =>
      generatePath(`${x}/resources/contractors/delete/${id}`),
    deleteCostCenter: (id: string) =>
      generatePath(`${x}/accounting/cost-centers/delete/${id}`),
    deleteCustomer: (id: string) => generatePath(`${x}/customer/${id}/delete`),
    deleteCustomerContact: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/contacts/delete/${id}`),
    deleteCustomerLocation: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/locations/delete/${id}`),
    deleteCustomerPart: (id: string, customerPartToItemId: string) =>
      generatePath(
        `${x}/part/${id}/sales/customer-parts/delete/${customerPartToItemId}`
      ),
    deleteCustomerPortal: (id: string) =>
      generatePath(`${x}/sales/customer-portals/delete/${id}`),
    deleteCustomerStatus: (id: string) =>
      generatePath(`${x}/sales/customer-statuses/delete/${id}`),
    deleteCustomerType: (id: string) =>
      generatePath(`${x}/sales/customer-types/delete/${id}`),
    deleteCustomField: (tableId: string, id: string) =>
      generatePath(`${x}/settings/custom-fields/${tableId}/delete/${id}`),
    deleteDemandProjections: (itemId: string, locationId: string) =>
      generatePath(
        `${x}/production/projections/delete/${itemId}/${locationId}`
      ),
    deleteDepartment: (id: string) =>
      generatePath(`${x}/people/departments/delete/${id}`),
    deleteDepreciationRun: (id: string) =>
      generatePath(`${x}/depreciation-run/${id}/delete`),
    deleteDimension: (id: string) =>
      generatePath(`${x}/accounting/dimensions/delete/${id}`),
    deleteDocument: (id: string) => generatePath(`${x}/documents/${id}/trash`),
    deleteDocumentPermanently: (id: string) =>
      generatePath(`${x}/documents/${id}/delete`),
    deleteEmployeeAbility: (abilityId: string, id: string) =>
      generatePath(`${x}/resources/ability/${abilityId}/employee/delete/${id}`),
    deleteEmployeeType: (id: string) =>
      generatePath(`${x}/users/employee-types/delete/${id}`),
    deleteExchangeRate: (id: string) =>
      generatePath(`${x}/accounting/exchange-rates/delete/${id}`),
    deleteFailureMode: (id: string) =>
      generatePath(`${x}/resources/failure-modes/delete/${id}`),
    deleteFixedAsset: (id: string) =>
      generatePath(`${x}/fixed-asset/${id}/delete`),
    deleteGauge: (id: string) =>
      generatePath(`${x}/quality/gauges/delete/${id}`),
    deleteGaugeCalibrationRecord: (id: string) =>
      generatePath(`${x}/quality/calibrations/delete/${id}`),
    deleteGaugeType: (id: string) =>
      generatePath(`${x}/quality/gauge-types/delete/${id}`),
    deleteGroup: (id: string) => generatePath(`${x}/users/groups/delete/${id}`),
    deleteHoliday: (id: string) =>
      generatePath(`${x}/people/holidays/delete/${id}`),
    deleteInspectionDocument: (id: string) =>
      generatePath(`${x}/inspection/${id}/delete`),
    deleteInvestigationType: (id: string) =>
      generatePath(`${x}/quality/investigation-types/delete/${id}`),
    deleteIssue: (id: string) => generatePath(`${x}/issue/delete/${id}`),
    deleteIssueAssociation: (id: string, type: string, associationId: string) =>
      generatePath(
        `${x}/issue/${id}/association/delete/${type}/${associationId}`
      ),
    deleteIssueType: (id: string) =>
      generatePath(`${x}/quality/issue-types/delete/${id}`),
    deleteIssueWorkflow: (id: string) =>
      generatePath(`${x}/issue-workflow/delete/${id}`),
    deleteItem: (id: string) => generatePath(`${x}/items/delete/${id}`),
    deleteItemPostingGroup: (id: string) =>
      generatePath(`${x}/items/groups/delete/${id}`),
    deleteJob: (id: string) => generatePath(`${x}/job/${id}/delete`),
    deleteJobMaterial: (jobId: string, id: string) =>
      generatePath(`${x}/job/methods/${jobId}/material/delete/${id}`),
    deleteJobOperationParameter: (id: string) =>
      generatePath(`${x}/job/methods/operation/parameter/delete/${id}`),
    deleteJobOperationStep: (id: string) =>
      generatePath(`${x}/job/methods/operation/step/delete/${id}`),
    deleteJobOperationTool: (id: string) =>
      generatePath(`${x}/job/methods/operation/tool/delete/${id}`),
    deleteJournalEntry: (id: string) =>
      generatePath(`${x}/journal-entry/${id}/delete`),
    deleteKanban: (id: string) =>
      generatePath(`${x}/inventory/kanbans/delete/${id}`),
    deleteLocation: (id: string) =>
      generatePath(`${x}/resources/locations/delete/${id}`),
    deleteMaintenanceDispatch: (id: string) =>
      generatePath(`${x}/resources/maintenance/delete/${id}`),
    deleteMaintenanceDispatchEvent: (dispatchId: string, eventId: string) =>
      generatePath(`${x}/maintenance/${dispatchId}/event/${eventId}/delete`),
    deleteMaintenanceDispatchItem: (dispatchId: string, itemId: string) =>
      generatePath(`${x}/maintenance/${dispatchId}/item/${itemId}/delete`),
    deleteMaintenanceSchedule: (id: string) =>
      generatePath(`${x}/resources/scheduled-maintenance/delete/${id}`),
    deleteMaterialDimension: (id: string) =>
      generatePath(`${x}/items/dimensions/delete/${id}`),
    deleteMaterialFinish: (id: string) =>
      generatePath(`${x}/items/finishes/delete/${id}`),
    deleteMaterialForm: (id: string) =>
      generatePath(`${x}/items/forms/delete/${id}`),
    deleteMaterialGrade: (id: string) =>
      generatePath(`${x}/items/grades/delete/${id}`),
    deleteMaterialSubstance: (id: string) =>
      generatePath(`${x}/items/substances/delete/${id}`),
    deleteMaterialSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/material/${itemId}/purchasing/${id}/delete`),
    deleteMaterialType: (id: string) =>
      generatePath(`${x}/items/types/delete/${id}`),
    deleteMethodMaterial: (id: string) =>
      generatePath(`${x}/items/methods/material/delete/${id}`),
    deleteMethodOperationParameter: (id: string) =>
      generatePath(`${x}/items/methods/operation/parameter/delete/${id}`),
    deleteMethodOperationStep: (id: string) =>
      generatePath(`${x}/items/methods/operation/step/delete/${id}`),
    deleteMethodOperationTool: (id: string) =>
      generatePath(`${x}/items/methods/operation/tool/delete/${id}`),
    deleteNoQuoteReason: (id: string) =>
      generatePath(`${x}/sales/no-quote-reasons/delete/${id}`),
    deleteNote: (id: string) => generatePath(`${x}/shared/notes/${id}/delete`),
    deletePartner: (id: string) =>
      generatePath(`${x}/resources/partners/delete/${id}`),
    deletePartSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/part/${itemId}/purchasing/${id}/delete`),
    deletePaymentTerm: (id: string) =>
      generatePath(`${x}/accounting/payment-terms/delete/${id}`),
    deletePriceOverride: (id: string) =>
      generatePath(`${x}/sales/price-list/delete/${id}`),
    deletePricingRule: (id: string) =>
      generatePath(`${x}/sales/pricing-rules/delete/${id}`),
    deletePrinterRoute: (id: string) =>
      generatePath(`${x}/settings/printing/${id}/delete`),
    deleteProcedure: (id: string) =>
      generatePath(`${x}/procedure/delete/${id}`),
    deleteProcedureParameter: (id: string, parameterId: string) =>
      generatePath(`${x}/procedure/${id}/parameters/delete/${parameterId}`),
    deleteProcedureStep: (id: string, stepId: string) =>
      generatePath(`${x}/procedure/${id}/steps/delete/${stepId}`),
    deleteProcess: (id: string) =>
      generatePath(`${x}/resources/processes/delete/${id}`),
    deleteProductionEvent: (id: string) =>
      generatePath(`${x}/job/methods/event/delete/${id}`),
    deleteProductionQuantity: (id: string) =>
      generatePath(`${x}/job/methods/quantity/delete/${id}`),
    deletePurchaseInvoice: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/delete`),
    deletePurchaseInvoiceLine: (invoiceId: string, lineId: string) =>
      generatePath(`${x}/purchase-invoice/${invoiceId}/${lineId}/delete`),
    deletePurchaseOrder: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/delete`),
    deletePurchaseOrderLine: (orderId: string, lineId: string) =>
      generatePath(`${x}/purchase-order/${orderId}/${lineId}/delete`),
    deletePurchasingRfq: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/delete`),
    deletePurchasingRfqLine: (id: string, lineId: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/${lineId}/delete`),
    deleteQualityDocument: (id: string) =>
      generatePath(`${x}/quality-document/delete/${id}`),
    deleteQualityDocumentStep: (id: string, stepId: string) =>
      generatePath(`${x}/quality-document/${id}/steps/delete/${stepId}`),
    deleteQuote: (id: string) => generatePath(`${x}/quote/${id}/delete`),
    deleteQuoteLine: (id: string, lineId: string) =>
      generatePath(`${x}/quote/${id}/${lineId}/delete`),
    deleteQuoteLineCost: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/${quoteId}/${lineId}/cost/delete`),
    deleteQuoteMaterial: (quoteId: string, lineId: string, id: string) =>
      generatePath(
        `${x}/quote/methods/${quoteId}/${lineId}/material/delete/${id}`
      ),
    deleteQuoteOperationParameter: (id: string) =>
      generatePath(`${x}/quote/methods/operation/parameter/delete/${id}`),
    deleteQuoteOperationStep: (id: string) =>
      generatePath(`${x}/quote/methods/operation/step/delete/${id}`),
    deleteQuoteOperationTool: (id: string) =>
      generatePath(`${x}/quote/methods/operation/tool/delete/${id}`),
    deleteReceipt: (id: string) => generatePath(`${x}/receipt/${id}/delete`),
    deleteRequiredAction: (id: string) =>
      generatePath(`${x}/quality/required-actions/delete/${id}`),
    deleteRisk: (id: string) => generatePath(`${x}/quality/risks/delete/${id}`),
    deleteSalesInvoice: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/delete`),
    deleteSalesInvoiceLine: (invoiceId: string, lineId: string) =>
      generatePath(`${x}/sales-invoice/${invoiceId}/${lineId}/delete`),
    deleteSalesOrder: (id: string) =>
      generatePath(`${x}/sales-order/${id}/delete`),
    deleteSalesOrderLine: (orderId: string, lineId: string) =>
      generatePath(`${x}/sales-order/${orderId}/${lineId}/delete`),
    deleteSalesRfq: (id: string) => generatePath(`${x}/sales-rfq/${id}/delete`),
    deleteSalesRfqLine: (id: string, lineId: string) =>
      generatePath(`${x}/sales-rfq/${id}/${lineId}/delete`),
    deleteSavedView: (id: string) =>
      generatePath(`${x}/shared/views/delete/${id}`),
    deleteScrapReason: (id: string) =>
      generatePath(`${x}/production/scrap-reasons/delete/${id}`),
    deleteShift: (id: string) =>
      generatePath(`${x}/people/shifts/delete/${id}`),
    deleteShipment: (id: string) => generatePath(`${x}/shipment/${id}/delete`),
    deleteShippingMethod: (id: string) =>
      generatePath(`${x}/inventory/shipping-methods/delete/${id}`),
    deleteStockTransfer: (id: string) =>
      generatePath(`${x}/stock-transfer/delete/${id}`),
    deleteStockTransferLine: (id: string, lineId: string) =>
      generatePath(`${x}/stock-transfer/${id}/line/${lineId}/delete`),
    deleteStorageRule: (id: string) =>
      generatePath(`${x}/inventory/storage-rules/${id}/delete`),
    deleteStorageType: (id: string) =>
      generatePath(`${x}/inventory/storage-types/delete/${id}`),
    deleteStorageUnit: (id: string) =>
      generatePath(`${x}/inventory/storage-units/delete/${id}`),
    deleteSuggestion: (id: string) =>
      generatePath(`${x}/resources/suggestions/delete/${id}`),
    deleteSupplier: (id: string) => generatePath(`${x}/supplier/${id}/delete`),
    deleteSupplierContact: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/contacts/delete/${id}`),
    deleteSupplierLocation: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/locations/delete/${id}`),
    deleteSupplierProcess: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/processes/delete/${id}`),
    deleteSupplierQuote: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/delete`),
    deleteSupplierQuoteLine: (id: string, lineId: string) =>
      generatePath(`${x}/supplier-quote/${id}/${lineId}/delete`),
    deleteSupplierType: (id: string) =>
      generatePath(`${x}/purchasing/supplier-types/delete/${id}`),
    deleteTimecard: (id: string) =>
      generatePath(`${x}/people/timecard/delete/${id}`),
    deleteToolSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/tool/${itemId}/purchasing/${id}/delete`),
    deleteTraining: (id: string) => generatePath(`${x}/training/delete/${id}`),
    deleteTrainingAssignment: (assignmentId: string) =>
      generatePath(
        `${x}/resources/assignments/assignment/${assignmentId}/delete`
      ),
    deleteTrainingQuestion: (id: string, questionId: string) =>
      generatePath(`${x}/training/${id}/questions/delete/${questionId}`),
    deleteUom: (id: string) => generatePath(`${x}/items/uom/delete/${id}`),
    deleteUserAttribute: (id: string) =>
      generatePath(`${x}/account/${id}/delete/attribute`),
    deleteWarehouseTransfer: (id: string) =>
      generatePath(`${x}/warehouse-transfer/${id}/delete`),
    deleteWebhook: (id: string) =>
      generatePath(`${x}/settings/webhooks/delete/${id}`),
    deleteWorkCenter: (id: string) =>
      generatePath(`${x}/resources/work-centers/delete/${id}`),
    demandProjection: (itemId: string, locationId: string) =>
      generatePath(`${x}/production/projections/${itemId}/${locationId}`),
    demandProjections: `${x}/production/projections`,
    department: (id: string) => generatePath(`${x}/people/departments/${id}`),
    departments: `${x}/people/departments`,
    depreciationRun: (id: string) =>
      generatePath(`${x}/depreciation-run/${id}`),
    depreciationRuns: `${x}/accounting/depreciation-runs`,
    dimension: (id: string) => generatePath(`${x}/accounting/dimensions/${id}`),
    dimensions: `${x}/accounting/dimensions`,
    document: (id: string) => generatePath(`${x}/documents/search/${id}`),
    documentFavorite: `${x}/documents/favorite`,
    documentRestore: (id: string) =>
      generatePath(`${x}/documents/${id}/restore`),
    documentSections: `${x}/templates/shared`,
    documents: `${x}/documents/search`,
    documentsTrash: `${x}/documents/search?q=trash`,
    documentTemplate: (type: string) => generatePath(`${x}/templates/${type}`),
    documentTemplates: `${x}/templates`,
    documentView: (id: string) =>
      generatePath(`${x}/documents/search/view/${id}`),
    download: (token: string) => `/download/${token}`,
    downloadError: (reason: string) => `/download/error?reason=${reason}`,
    duplicatePriceList: `${x}/sales/price-list/duplicate`,
    editMaintenanceDispatchEvent: (dispatchId: string, eventId: string) =>
      generatePath(`${x}/maintenance/${dispatchId}/event/${eventId}`),
    employeeAbility: (abilityId: string, id: string) =>
      generatePath(`${x}/resources/ability/${abilityId}/employee/${id}`),
    employeeAccount: (id: string) => generatePath(`${x}/users/employees/${id}`),
    employeeAccounts: `${x}/users/employees`,
    employeeType: (id: string) =>
      generatePath(`${x}/users/employee-types/${id}`),
    employeeTypes: `${x}/users/employee-types`,
    exchangeRate: (id: string) =>
      generatePath(`${x}/accounting/exchange-rates/${id}`),
    exchangeRates: `${x}/accounting/exchange-rates`,
    external: {
      mes: MES_URL,
      mesJobOperation: (id: string) => `${MES_URL}/x/operation/${id}`,
      mesJobOperationComplete: (id: string) => `${MES_URL}/x/end/${id}`,
      mesJobOperationStart: (id: string, type: "Setup" | "Labor" | "Machine") =>
        `${MES_URL}/x/start/${id}?type=${type}`,
      mesJobOperationsForJob: (jobId: string) =>
        `${MES_URL}/x/operations?search=${encodeURIComponent(jobId)}`
    },
    externalCustomer: (id: string) => generatePath(`/share/customer/${id}`),
    externalCustomerFile: (id: string, path: string) =>
      generatePath(`/share/customer/${id}/${path}`),
    externalQuote: (id: string) => generatePath(`/share/quote/${id}`),
    externalScar: (id: string) => generatePath(`/share/scar/${id}`),
    externalSupplierQuote: (id: string) =>
      generatePath(`/share/supplier-quote/${id}`),
    externalTraining: (assignmentId: string) =>
      generatePath(`/share/training/${assignmentId}`),
    failureMode: (id: string) =>
      generatePath(`${x}/resources/failure-modes/${id}`),
    failureModes: `${x}/resources/failure-modes`,
    feedback: `${x}/feedback`,
    file: {
      cadModel: (id: string) => generatePath(`${file}/model/${id}`),
      jobTraveler: (id: string) => generatePath(`${file}/traveler/${id}.pdf`),
      jobTravelerByJobId: (jobId: string) =>
        generatePath(`${file}/job/${jobId}/traveler.pdf`),
      kanbanLabelsPdf: (
        ids: string | string[],
        action: "order" | "start" | "complete"
      ) => {
        const idString = Array.isArray(ids) ? ids.join(",") : ids;
        return generatePath(
          `${file}/kanban/labels/${action}.pdf?ids=${idString}`
        );
      },
      kanbanQrCode: (id: string, action: "order" | "start" | "complete") =>
        generatePath(`${file}/kanban/${id}/${action}.png`),
      nonConformance: (id: string) => generatePath(`${file}/issue/${id}.pdf`),
      operationLabelsPdf: (
        id: string,
        {
          labelSize,
          trackedEntityId
        }: { labelSize?: string; trackedEntityId?: string } = {}
      ) => {
        let url = `${file}/operation/${id}/labels.pdf`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (trackedEntityId) params.append("trackedEntityId", trackedEntityId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      operationLabelsZpl: (
        id: string,
        {
          labelSize,
          trackedEntityId
        }: { labelSize?: string; trackedEntityId?: string } = {}
      ) => {
        let url = `${file}/operation/${id}/labels.zpl`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (trackedEntityId) params.append("trackedEntityId", trackedEntityId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      preview: (bucket: string, path: string) =>
        generatePath(`${file}/preview/${bucket}/${path}`),
      previewFile: (path: string) => generatePath(`${file}/preview/${path}`),
      previewImage: (bucket: string, path: string) =>
        generatePath(`${file}/preview/image?file=${bucket}/${path}`),
      purchaseOrder: (id: string) =>
        generatePath(`${file}/purchase-order/${id}.pdf`),
      quote: (id: string) => generatePath(`${file}/quote/${id}.pdf`),
      receiptLabelsPdf: (
        id: string,
        { labelSize, lineId }: { labelSize?: string; lineId?: string } = {}
      ) => {
        let url = `${file}/receipt/${id}/labels.pdf`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (lineId) params.append("lineId", lineId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      receiptLabelsZpl: (
        id: string,
        { labelSize, lineId }: { labelSize?: string; lineId?: string } = {}
      ) => {
        let url = `${file}/receipt/${id}/labels.zpl`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (lineId) params.append("lineId", lineId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      salesInvoice: (id: string) =>
        generatePath(`${file}/sales-invoice/${id}.pdf`),

      salesOrder: (id: string) => generatePath(`${file}/sales-order/${id}.pdf`),
      shipment: (id: string) => generatePath(`${file}/shipment/${id}.pdf`),
      shipmentLabelsPdf: (
        id: string,
        { labelSize, lineId }: { labelSize?: string; lineId?: string } = {}
      ) => {
        let url = `${file}/shipment/${id}/labels.pdf`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (lineId) params.append("lineId", lineId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      shipmentLabelsZpl: (
        id: string,
        { labelSize, lineId }: { labelSize?: string; lineId?: string } = {}
      ) => {
        let url = `${file}/shipment/${id}/labels.zpl`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (lineId) params.append("lineId", lineId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      stockTransfer: (id: string) =>
        generatePath(`${file}/stock-transfer/${id}.pdf`),
      stockTransferLabelsPdf: (
        id: string,
        { labelSize, lineId }: { labelSize?: string; lineId?: string } = {}
      ) => {
        let url = `${file}/stock-transfer/${id}/labels.pdf`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (lineId) params.append("lineId", lineId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      stockTransferLabelsZpl: (
        id: string,
        { labelSize, lineId }: { labelSize?: string; lineId?: string } = {}
      ) => {
        let url = `${file}/stock-transfer/${id}/labels.zpl`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (lineId) params.append("lineId", lineId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      storageUnitLabelsPdf: (
        ids: string | string[],
        opts?: { labelSize?: string }
      ) => {
        const idString = Array.isArray(ids) ? ids.join(",") : ids;
        let url = `${file}/storage-unit/labels.pdf?ids=${idString}`;
        if (opts?.labelSize) url += `&labelSize=${opts.labelSize}`;
        return url;
      },
      storageUnitLabelsZpl: (
        ids: string | string[],
        opts?: { labelSize?: string }
      ) => {
        const idString = Array.isArray(ids) ? ids.join(",") : ids;
        let url = `${file}/storage-unit/labels.zpl?ids=${idString}`;
        if (opts?.labelSize) url += `&labelSize=${opts.labelSize}`;
        return url;
      },
      trackedEntityLabelPdf: (
        id: string,
        { labelSize }: { labelSize?: string } = {}
      ) => {
        let url = `${file}/entity/${id}/labels.pdf`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      trackedEntityLabelZpl: (
        id: string,
        { labelSize }: { labelSize?: string } = {}
      ) => {
        let url = `${file}/entity/${id}/labels.zpl`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      }
    },
    fiscalYears: `${x}/accounting/years`,
    fixedAsset: (id: string) => generatePath(`${x}/fixed-asset/${id}`),
    fixedAssetDetails: (id: string) =>
      generatePath(`${x}/fixed-asset/${id}/details`),
    fixedAssetDispose: (id: string) =>
      generatePath(`${x}/fixed-asset/${id}/dispose`),
    fixedAssetImport: `${x}/accounting/fixed-asset-import`,
    fixedAssetPurchase: (id: string) =>
      generatePath(`${x}/fixed-asset/${id}/purchase`),
    fixedAssetRegister: (id: string) =>
      generatePath(`${x}/fixed-asset/${id}/register`),
    fixedAssetSell: (id: string) => generatePath(`${x}/fixed-asset/${id}/sell`),
    fixedAssets: `${x}/accounting/fixed-assets`,
    gauge: (id: string) => generatePath(`${x}/quality/gauges/${id}`),
    gaugeCalibrationRecord: (id: string) =>
      generatePath(`${x}/quality/calibrations/${id}`),
    gaugeCalibrationRecords: `${x}/quality/calibrations`,
    gaugeDeactivate: (id: string) =>
      generatePath(`${x}/quality/gauges/deactivate/${id}`),
    gauges: `${x}/quality/gauges`,
    gaugeType: (id: string) => generatePath(`${x}/quality/gauge-types/${id}`),
    gaugeTypes: `${x}/quality/gauge-types`,
    generateAssemblyInstructionSteps: (id: string) =>
      generatePath(`${x}/assembly/${id}/steps/generate`),
    getStarted: `${x}/get-started`,
    getStartedEnroll: `${x}/get-started/enroll`,
    getStartedPage: (slug: string) => generatePath(`${x}/get-started/${slug}`),
    getStartedState: `${x}/get-started/state`,
    group: (id: string) => generatePath(`${x}/users/groups/${id}`),
    groups: `${x}/users/groups`,
    holiday: (id: string) => generatePath(`${x}/people/holidays/${id}`),
    holidays: `${x}/people/holidays`,
    import: (tableId: string) => generatePath(`${x}/shared/import/${tableId}`),
    inboundInspection: (id: string) =>
      generatePath(`${x}/quality/inbound-inspections/${id}`),
    inboundInspections: `${x}/quality/inbound-inspections`,
    incomeStatement: `${x}/accounting/income-statement`,
    incomeStatementLedger: (id: string) =>
      generatePath(`${x}/accounting/income-statement/${id}`),
    inspectionDocument: (id: string) => generatePath(`${x}/inspection/${id}`),
    inspectionDocuments: `${x}/quality/inspection`,
    integration: (id: string) =>
      generatePath(`${x}/settings/integrations/${id}`),
    integrationDeactivate: (id: string) =>
      generatePath(`${x}/settings/integrations/deactivate/${id}`),
    integrations: `${x}/settings/integrations`,
    intercompany: `${x}/accounting/intercompany`,
    inventory: `${x}/inventory/quantities`,
    inventoryCount: (id: string) => generatePath(`${x}/inventory-count/${id}`),
    inventoryCountConfirm: (id: string) =>
      generatePath(`${x}/inventory-count/${id}/confirm`),
    inventoryCountDelete: (id: string) =>
      generatePath(`${x}/inventory-count/${id}/delete`),
    inventoryCountLineUpdate: `${x}/inventory-count/lines/update`,
    inventoryCountPost: (id: string) =>
      generatePath(`${x}/inventory-count/${id}/post`),
    inventoryCountRectify: (id: string) =>
      generatePath(`${x}/inventory-count/${id}/rectify`),
    inventoryCountReopen: (id: string) =>
      generatePath(`${x}/inventory-count/${id}/reopen`),
    inventoryCounts: `${x}/inventory/inventory-count`,
    inventoryItem: (id: string) =>
      generatePath(`${x}/inventory/quantities/${id}/details`),
    inventoryItemActivity: (id: string) =>
      generatePath(`${x}/inventory/quantities/${id}/activity`),
    inventoryItemAdjustment: (id: string) =>
      generatePath(`${x}/inventory/quantities/${id}/adjustment`),
    inventoryRoot: `${x}/inventory`,
    inventorySettings: `${x}/settings/inventory`,
    inventoryValuation: `${x}/inventory/valuation`,
    inventoryValuationReconcile: `${x}/inventory/valuation/reconcile`,
    investigationType: (id: string) =>
      generatePath(`${x}/quality/investigation-types/${id}`),
    investigationTypes: `${x}/quality/investigation-types`,
    invoicing: `${x}/invoicing`,
    invoicingPurchasing: `${x}/invoicing/purchasing`,
    invoicingSales: `${x}/invoicing/sales`,
    issue: (id: string) => generatePath(`${x}/issue/${id}`),
    issueActionDueDate: (id: string) =>
      generatePath(`${x}/issue/action/${id}/due-date`),
    issueActionProcesses: (id: string) =>
      generatePath(`${x}/issue/action/${id}/processes`),
    issueActions: (id: string) => generatePath(`${x}/issue/${id}`),
    issueActionTasksOrder: `${x}/issue/action-tasks/order`,
    issueDetails: (id: string) => generatePath(`${x}/issue/${id}/details`),
    issueDispositions: (id: string) =>
      generatePath(`${x}/issue/${id}/dispositions`),
    issueReview: (id: string) => generatePath(`${x}/issue/${id}/review`),
    issueStatus: (id: string) => generatePath(`${x}/issue/${id}/status`),
    issues: `${x}/quality/issues`,
    issueTaskStatus: (id: string) =>
      generatePath(`${x}/issue/task/${id}/status`),
    issueTaskSupplier: `${x}/issue/task/supplier`,
    issueType: (id: string) => generatePath(`${x}/quality/issue-types/${id}`),
    issueTypes: `${x}/quality/issue-types`,
    issueWorkflow: (id: string) => generatePath(`${x}/issue-workflow/${id}`),
    issueWorkflows: `${x}/quality/issue-workflows`,
    itemCostUpdate: (id: string) => generatePath(`${x}/items/cost/${id}`),
    itemPostingGroup: (id: string) => generatePath(`${x}/items/groups/${id}`),
    itemPostingGroups: `${x}/items/groups`,
    itemProperties: (id: string) => generatePath(`${x}/items/${id}/properties`),
    items: `${x}/items`,
    itemsSettings: `${x}/settings/items`,
    job: (id: string) => generatePath(`${x}/job/${id}`),
    jobBatchNumber: (id: string) => generatePath(`${x}/job/${id}/batch`),
    jobComplete: (id: string) => generatePath(`${x}/job/${id}/complete`),
    jobConfigure: (id: string) => generatePath(`${x}/job/${id}/configure`),
    jobDag: (id: string) => generatePath(`${x}/job/${id}/dag`),
    jobDetails: (id: string) => generatePath(`${x}/job/${id}/details`),
    jobInspectionSteps: (id: string) =>
      generatePath(`${x}/job/${id}/steps?filter=type:eq:Inspection`),
    jobMakeMethod: (jobId: string, makeMethodId: string) =>
      generatePath(`${x}/job/${jobId}/make/${makeMethodId}`),
    jobMaterial: (jobId: string, id: string) =>
      generatePath(`${x}/job/methods/${jobId}/material/${id}`),
    jobMaterials: (id: string) => generatePath(`${x}/job/${id}/materials`),
    jobMaterialsOrder: `${x}/job/methods/material/order`,
    jobMethod: (jobId: string, methodId: string) =>
      generatePath(`${x}/job/${jobId}/method/${methodId}`),
    jobMethodGet: `${x}/job/methods/get`,
    jobMethodSave: `${x}/job/methods/save`,
    jobOperation: (jobId: string, id: string) =>
      generatePath(`${x}/job/methods/${jobId}/operation/${id}`),
    jobOperationDueDate: `${x}/job/methods/operation/due-date`,
    jobOperationParameter: (id: string) =>
      generatePath(`${x}/job/methods/operation/parameter/${id}`),
    jobOperationProcedureSync: `${x}/job/methods/operation/procedure/sync`,
    jobOperationStatus: `${x}/job/methods/operation/status`,
    jobOperationStep: (id: string) =>
      generatePath(`${x}/job/methods/operation/step/${id}`),
    jobOperationStepOrder: (operationId: string) =>
      generatePath(`${x}/job/methods/operation/${operationId}/step/order`),
    jobOperationStepRecords: (id: string) =>
      generatePath(`${x}/job/${id}/steps`),
    jobOperations: (id: string) => generatePath(`${x}/job/${id}/operations`),
    jobOperationsDelete: (jobId: string) =>
      generatePath(`${x}/job/methods/${jobId}/operation/delete`),
    jobOperationsOrder: (jobId: string) =>
      generatePath(`${x}/job/methods/${jobId}/operation/order`),
    jobOperationTool: (id: string) =>
      generatePath(`${x}/job/methods/operation/tool/${id}`),
    jobProductionEvent: (jobId: string, eventId: string) =>
      generatePath(`${x}/job/${jobId}/events/${eventId}`),
    jobProductionEvents: (id: string) => generatePath(`${x}/job/${id}/events`),
    jobProductionQuantities: (id: string) =>
      generatePath(`${x}/job/${id}/quantities`),
    jobRecalculate: (id: string) => generatePath(`${x}/job/${id}/recalculate`),
    jobRelease: (id: string) => generatePath(`${x}/job/${id}/release`),
    jobStatus: (id: string) => generatePath(`${x}/job/${id}/status`),
    jobs: `${x}/production/jobs`,
    journalEntry: (id: string) => generatePath(`${x}/journal-entry/${id}`),
    journalEntryDetails: (id: string) =>
      generatePath(`${x}/journal-entry/${id}/details`),
    journalLineDimensions: (lineId: string) =>
      `/api/accounting/journal-line-dimensions/${lineId}`,
    kanban: (id: string) => generatePath(`${x}/inventory/kanbans/${id}`),
    kanbans: `${x}/inventory/kanbans`,
    legal: {
      privacyPolicy: "https://carbon.ms/privacy",
      termsAndConditions: "https://carbon.ms/terms"
    },
    location: (id: string) => generatePath(`${x}/resources/locations/${id}`),
    locations: `${x}/resources/locations`,
    login: "/login",
    logos: `${x}/settings/logos`,
    logout: "/logout",
    maintenanceDispatch: (id: string) => generatePath(`${x}/maintenance/${id}`),
    maintenanceDispatchComments: (id: string) =>
      generatePath(`${x}/maintenance/${id}/comments`),
    maintenanceDispatchEvents: (id: string) =>
      generatePath(`${x}/maintenance/${id}/events`),
    maintenanceDispatches: `${x}/resources/maintenance`,
    maintenanceDispatchItems: (id: string) =>
      generatePath(`${x}/maintenance/${id}/items`),
    maintenanceDispatchStatus: (id: string) =>
      generatePath(`${x}/maintenance/${id}/status`),
    maintenanceDispatchUpdate: `${x}/maintenance/update`,
    maintenanceDispatchWorkCenters: (id: string) =>
      generatePath(`${x}/maintenance/${id}/work-centers`),
    maintenanceSchedule: (id: string) =>
      generatePath(`${x}/resources/scheduled-maintenance/${id}`),
    maintenanceSchedules: `${x}/resources/scheduled-maintenance`,
    makeMethodGet: `${x}/items/methods/get`,
    makeMethodSave: `${x}/items/methods/save`,
    manualPrint: `${x}/print`,
    markTrainingComplete: `${x}/resources/assignments/complete`,
    material: (id: string) => generatePath(`${x}/material/${id}`),
    materialCosting: (id: string) =>
      generatePath(`${x}/material/${id}/costing`),
    materialDetails: (id: string) =>
      generatePath(`${x}/material/${id}/details`),
    materialDimension: (id: string) =>
      generatePath(`${x}/items/dimensions/${id}`),
    materialDimensions: `${x}/items/dimensions`,
    materialFinish: (id: string) => generatePath(`${x}/items/finishes/${id}`),
    materialFinishes: `${x}/items/finishes`,
    materialForm: (id: string) => generatePath(`${x}/items/forms/${id}`),
    materialForms: `${x}/items/forms`,
    materialGrade: (id: string) => generatePath(`${x}/items/grades/${id}`),
    materialGrades: `${x}/items/grades`,
    materialInventory: (id: string) =>
      generatePath(`${x}/material/${id}/inventory`),
    materialInventoryLocation: (id: string, locationId: string) =>
      generatePath(`${x}/material/${id}/inventory?location=${locationId}`),
    materialPlanning: (id: string) =>
      generatePath(`${x}/material/${id}/planning`),
    materialPlanningLocation: (id: string, locationId: string) =>
      generatePath(`${x}/material/${id}/planning?location=${locationId}`),
    materialPricing: (id: string) =>
      generatePath(`${x}/material/${id}/pricing`),
    materialPurchasing: (id: string) =>
      generatePath(`${x}/material/${id}/purchasing`),
    materialQuality: (id: string) =>
      generatePath(`${x}/material/${id}/quality`),
    materialRoot: `${x}/material`,
    materialRules: (id: string) => generatePath(`${x}/material/${id}/rules`),
    materialSubstance: (id: string) =>
      generatePath(`${x}/items/substances/${id}`),
    materialSubstances: `${x}/items/substances`,
    materialSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/material/${itemId}/purchasing/${id}`),
    materialSuppliers: (id: string) =>
      generatePath(`${x}/material/${id}/suppliers`),
    materials: `${x}/items/materials`,
    materialType: (id: string) => generatePath(`${x}/items/types/${id}`),
    materialTypes: `${x}/items/types`,
    mcpDocs: "https://docs.carbon.ms/mcp",
    // Credit / Debit memos — payment-shaped documents (the `memo` table). The
    // list lives in the invoicing nav beside Payments; details mirror payments.
    memo: (id: string) => generatePath(`${x}/credits/${id}`),
    memoDelete: (id: string) => generatePath(`${x}/credits/${id}/delete`),
    memoNew: `${x}/credits/new`,
    memoPost: (id: string) => generatePath(`${x}/credits/${id}/post`),
    memos: `${x}/invoicing/credits`,
    memoVoid: (id: string) => generatePath(`${x}/credits/${id}/void`),
    methodMaterial: (id: string) =>
      generatePath(`${x}/items/methods/material/${id}`),
    methodMaterials: `${x}/items/methods/materials`,
    methodMaterialsOrder: `${x}/items/methods/material/order`,
    methodOperation: (id: string) =>
      generatePath(`${x}/items/methods/operation/${id}`),
    methodOperationParameter: (id: string) =>
      generatePath(`${x}/items/methods/operation/parameter/${id}`),
    methodOperationStep: (id: string) =>
      generatePath(`${x}/items/methods/operation/step/${id}`),
    methodOperationStepOrder: (operationId: string) =>
      generatePath(`${x}/items/methods/operation/${operationId}/step/order`),
    methodOperations: `${x}/items/methods/operations`,
    methodOperationsDelete: `${x}/items/methods/operation/delete`,
    methodOperationsOrder: `${x}/items/methods/operation/order`,
    methodOperationTool: (id: string) =>
      generatePath(`${x}/items/methods/operation/tool/${id}`),
    moveChartOfAccount: (id: string) =>
      generatePath(`${x}/accounting/charts/move/${id}`),
    newAbility: `${x}/resources/abilities/new`,
    newApiKey: `${x}/settings/api-keys/new`,
    newApprovalRule: (documentType?: string) =>
      documentType
        ? `${x}/settings/approval-rules/new?type=${documentType}`
        : `${x}/settings/approval-rules/new`,
    newAssemblyComponentMapping: (id: string) =>
      generatePath(`${x}/assembly/${id}/component-mappings/new`),
    newAssemblyInstruction: `${x}/production/assemblies/new`,
    newAssemblyInstructionStep: (id: string) =>
      generatePath(`${x}/assembly/${id}/steps/new`),
    newAssemblyStandardNote: `${x}/assembly/standard-notes/new`,
    newAssemblyStepMaterial: (id: string) =>
      generatePath(`${x}/assembly/${id}/materials/new`),
    newAssemblyStepRequirement: (id: string) =>
      generatePath(`${x}/assembly/${id}/requirements/new`),
    newAssemblyUnit: (id: string) =>
      generatePath(`${x}/assembly/${id}/units/new`),
    newAssetClass: `${x}/accounting/asset-classes/new`,
    newAttribute: `${x}/people/attribute/new`,
    newAttributeCategory: `${x}/people/attributes/new`,
    newAttributeForCategory: (id: string) =>
      generatePath(`${x}/people/attributes/list/${id}/new`),
    newBatch: `${x}/inventory/batches/new`,
    newBulkJob: `${x}/job/bulk/new`,
    // Create form lives at its own top-level route (like /x/part/new and
    // /x/sales-order/new) so it renders with the app sidebar rather than nested
    // under the Items module layout.
    newChangeOrder: `${x}/change-order/new`,
    // One-click create-a-CO-for-this-item (POST) — used by the part version
    // dropdown and the new-revision modal.
    newChangeOrderFromItem: (itemId: string) =>
      generatePath(`${x}/items/change-order/new-from-item/${itemId}`),
    newChangeOrderRequiredAction: `${x}/items/change-order-actions/new`,
    newChangeOrderType: `${x}/items/change-order-types/new`,
    newChartOfAccount: `${x}/accounting/charts/new`,
    newChartOfAccountGroup: `${x}/accounting/charts/new-group`,
    newCompany: `${x}/settings/company/new`,
    newCompanyInGroup: `${x}/settings/companies/new`,
    newConsumable: `${x}/consumable/new`,
    newConsumableSupplier: (id: string) =>
      generatePath(`${x}/consumable/${id}/purchasing/new`),
    newContractor: `${x}/resources/contractors/new`,
    newCostCenter: `${x}/accounting/cost-centers/new`,
    newCustomer: `${x}/customer/new`,
    newCustomerAccount: `${x}/users/customers/new`,
    newCustomerContact: (id: string) =>
      generatePath(`${x}/customer/${id}/contacts/new`),
    newCustomerLocation: (id: string) =>
      generatePath(`${x}/customer/${id}/locations/new`),
    newCustomerPart: (id: string) =>
      generatePath(`${x}/part/${id}/sales/customer-parts/new`),
    newCustomerPortal: `${x}/sales/customer-portals/new`,
    newCustomerStatus: `${x}/sales/customer-statuses/new`,
    newCustomerType: `${x}/sales/customer-types/new`,
    newCustomField: (tableId: string) =>
      generatePath(`${x}/settings/custom-fields/${tableId}/new`),
    newDemandProjection: `${x}/production/projections/new`,
    newDepartment: `${x}/people/departments/new`,
    newDepreciationRun: `${x}/accounting/depreciation-runs/new`,
    newDimension: `${x}/accounting/dimensions/new`,
    newDocument: `${x}/documents/new`,
    newEmployee: `${x}/users/employees/new`,
    newEmployeeAbility: (id: string) =>
      generatePath(`${x}/resources/ability/${id}/employee/new`),
    newEmployeeType: `${x}/users/employee-types/new`,
    newExchangeRate: `${x}/accounting/exchange-rates/new`,
    newFailureMode: `${x}/resources/failure-modes/new`,
    newFixedAsset: `${x}/accounting/fixed-assets/new`,
    newFixture: `${x}/fixture/new`,
    newFixtureSupplier: (id: string) =>
      generatePath(`${x}/fixture/${id}/purchasing/new`),
    newGauge: `${x}/quality/gauges/new`,
    newGaugeCalibrationRecord: `${x}/quality/calibrations/new`,
    newGaugeType: `${x}/quality/gauge-types/new`,
    newGroup: `${x}/users/groups/new`,
    newHoliday: `${x}/people/holidays/new`,
    newInspectionDocument: `${x}/quality/inspection/new`,
    newIntercompanyTransaction: `${x}/accounting/intercompany/new`,
    newInventoryCount: `${x}/inventory/inventory-count/new`,
    newInvestigationType: `${x}/quality/investigation-types/new`,
    newIssue: `${x}/issue/new`,
    newIssueAssociation: (id: string) =>
      generatePath(`${x}/issue/${id}/association/new`),
    newIssueType: `${x}/quality/issue-types/new`,
    newIssueWorkflow: `${x}/issue-workflow/new`,
    newItemPostingGroup: `${x}/items/groups/new`,
    newJob: `${x}/job/new`,
    newJobMaterial: (jobId: string) =>
      generatePath(`${x}/job/methods/${jobId}/material/new`),
    newJobOperation: (jobId: string) =>
      generatePath(`${x}/job/methods/${jobId}/operation/new`),
    newJobOperationParameter: `${x}/job/methods/operation/parameter/new`,
    newJobOperationStep: `${x}/job/methods/operation/step/new`,
    newJobOperationTool: `${x}/job/methods/operation/tool/new`,
    newJournalEntry: `${x}/accounting/journals/new`,
    newKanban: `${x}/inventory/kanbans/new`,
    newLocation: `${x}/resources/locations/new`,
    newMaintenanceDispatch: `${x}/maintenance/new`,
    newMaintenanceDispatchEvent: (dispatchId: string) =>
      generatePath(`${x}/maintenance/${dispatchId}/event/new`),
    newMaintenanceDispatchItem: (dispatchId: string) =>
      generatePath(`${x}/maintenance/${dispatchId}/item/new`),
    newMaintenanceSchedule: `${x}/resources/scheduled-maintenance/new`,
    newMakeMethodVersion: `${x}/items/methods/version/new`,
    newMaterial: `${x}/material/new`,
    newMaterialDimension: `${x}/items/dimensions/new`,
    newMaterialFinish: `${x}/items/finishes/new`,
    newMaterialForm: `${x}/items/forms/new`,
    newMaterialGrade: `${x}/items/grades/new`,
    newMaterialSubstance: `${x}/items/substances/new`,
    newMaterialSupplier: (id: string) =>
      generatePath(`${x}/material/${id}/purchasing/new`),
    newMaterialType: `${x}/items/types/new`,
    newMethodMaterial: `${x}/items/methods/material/new`,
    newMethodOperation: `${x}/items/methods/operation/new`,
    newMethodOperationParameter: `${x}/items/methods/operation/parameter/new`,
    newMethodOperationStep: `${x}/items/methods/operation/step/new`,
    newMethodOperationTool: `${x}/items/methods/operation/tool/new`,
    newNoQuoteReason: `${x}/sales/no-quote-reasons/new`,
    newNote: `${x}/shared/notes/new`,
    newOperator: `${x}/users/operators/new`,
    newPart: `${x}/part/new`,
    newPartner: `${x}/resources/partners/new`,
    newPartSupplier: (id: string) =>
      generatePath(`${x}/part/${id}/purchasing/new`),
    newPaymentTerm: `${x}/accounting/payment-terms/new`,
    newPickingList: `${x}/picking-list/new`,
    newPriceOverride: `${x}/sales/price-list/new`,
    newPricingRule: `${x}/sales/pricing-rules/new`,
    newProcedure: `${x}/production/procedures/new`,
    newProcedureParameter: (id: string) =>
      generatePath(`${x}/procedure/${id}/parameters/new`),
    newProcedureStep: (id: string) =>
      generatePath(`${x}/procedure/${id}/steps/new`),
    newProcess: `${x}/resources/processes/new`,
    newPurchaseInvoice: `${x}/purchase-invoice/new`,
    newPurchaseInvoiceLine: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/new`),
    newPurchaseOrder: `${x}/purchase-order/new`,
    newPurchaseOrderLine: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/new`),
    newPurchasingRFQ: `${x}/purchasing-rfq/new`,
    newPurchasingRFQLine: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/new`),
    newQualityDocument: `${x}/quality/documents/new`,
    newQualityDocumentStep: (id: string) =>
      generatePath(`${x}/quality-document/${id}/steps/new`),
    newQuote: `${x}/quote/new`,
    newQuoteLine: (id: string) => generatePath(`${x}/quote/${id}/new`),
    newQuoteLineCost: (id: string, lineId: string) =>
      generatePath(`${x}/quote/${id}/${lineId}/cost/new`),
    newQuoteMaterial: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/methods/${quoteId}/${lineId}/material/new`),
    newQuoteOperation: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/methods/${quoteId}/${lineId}/operation/new`),
    newQuoteOperationParameter: `${x}/quote/methods/operation/parameter/new`,
    newQuoteOperationStep: `${x}/quote/methods/operation/step/new`,
    newQuoteOperationTool: `${x}/quote/methods/operation/tool/new`,
    newReceipt: `${x}/receipt/new`,
    newRequiredAction: `${x}/quality/required-actions/new`,
    newRevision: `${x}/items/revisions/new`,
    newRisk: `${x}/quality/risks/new`,
    newSalesInvoice: `${x}/sales-invoice/new`,
    newSalesInvoiceLine: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/new`),
    newSalesOrder: `${x}/sales-order/new`,
    newSalesOrderLine: (id: string) =>
      generatePath(`${x}/sales-order/${id}/new`),
    newSalesOrderLineShipment: (id: string, lineId: string) =>
      generatePath(`${x}/sales-order/${id}/${lineId}/shipment`),
    newSalesRFQ: `${x}/sales-rfq/new`,
    newSalesRFQLine: (id: string) => generatePath(`${x}/sales-rfq/${id}/new`),
    newScrapReason: `${x}/production/scrap-reasons/new`,
    newService: `${x}/service/new`,
    newServiceSupplier: (id: string) =>
      generatePath(`${x}/service/${id}/purchasing/new`),
    newShift: `${x}/people/shifts/new`,
    newShipment: `${x}/shipment/new`,
    newShippingMethod: `${x}/inventory/shipping-methods/new`,
    newStockTransfer: `${x}/stock-transfer/new`,
    newStockTransferLine: (id: string) =>
      generatePath(`${x}/stock-transfer/${id}/line/new`),
    newStorageRule: `${x}/inventory/storage-rules/new`,
    newStorageType: `${x}/inventory/storage-types/new`,
    newStorageUnit: `${x}/inventory/storage-units/new`,
    newSuggestion: `${x}/resources/suggestions/new`,
    newSupplier: `${x}/supplier/new`,
    newSupplierAccount: `${x}/users/suppliers/new`,
    newSupplierContact: (id: string) =>
      generatePath(`${x}/supplier/${id}/contacts/new`),
    newSupplierLocation: (id: string) =>
      generatePath(`${x}/supplier/${id}/locations/new`),
    newSupplierProcess: (id: string) =>
      generatePath(`${x}/supplier/${id}/processes/new`),
    newSupplierQuote: `${x}/supplier-quote/new`,
    newSupplierQuoteLine: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/new`),
    newSupplierType: `${x}/purchasing/supplier-types/new`,
    newTag: `${x}/settings/tags/new`,
    newTimecard: `${x}/people/timecard/new`,
    newTool: `${x}/tool/new`,
    newToolSupplier: (id: string) =>
      generatePath(`${x}/tool/${id}/purchasing/new`),
    newTraining: `${x}/resources/training/new`,
    newTrainingAssignment: `${x}/resources/assignments/new`,
    newTrainingQuestion: (id: string) =>
      generatePath(`${x}/training/${id}/questions/new`),
    newUom: `${x}/items/uom/new`,
    newWarehouseTransfer: `${x}/warehouse-transfer/new`,
    newWarehouseTransferLine: (transferId: string) =>
      generatePath(`${x}/warehouse-transfer/${transferId}/details/new`),
    newWebhook: `${x}/settings/webhooks/new`,
    newWorkCenter: `${x}/resources/work-centers/new`,
    noQuoteReason: (id: string) =>
      generatePath(`${x}/sales/no-quote-reasons/${id}`),
    noQuoteReasons: `${x}/sales/no-quote-reasons`,
    notificationSettings: `${x}/account/notifications`,
    onboarding: {
      company: `${onboarding}/company`,
      industry: `${onboarding}/industry`,
      location: `${onboarding}/location`,
      plan: `${onboarding}/plan`,
      root: `${onboarding}`,
      theme: `${onboarding}/theme`,
      user: `${onboarding}/user`
    },
    operator: (id: string) => generatePath(`${x}/users/operators/${id}`),
    operatorResetPin: (id: string) =>
      generatePath(`${x}/users/operators/reset-pin/${id}`),
    operators: `${x}/users/operators`,
    part: (id: string) => generatePath(`${x}/part/${id}`),
    partCosting: (id: string) => generatePath(`${x}/part/${id}/costing`),
    partDetails: (id: string) => generatePath(`${x}/part/${id}/details`),
    partInventory: (id: string) => generatePath(`${x}/part/${id}/inventory`),
    partInventoryLocation: (id: string, locationId: string) =>
      generatePath(`${x}/part/${id}/inventory?location=${locationId}`),
    partMake: (id: string, makeMethodId: string) =>
      generatePath(`${x}/part/${id}/make/${makeMethodId}`),
    partner: (id: string, abilityId: string) =>
      generatePath(`${x}/resources/partners/${id}/${abilityId}`),
    partners: `${x}/resources/partners`,
    partPlanning: (id: string) => generatePath(`${x}/part/${id}/planning`),
    partPlanningLocation: (id: string, locationId: string) =>
      generatePath(`${x}/part/${id}/planning?location=${locationId}`),
    partPricing: (id: string) => generatePath(`${x}/part/${id}/pricing`),
    partPurchasing: (id: string) => generatePath(`${x}/part/${id}/purchasing`),
    partQuality: (id: string) => generatePath(`${x}/part/${id}/quality`),
    partRoot: `${x}/part`,
    partRules: (id: string) => generatePath(`${x}/part/${id}/rules`),
    partSales: (id: string) => generatePath(`${x}/part/${id}/sales`),
    partSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/part/${itemId}/purchasing/${id}`),
    parts: `${x}/items/parts`,
    payables: `${x}/invoicing/payables`,
    payablesAdjust: `${x}/invoicing/payables/adjust`,
    payment: (id: string) => generatePath(`${x}/payments/${id}`),
    paymentApplicationsSet: (id: string) =>
      generatePath(`${x}/payments/${id}/applications/set`),
    paymentCreditsSet: (id: string) =>
      generatePath(`${x}/payments/${id}/credits/set`),
    paymentDelete: (id: string) => generatePath(`${x}/payments/${id}/delete`),
    paymentNew: `${x}/payments/new`,
    paymentPost: (id: string) => generatePath(`${x}/payments/${id}/post`),
    payments: `${x}/invoicing/payments`,
    paymentTerm: (id: string) =>
      generatePath(`${x}/accounting/payment-terms/${id}`),
    paymentTerms: `${x}/accounting/payment-terms`,
    paymentVoid: (id: string) => generatePath(`${x}/payments/${id}/void`),
    people: `${x}/people/employee`,
    peopleSettings: `${x}/settings/people`,
    peopleTimecard: `${x}/people/timecard`,
    person: (id: string) => generatePath(`${x}/person/${id}`),
    personAttributeCategory: (personId: string, categoryId: string) =>
      generatePath(`${x}/person/${personId}/attributes/${categoryId}`),
    personDetails: (id: string) => generatePath(`${x}/person/${id}/details`),
    personJob: (id: string) => generatePath(`${x}/person/${id}/job`),
    personTimecard: (id: string) => generatePath(`${x}/person/${id}/timecard`),
    pickingList: (id: string) => generatePath(`${x}/picking-list/${id}`),
    pickingListDelete: (id: string) =>
      generatePath(`${x}/picking-list/${id}/delete`),
    pickingListDetails: (id: string) =>
      generatePath(`${x}/picking-list/${id}/details`),
    pickingListLine: (pickingListId: string, lineId: string) =>
      generatePath(`${x}/picking-list/${pickingListId}/details/${lineId}`),
    pickingListLineQuantity: (id: string) =>
      generatePath(`${x}/picking-list/${id}/line/quantity`),
    pickingListStatus: (id: string) =>
      generatePath(`${x}/picking-list/${id}/status`),
    pickingLists: `${x}/inventory/picking-lists`,
    pickingListsTable: `${x}/inventory/picking-lists`,
    pickingListTracked: (pickingListId: string, lineId: string) =>
      generatePath(`${x}/picking-list/${pickingListId}/tracked/${lineId}`),
    pickingSchedule: `${x}/picking-list/schedule`,
    postJournalEntry: (id: string) =>
      generatePath(`${x}/journal-entry/${id}/post`),
    priceOverride: (id: string) => generatePath(`${x}/sales/price-list/${id}`),
    pricingRule: (id: string) => generatePath(`${x}/sales/pricing-rules/${id}`),
    printingSettings: `${x}/settings/printing`,
    printingSettingsJobs: `${x}/settings/printing/jobs`,
    procedure: (id: string) => generatePath(`${x}/procedure/${id}`),
    procedureParameter: (id: string, parameterId: string) =>
      generatePath(`${x}/procedure/${id}/parameters/${parameterId}`),
    procedureStep: (id: string, attributeId: string) =>
      generatePath(`${x}/procedure/${id}/steps/${attributeId}`),
    procedureStepOrder: (id: string) =>
      generatePath(`${x}/procedure/${id}/steps/order`),
    procedures: `${x}/production/procedures`,
    process: (id: string) => generatePath(`${x}/resources/processes/${id}`),
    processActivate: (id: string) =>
      generatePath(`${x}/resources/processes/activate/${id}`),
    processDeactivate: (id: string) =>
      generatePath(`${x}/resources/processes/deactivate/${id}`),
    processes: `${x}/resources/processes`,
    production: `${x}/production`,
    productionPlanning: `${x}/production/planning`,
    productionPlanningItem: (itemId: string) =>
      generatePath(`${x}/production/planning/${itemId}`),
    productionSettings: `${x}/settings/production`,
    profile: `${x}/account/profile`,
    purchaseInvoice: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}`),
    purchaseInvoiceDelivery: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/delivery`),
    purchaseInvoiceDetails: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/details`),
    purchaseInvoiceExchangeRate: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/exchange-rate`),
    purchaseInvoiceLine: (invoiceId: string, id: string) =>
      generatePath(`${x}/purchase-invoice/${invoiceId}/${id}/details`),
    purchaseInvoiceLineOrder: (invoiceId: string) =>
      generatePath(`${x}/purchase-invoice/${invoiceId}/line-order`),
    purchaseInvoicePost: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/post`),
    purchaseInvoiceRoot: `${x}/purchase-invoice`,
    purchaseInvoiceStatus: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/status`),
    purchaseInvoiceVoid: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/void`),
    purchaseOrder: (id: string) => generatePath(`${x}/purchase-order/${id}`),
    purchaseOrderDelivery: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/delivery`),
    purchaseOrderDetails: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/details`),
    purchaseOrderDuplicate: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/duplicate`),
    purchaseOrderExchangeRate: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/exchange-rate`),
    purchaseOrderExternalDocuments: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/external`),
    purchaseOrderFavorite: `${x}/purchasing/orders/favorite`,
    purchaseOrderFinalize: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/finalize`),
    purchaseOrderLine: (orderId: string, id: string) =>
      generatePath(`${x}/purchase-order/${orderId}/${id}/details`),
    purchaseOrderLineOrder: (orderId: string) =>
      generatePath(`${x}/purchase-order/${orderId}/line-order`),
    purchaseOrderLineReceiving: (orderId: string, id: string) =>
      generatePath(`${x}/purchase-order/${orderId}/${id}/receiving`),
    purchaseOrderPayment: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/payment`),
    purchaseOrderRoot: `${x}/purchase-order`,
    purchaseOrderStatus: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/status`),
    purchaseOrders: `${x}/purchasing/orders`,
    purchasing: `${x}/purchasing`,
    purchasingPlanning: `${x}/purchasing/planning`,

    // Purchasing RFQ paths
    purchasingRfq: (id: string) => generatePath(`${x}/purchasing-rfq/${id}`),
    purchasingRfqCompare: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/compare`),
    purchasingRfqConvert: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/convert`),
    purchasingRfqDetails: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/details`),
    purchasingRfqFavorite: `${x}/purchasing/rfqs/favorite`,
    purchasingRfqFinalize: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/finalize`),
    purchasingRfqLine: (id: string, lineId: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/${lineId}/details`),
    purchasingRfqLineOrder: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/line-order`),
    purchasingRfqPreview: (id: string) =>
      generatePath(`/share/purchasing-rfq/${id}`),
    purchasingRfqRoot: `${x}/purchasing-rfq`,
    purchasingRfqStatus: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/status`),
    purchasingRfqSuppliers: (id: string) =>
      generatePath(`${x}/purchasing-rfq/${id}/suppliers`),
    purchasingRfqs: `${x}/purchasing/rfqs`,
    purchasingSettings: `${x}/settings/purchasing`,
    quality: `${x}/quality`,
    qualityActions: `${x}/quality/actions`,
    qualityDocument: (id: string) =>
      generatePath(`${x}/quality-document/${id}`),
    qualityDocumentStep: (id: string, attributeId: string) =>
      generatePath(`${x}/quality-document/${id}/steps/${attributeId}`),
    qualityDocumentStepOrder: (id: string) =>
      generatePath(`${x}/quality-document/${id}/steps/order`),
    qualityDocuments: `${x}/quality/documents`,
    qualitySettings: `${x}/settings/quality`,
    quote: (id: string) => generatePath(`${x}/quote/${id}`),
    quoteAssembly: (quoteId: string, lineId: string, assemblyId: string) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/assembly/${assemblyId}`
      ),
    quoteDetails: (id: string) => generatePath(`${x}/quote/${id}/details`),
    quoteDrag: (id: string) => generatePath(`${x}/quote/${id}/drag`),
    quoteDuplicate: (id: string) => generatePath(`${x}/quote/${id}/duplicate`),
    quoteExchangeRate: (id: string) =>
      generatePath(`${x}/quote/${id}/exchange-rate`),
    quoteExternalDocuments: (id: string) =>
      generatePath(`${x}/quote/${id}/external`),
    quoteFavorite: `${x}/sales/quotes/favorite`,
    quoteFinalize: (id: string) => generatePath(`${x}/quote/${id}/finalize`),
    quoteInternalDocuments: (id: string) =>
      generatePath(`${x}/quote/${id}/internal`),
    quoteLine: (quoteId: string, id: string) =>
      generatePath(`${x}/quote/${quoteId}/${id}/details`),
    quoteLineConfigure: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/${quoteId}/${lineId}/configure`),
    quoteLineMakeMethod: (
      quoteId: string,
      lineId: string,
      makeMethodId: string
    ) => generatePath(`${x}/quote/${quoteId}/${lineId}/make/${makeMethodId}`),
    quoteLineMethod: (quoteId: string, quoteLineId: string, methodId: string) =>
      generatePath(`${x}/quote/${quoteId}/${quoteLineId}/method/${methodId}`),
    quoteLineOrder: (quoteId: string) =>
      generatePath(`${x}/quote/${quoteId}/line-order`),
    quoteLineRecalculatePrice: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/${quoteId}/${lineId}/recalculate-price`),
    quoteLineUpdatePrecision: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/${quoteId}/${lineId}/update-precision`),
    quoteMaterial: (quoteId: string, lineId: string, id: string) =>
      generatePath(`${x}/quote/methods/${quoteId}/${lineId}/material/${id}`),
    quoteMaterialsOrder: `${x}/quote/methods/material/order`,
    quoteMethodGet: `${x}/quote/methods/get`,
    quoteMethodSave: `${x}/quote/methods/save`,
    quoteOperation: (quoteId: string, lineId: string, id: string) =>
      generatePath(`${x}/quote/methods/${quoteId}/${lineId}/operation/${id}`),
    quoteOperationParameter: (id: string) =>
      generatePath(`${x}/quote/methods/operation/parameter/${id}`),
    quoteOperationStep: (id: string) =>
      generatePath(`${x}/quote/methods/operation/step/${id}`),
    quoteOperationStepOrder: (operationId: string) =>
      generatePath(`${x}/quote/methods/operation/${operationId}/step/order`),
    quoteOperationsDelete: `${x}/quote/methods/operation/delete`,
    quoteOperationsOrder: `${x}/quote/methods/operation/order`,
    quoteOperationTool: (id: string) =>
      generatePath(`${x}/quote/methods/operation/tool/${id}`),
    quotePayment: (id: string) => generatePath(`${x}/quote/${id}/payment`),
    quoteShipment: (id: string) => generatePath(`${x}/quote/${id}/shipment`),
    quoteStatus: (id: string) => generatePath(`${x}/quote/${id}/status`),
    quotes: `${x}/sales/quotes`,
    receipt: (id: string) => generatePath(`${x}/receipt/${id}`),
    receiptDetails: (id: string) => generatePath(`${x}/receipt/${id}/details`),
    receiptFixedAssetLineUpdate: `${x}/receipt/fixed-asset-lines/update`,
    receiptInvoice: (id: string) => generatePath(`${x}/receipt/${id}/invoice`),
    receiptLineDelete: (id: string) =>
      generatePath(`${x}/receipt/lines/${id}/delete`),
    receiptLineSplit: `${x}/receipt/lines/split`,
    receiptLines: (id: string) => generatePath(`${x}/receipt/${id}/lines`),
    receiptLinesTracking: (id: string) =>
      generatePath(`${x}/receipt/lines/tracking`),
    receiptPost: (id: string) => generatePath(`${x}/receipt/${id}/post`),
    receiptRoot: `${x}/receipt`,
    receipts: `${x}/inventory/receipts`,
    receiptVoid: (id: string) => generatePath(`${x}/receipt/${id}/void`),
    receivables: `${x}/invoicing/receivables`,
    receivablesAdjust: `${x}/invoicing/receivables/adjust`,
    refreshSession: "/refresh-session",
    repeatDepreciationRun: (id: string) =>
      generatePath(`${x}/depreciation-run/${id}/repeat`),
    requiredAction: (id: string) =>
      generatePath(`${x}/quality/required-actions/${id}`),
    requiredActions: `${x}/quality/required-actions`,
    resendInvite: `${x}/users/resend-invite`,
    resources: `${x}/resources`,
    resourcesSettings: `${x}/settings/resources`,
    reverseJournalEntry: (id: string) =>
      generatePath(`${x}/journal-entry/${id}/reverse`),
    revision: (id: string) => generatePath(`${x}/items/revisions/${id}`),
    revokeInvite: `${x}/users/revoke-invite`,
    risk: (id: string) => generatePath(`${x}/quality/risks/${id}`),
    risks: `${x}/quality/risks`,
    root: "/",
    routings: `${x}/items/routing`,
    sales: `${x}/sales`,
    salesInvoice: (id: string) => generatePath(`${x}/sales-invoice/${id}`),
    salesInvoiceDetails: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/details`),
    salesInvoiceExchangeRate: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/exchange-rate`),
    salesInvoiceLine: (id: string, lineId: string) =>
      generatePath(`${x}/sales-invoice/${id}/${lineId}/details`),
    salesInvoiceLineOrder: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/line-order`),
    salesInvoicePost: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/post`),
    salesInvoiceShipment: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/shipment`),
    salesInvoiceStatus: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/status`),
    salesInvoiceVoid: (id: string) =>
      generatePath(`${x}/sales-invoice/${id}/void`),
    salesOrder: (id: string) => generatePath(`${x}/sales-order/${id}`),
    salesOrderCancelPreview: (id: string) =>
      generatePath(`${x}/sales-order/${id}/cancel-preview`),
    salesOrderConfirm: (id: string) =>
      generatePath(`${x}/sales-order/${id}/confirm`),
    salesOrderDetails: (id: string) =>
      generatePath(`${x}/sales-order/${id}/details`),
    salesOrderExchangeRate: (id: string) =>
      generatePath(`${x}/sales-order/${id}/exchange-rate`),
    salesOrderExternalDocuments: (id: string) =>
      generatePath(`${x}/sales-order/${id}/external`),
    salesOrderFavorite: `${x}/sales-order/orders/favorite`,
    salesOrderInternalDocuments: (id: string) =>
      generatePath(`${x}/sales-order/${id}/internal`),
    salesOrderLine: (orderId: string, id: string) =>
      generatePath(`${x}/sales-order/${orderId}/${id}/details`),
    salesOrderLineOrder: (orderId: string) =>
      generatePath(`${x}/sales-order/${orderId}/line-order`),
    salesOrderLinesToJobs: (orderId: string) =>
      generatePath(`${x}/sales-order/${orderId}/lines/jobs`),
    salesOrderLineToJob: (orderId: string, lineId: string) =>
      generatePath(`${x}/sales-order/${orderId}/${lineId}/job`),
    salesOrderPayment: (id: string) =>
      generatePath(`${x}/sales-order/${id}/payment`),
    salesOrderRelease: (id: string) =>
      generatePath(`${x}/sales-order/${id}/release`),
    salesOrderShipment: (id: string) =>
      generatePath(`${x}/sales-order/${id}/shipment`),
    salesOrderStatus: (id: string) =>
      generatePath(`${x}/sales-order/${id}/status`),
    salesOrders: `${x}/sales/orders`,
    salesPriceList: `${x}/sales/price-list`,
    salesPricingRules: `${x}/sales/pricing-rules`,
    salesRfq: (id: string) => generatePath(`${x}/sales-rfq/${id}`),
    salesRfqConvert: (id: string) =>
      generatePath(`${x}/sales-rfq/${id}/convert`),
    salesRfqDetails: (id: string) =>
      generatePath(`${x}/sales-rfq/${id}/details`),
    salesRfqDrag: (id: string) => generatePath(`${x}/sales-rfq/${id}/drag`),
    salesRfqFavorite: `${x}/sales/rfqs/favorite`,
    salesRfqLine: (id: string, lineId: string) =>
      generatePath(`${x}/sales-rfq/${id}/${lineId}/details`),
    salesRfqLineOrder: (id: string) =>
      generatePath(`${x}/sales-rfq/${id}/line-order`),
    salesRfqRoot: `${x}/sales-rfq`,
    salesRfqStatus: (id: string) => generatePath(`${x}/sales-rfq/${id}/status`),
    salesRfqs: `${x}/sales/rfqs`,
    salesSettings: `${x}/settings/sales`,
    saveInspectionDocument: (id: string) =>
      generatePath(`${x}/inspection/${id}/save`),

    saveViewOrder: `${x}/shared/view/order`,

    saveViews: `${x}/shared/views`,
    scheduleDates: `${x}/schedule/dates`,
    scheduleDatesUpdate: `${x}/schedule/dates/update`,
    scheduleOperation: `${x}/schedule/operations`,
    scheduleOperationUpdate: `${x}/schedule/operations/update`,
    scrapReason: (id: string) =>
      generatePath(`${x}/production/scrap-reasons/${id}`),
    scrapReasons: `${x}/production/scrap-reasons`,
    selectCompany,
    sequences: `${x}/settings/sequences`,
    serialNumber: (id: string) =>
      generatePath(`${x}/inventory/serial-numbers/${id}`),
    serialNumbers: `${x}/inventory/serial-numbers`,
    service: (id: string) => generatePath(`${x}/service/${id}`),
    serviceCosting: (id: string) => generatePath(`${x}/service/${id}/costing`),
    serviceDetails: (id: string) => `${x}/service/${id}/details`,
    serviceMake: (id: string, makeMethodId: string) =>
      generatePath(`${x}/service/${id}/make/${makeMethodId}`),
    servicePurchasing: (id: string) =>
      generatePath(`${x}/service/${id}/purchasing`),
    serviceQuality: (id: string) => generatePath(`${x}/service/${id}/quality`),
    serviceRoot: `${x}/service`,
    serviceSales: (id: string) => generatePath(`${x}/service/${id}/sales`),
    serviceSupplier: (serviceId: string, id: string) =>
      generatePath(`${x}/service/${serviceId}/purchasing/${id}`),
    services: `${x}/items/services`,
    settings: `${x}/settings`,
    shift: (id: string) => generatePath(`${x}/people/shifts/${id}`),
    shifts: `${x}/people/shifts`,
    shipment: (id: string) => generatePath(`${x}/shipment/${id}`),
    shipmentDetails: (id: string) =>
      generatePath(`${x}/shipment/${id}/details`),
    shipmentFixedAssetLineUpdate: `${x}/shipment/fixed-asset-lines/update`,
    shipmentLineDelete: (id: string) =>
      generatePath(`${x}/shipment/lines/${id}/delete`),
    shipmentLineSplit: `${x}/shipment/lines/split`,
    shipmentLinesTracking: (id: string) =>
      generatePath(`${x}/shipment/lines/tracking`),
    shipmentPost: (id: string) => generatePath(`${x}/shipment/${id}/post`),
    shipments: `${x}/inventory/shipments`,
    shipmentVoid: (id: string) => generatePath(`${x}/shipment/${id}/void`),
    shippingMethod: (id: string) =>
      generatePath(`${x}/inventory/shipping-methods/${id}`),
    shippingMethods: `${x}/inventory/shipping-methods`,
    splitIssueItem: `${x}/issue/item/split`,
    stockMovements: `${x}/inventory/stock-movements`,
    stockTransfer: (id: string) => generatePath(`${x}/stock-transfer/${id}`),
    stockTransferComplete: (id: string) =>
      generatePath(`${x}/stock-transfer/${id}/complete`),
    stockTransferLine: (id: string, lineId: string) =>
      generatePath(`${x}/stock-transfer/${id}/line/${lineId}`),
    stockTransferLineQuantity: (id: string) =>
      generatePath(`${x}/stock-transfer/${id}/line/quantity`),
    stockTransferScan: (id: string, lineId: string) =>
      generatePath(`${x}/stock-transfer/${id}/scan/${lineId}`),
    stockTransferStatus: (id: string) =>
      generatePath(`${x}/stock-transfer/${id}/status`),
    stockTransfers: `${x}/inventory/stock-transfers`,
    storageRule: (id: string) =>
      generatePath(`${x}/inventory/storage-rules/${id}`),
    storageRuleAssignItem: (itemId: string) =>
      generatePath(`${x}/items/rules/assign/${itemId}`),
    storageRuleAssignWorkCenter: (id: string) =>
      generatePath(`${x}/resources/work-centers/rules/assign/${id}`),
    storageRules: `${x}/inventory/storage-rules`,
    storageRuleUnassignItem: (itemId: string, ruleId: string) =>
      generatePath(`${x}/items/rules/unassign/${itemId}/${ruleId}`),
    storageRuleUnassignWorkCenter: (id: string, ruleId: string) =>
      generatePath(
        `${x}/resources/work-centers/rules/unassign/${id}/${ruleId}`
      ),
    storageType: (id: string) =>
      generatePath(`${x}/inventory/storage-types/${id}`),
    storageTypes: `${x}/inventory/storage-types`,
    storageUnit: (id: string) =>
      generatePath(`${x}/inventory/storage-units/${id}`),
    storageUnits: `${x}/inventory/storage-units`,
    suggestion: (id: string) =>
      generatePath(`${x}/resources/suggestions/${id}`),
    suggestions: `${x}/resources/suggestions`,
    supplier: (id: string) => generatePath(`${x}/supplier/${id}`),
    supplierAccounting: (id: string) =>
      generatePath(`${x}/supplier/${id}/accounting`),
    supplierAccounts: `${x}/users/suppliers`,
    supplierApproval: (id: string) =>
      generatePath(`${x}/supplier/${id}/approval`),
    supplierContact: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/contacts/${id}`),
    supplierContacts: (id: string) =>
      generatePath(`${x}/supplier/${id}/contacts`),
    supplierDefaultAttachments: (supplierId: string) =>
      generatePath(`${x}/supplier/${supplierId}/default-attachments`),
    supplierDetails: (id: string) =>
      generatePath(`${x}/supplier/${id}/details`),
    supplierLocation: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/locations/${id}`),
    supplierLocations: (id: string) =>
      generatePath(`${x}/supplier/${id}/locations`),
    supplierPayment: (id: string) =>
      generatePath(`${x}/supplier/${id}/payments`),
    supplierProcess: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/processes/${id}`),
    supplierProcesses: (id: string) =>
      generatePath(`${x}/supplier/${id}/processes`),
    supplierQuote: (id: string) => generatePath(`${x}/supplier-quote/${id}`),
    supplierQuoteDetails: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/details`),
    supplierQuoteExchangeRate: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/exchange-rate`),
    supplierQuoteFavorite: `${x}/purchasing/quotes/favorite`,
    supplierQuoteFinalize: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/finalize`),
    supplierQuoteLine: (id: string, lineId: string) =>
      generatePath(`${x}/supplier-quote/${id}/${lineId}/details`),
    supplierQuoteLineOrder: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/line-order`),
    supplierQuoteSend: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/send`),
    supplierQuoteStatus: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/status`),
    supplierQuotes: `${x}/purchasing/quotes`,
    supplierRisks: (id: string) => generatePath(`${x}/supplier/${id}/risks`),
    supplierRoot: `${x}/supplier`,
    supplierShipping: (id: string) =>
      generatePath(`${x}/supplier/${id}/shipping`),
    suppliers: `${x}/purchasing/suppliers`,
    supplierTax: (id: string) => generatePath(`${x}/supplier/${id}/tax`),
    supplierType: (id: string) =>
      generatePath(`${x}/purchasing/supplier-types/${id}`),
    supplierTypes: `${x}/purchasing/supplier-types`,
    tableSequence: (id: string) =>
      generatePath(`${x}/settings/sequences/${id}`),
    tags: `${x}/settings/tags`,
    theme: `${x}/account/theme`,
    timecard: (id: string) => generatePath(`${x}/people/timecard/${id}`),
    timecards: `${x}/timecards`,
    tool: (id: string) => generatePath(`${x}/tool/${id}`),
    toolCosting: (id: string) => generatePath(`${x}/tool/${id}/costing`),
    toolDetails: (id: string) => generatePath(`${x}/tool/${id}/details`),
    toolInventory: (id: string) => generatePath(`${x}/tool/${id}/inventory`),
    toolInventoryLocation: (id: string, locationId: string) =>
      generatePath(`${x}/tool/${id}/inventory?location=${locationId}`),
    toolMake: (id: string, makeMethodId: string) =>
      generatePath(`${x}/tool/${id}/make/${makeMethodId}`),
    toolPlanning: (id: string) => generatePath(`${x}/tool/${id}/planning`),
    toolPlanningLocation: (id: string, locationId: string) =>
      generatePath(`${x}/tool/${id}/planning?location=${locationId}`),
    toolPricing: (id: string) => generatePath(`${x}/tool/${id}/pricing`),
    toolPurchasing: (id: string) => generatePath(`${x}/tool/${id}/purchasing`),
    toolQuality: (id: string) => generatePath(`${x}/tool/${id}/quality`),
    toolRoot: `${x}/tool`,
    toolRules: (id: string) => generatePath(`${x}/tool/${id}/rules`),
    toolSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/tool/${itemId}/suppliers/${id}`),
    toolSuppliers: (id: string) => generatePath(`${x}/tool/${id}/suppliers`),
    tools: `${x}/items/tools`,
    traceability: `${x}/traceability`,
    traceabilityGraph: `${x}/traceability/graph`,
    trackedEntities: `${x}/inventory/tracked-entities`,
    trackedEntityExpiry: `${x}/inventory/tracked-entity/expiry`,
    training: (id: string) => generatePath(`${x}/training/${id}`),

    trainingAssignment: (assignmentId: string) =>
      generatePath(`${x}/resources/assignments/assignment/${assignmentId}`),
    trainingAssignmentDetail: (trainingId: string) =>
      generatePath(`${x}/resources/assignments/${trainingId}`),
    trainingAssignments: `${x}/resources/assignments`,
    trainingQuestion: (id: string, questionId: string) =>
      generatePath(`${x}/training/${id}/questions/${questionId}`),
    trainingQuestionOrder: (id: string) =>
      generatePath(`${x}/training/${id}/questions/order`),
    trainings: `${x}/resources/training`,
    trialBalance: `${x}/accounting/trial-balance`,
    trialBalanceLedger: (id: string) =>
      generatePath(`${x}/accounting/trial-balance/${id}`),
    uom: (id: string) => generatePath(`${x}/items/uom/${id}`),
    uoms: `${x}/items/uom`,
    updateAssemblyUnit: (id: string, unitId: string) =>
      generatePath(`${x}/assembly/${id}/units/${unitId}`),
    updateChangeOrder: `${x}/items/change-order/update`,
    updateInspectionDocumentName: (id: string) =>
      generatePath(`${x}/inspection/${id}/update-name`),
    updateIssueItem: `${x}/issue/item/update`,
    userAttribute: (id: string) => generatePath(`${x}/account/${id}/attribute`),
    users: `${x}/users`,
    warehouseTransfer: (id: string) =>
      generatePath(`${x}/warehouse-transfer/${id}`),
    warehouseTransferDetails: (id: string) =>
      generatePath(`${x}/warehouse-transfer/${id}/details`),
    warehouseTransferLine: (transferId: string, lineId: string) =>
      generatePath(`${x}/warehouse-transfer/${transferId}/details/${lineId}`),
    warehouseTransferLines: (transferId: string) =>
      generatePath(`${x}/warehouse-transfer/${transferId}/lines`),
    warehouseTransferReceive: (id: string) =>
      generatePath(`${x}/warehouse-transfer/${id}/receive`),
    warehouseTransferShip: (id: string) =>
      generatePath(`${x}/warehouse-transfer/${id}/ship`),
    warehouseTransferStatus: (id: string) =>
      generatePath(`${x}/warehouse-transfer/${id}/status`),
    warehouseTransfers: `${x}/inventory/warehouse-transfers`,
    webhook: (id: string) => generatePath(`${x}/settings/webhooks/${id}`),
    webhooks: `${x}/settings/webhooks`,
    workCenter: (id: string) =>
      generatePath(`${x}/resources/work-centers/${id}`),
    workCenterActivate: (id: string) =>
      generatePath(`${x}/resources/work-centers/activate/${id}`),
    workCenters: `${x}/resources/work-centers`
  }
} as const;

export const onboardingSequence = [
  path.to.onboarding.theme,
  path.to.onboarding.user,
  path.to.onboarding.company,
  path.to.onboarding.industry,
  path.to.onboarding.plan
] as const;

export const getStoragePath = (bucket: string, path: string) => {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
};

export const requestReferrer = (request: Request, withParams = true) => {
  return request.headers.get("referer");
};

export const getParams = (request: Request) => {
  const url = new URL(requestReferrer(request) ?? "");
  const searchParams = new URLSearchParams(url.search);
  return searchParams.toString();
};

export const getPrivateUrl = (path: string) => {
  return `/file/preview/private/${path}`;
};

export const getPublicModelUrl = (path: string) => {
  return `/file/model/public/${path}`;
};

// Map an item to its type-specific detail route. Used where a CO references an
// item by name and we want a link to the item page. Assemblies and unknown/blank
// types default to the Part route (assemblies are Parts in practice).
export const getItemDetailPath = (
  type: string | null | undefined,
  id: string
): string => {
  switch (type) {
    case "Tool":
      return path.to.tool(id);
    case "Material":
      return path.to.material(id);
    case "Consumable":
      return path.to.consumable(id);
    case "Service":
      return path.to.service(id);
    default:
      return path.to.part(id);
  }
};

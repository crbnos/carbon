import { SUPABASE_API_URL } from "@carbon/auth";
import { generatePath } from "@remix-run/react";

const x = "/x"; // from ~/routes/x+ folder
const api = "/api"; // from ~/routes/api+ folder
const file = "/file"; // from ~/routes/file+ folder
const onboarding = "/onboarding"; // from ~/routes/onboarding+ folder

export const path = {
  to: {
    api: {
      abilities: `${api}/resources/abilities`,
      accounts: `${api}/accounting/accounts`,
      accountingCategories: `${api}/accounting/categories`,
      accountingSubcategories: (id: string) =>
        generatePath(`${api}/accounting/subcategories?accountCategoryId=${id}`),
      assign: `${api}/assign`,
      autodeskToken: `${api}/autodesk/token`,
      autodeskUpload: `${api}/autodesk/upload`,
      countries: `${api}/countries`,
      currencies: `${api}/accounting/currencies`,
      customerContacts: (id: string) =>
        generatePath(`${api}/sales/customer-contacts/${id}`),
      customerLocations: (id: string) =>
        generatePath(`${api}/sales/customer-locations/${id}`),
      customerStatuses: `${api}/sales/customer-statuses`,
      customerTypes: `${api}/sales/customer-types`,
      departments: `${api}/people/departments`,
      digitalQuote: (id: string) =>
        generatePath(`${api}/sales/digital-quote/${id}`),
      employeeTypes: `${api}/users/employee-types`,
      emptyPermissions: `${api}/users/empty-permissions`,
      generateCsvColumns: (table: string) =>
        generatePath(`${api}/ai/csv/${table}/columns`),
      groupsByType: (type?: string) =>
        generatePath(`${api}/users/groups?type=${type}`),
      item: (type: string) => generatePath(`${api}/item/${type}`),
      locations: `${api}/resources/locations`,
      itemPostingGroups: `${api}/items/groups`,
      materialForms: `${api}/items/forms`,
      materialSubstances: `${api}/items/substances`,
      modelUpload: `${api}/model/upload`,
      processes: `${api}/resources/processes`,
      quotes: `${api}/sales/quotes`,
      quoteLines: (quoteId: string) =>
        generatePath(`${api}/sales/quotes/${quoteId}/lines`),
      rollback: (table: string, id: string) =>
        generatePath(
          `${api}/settings/sequence/rollback?table=${table}&currentSequence=${id}`
        ),
      scrapReasons: `${api}/production/scrap-reasons`,
      sequences: (table: string) => `${api}/settings/sequences?table=${table}`,
      services: `${api}/items/services`,
      shifts: (id: string) =>
        generatePath(`${api}/people/shifts?location=${id}`),
      shelves: (id: string) =>
        generatePath(`${api}/inventory/shelves?locationId=${id}`),
      supplierContacts: (id: string) =>
        generatePath(`${api}/purchasing/supplier-contacts/${id}`),
      supplierLocations: (id: string) =>
        generatePath(`${api}/purchasing/supplier-locations/${id}`),
      supplierProcesses: (id?: string) =>
        generatePath(`${api}/purchasing/supplier-processes?processId=${id}`),
      supplierStatuses: `${api}/purchasing/supplier-statuses`,
      supplierTypes: `${api}/purchasing/supplier-types`,
      tags: (table?: string) =>
        generatePath(`${api}/shared/tags?table=${table}`),
      unitOfMeasures: `${api}/items/uoms`,
      workCentersByLocation: (id: string) =>
        generatePath(`${api}/resources/work-centers?location=${id}`),
      workCenters: `${api}/resources/work-centers`,
      paymentTerms: `${api}/accounting/payment-terms`,
      shippingMethods: `${api}/inventory/shipping-methods`,
    },
    file: {
      cadModel: (id: string) => generatePath(`${file}/model/${id}`),
      previewImage: (bucket: string, path: string) =>
        generatePath(`${file}/preview/image?file=${bucket}/${path}`),
      previewFile: (path: string) => generatePath(`${file}/preview/${path}`),
      purchaseOrder: (id: string) =>
        generatePath(`${file}/purchase-order/${id}.pdf`),
      salesOrder: (id: string) => generatePath(`${file}/sales-order/${id}.pdf`),
      quote: (id: string) => generatePath(`${file}/quote/${id}.pdf`),
    },
    onboarding: {
      company: `${onboarding}/company`,
      location: `${onboarding}/location`,
      root: `${onboarding}`,
      theme: `${onboarding}/theme`,
      user: `${onboarding}/user`,
    },
    authenticatedRoot: x,
    abilities: `${x}/resources/abilities`,
    ability: (id: string) => generatePath(`${x}/resources/ability/${id}`),
    account: `${x}/account`,
    accountPersonal: `${x}/account/personal`,
    accountPassword: `${x}/account/password`,
    accounting: `${x}/accounting`,
    accountingCategoryList: (id: string) =>
      generatePath(`${x}/accounting/categories/list/${id}`),
    accountingCategory: (id: string) =>
      generatePath(`${x}/accounting/categories/${id}`),
    accountingCategories: `${x}/accounting/categories`,
    accountingDefaults: `${x}/accounting/defaults`,
    accountingJournals: `${x}/accounting/journals`,
    accountingGroupsBankAccounts: `${x}/accounting/groups/bank-accounts`,
    accountingGroupsFixedAssets: `${x}/accounting/groups/fixed-assets`,
    accountingGroupsInventory: `${x}/accounting/groups/inventory`,
    accountingGroupsPurchasing: `${x}/accounting/groups/purchasing`,
    accountingGroupsSales: `${x}/accounting/groups/sales`,
    accountingRoot: `${x}/accounting`,
    accountingSubcategory: (id: string) =>
      generatePath(`${x}/accounting/subcategory/${id}`),
    attribute: (id: string) => generatePath(`${x}/people/attribute/${id}`),
    attributes: `${x}/people/attributes`,
    apiIntroduction: `${x}/api/js/intro`,
    apiIntro: (lang: string) => generatePath(`${x}/api/${lang}/intro/`),
    apiTable: (lang: string, table: string) =>
      generatePath(`${x}/api/${lang}/table/${table}`),
    apiKey: (id: string) => generatePath(`${x}/settings/api-keys/${id}`),
    apiKeys: `${x}/settings/api-keys`,
    attributeCategory: (id: string) =>
      generatePath(`${x}/people/attributes/${id}`),
    attributeCategoryList: (id: string) =>
      generatePath(`${x}/people/attributes/list/${id}`),
    bulkEditPermissions: `${x}/users/bulk-edit-permissions`,
    bulkUpdateItems: `${x}/items/update`,
    bulkUpdateJob: `${x}/job/update`,
    bulkUpdateQuote: `${x}/quote/update`,
    bulkUpdateSalesOrder: `${x}/sales-order/update`,
    bulkUpdateSalesRfq: `${x}/sales-rfq/update`,
    chartOfAccount: (id: string) =>
      generatePath(`${x}/accounting/charts/${id}`),
    chartOfAccounts: `${x}/accounting/charts`,
    company: `${x}/settings/company`,
    companySwitch: (companyId: string) =>
      generatePath(`${x}/settings/company/switch/${companyId}`),
    contractor: (id: string) =>
      generatePath(`${x}/resources/contractors/${id}`),
    contractors: `${x}/resources/contractors`,
    consumable: (id: string) => generatePath(`${x}/consumable/${id}`),
    consumables: `${x}/items/consumables`,
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
    consumableRoot: `${x}/consumable`,
    consumableSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/consumable/${itemId}/suppliers/${id}`),
    consumableSuppliers: (id: string) =>
      generatePath(`${x}/consumable/${id}/suppliers`),
    convertQuoteToOrder: (id: string) =>
      generatePath(`${x}/quote/${id}/convert`),
    currency: (id: string) => generatePath(`${x}/accounting/currencies/${id}`),
    currencies: `${x}/accounting/currencies`,
    customer: (id: string) => generatePath(`${x}/customer/${id}`),
    customerDetails: (id: string) =>
      generatePath(`${x}/customer/${id}/details`),
    customerRoot: `${x}/customer`,
    customers: `${x}/sales/customers`,
    customerAccounts: `${x}/users/customers`,
    customerAccounting: (id: string) =>
      generatePath(`${x}/customer/${id}/accounting`),
    customerContact: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/contacts/${id}`),
    customerContacts: (id: string) =>
      generatePath(`${x}/customer/${id}/contacts`),
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
    customerShipping: (id: string) =>
      generatePath(`${x}/customer/${id}/shipping`),
    customerStatus: (id: string) =>
      generatePath(`${x}/sales/customer-statuses/${id}`),
    customerStatuses: `${x}/sales/customer-statuses`,
    customerType: (id: string) =>
      generatePath(`${x}/sales/customer-types/${id}`),
    customerTypes: `${x}/sales/customer-types`,
    customField: (tableId: string, id: string) =>
      generatePath(`${x}/settings/custom-fields/${tableId}/${id}`),
    customFields: `${x}/settings/custom-fields`,
    customFieldsTable: (table: string) =>
      generatePath(`${x}/settings/custom-fields/${table}`),
    customFieldList: (id: string) =>
      generatePath(`${x}/settings/custom-fields/${id}`),
    deactivateUsers: `${x}/users/deactivate`,
    deleteAbility: (id: string) =>
      generatePath(`${x}/resources/abilities/delete/${id}`),
    deleteAccountingCategory: (id: string) =>
      generatePath(`${x}/accounting/categories/delete/${id}`),
    deleteAccountingSubcategory: (id: string) =>
      generatePath(`${x}/accounting/subcategory/delete/${id}`),
    deleteAccountingCharts: (id: string) =>
      generatePath(`${x}/accounting/charts/delete/${id}`),
    deleteApiKey: (id: string) =>
      generatePath(`${x}/settings/api-keys/delete/${id}`),
    deleteAttribute: (id: string) =>
      generatePath(`${x}/people/attribute/delete/${id}`),
    deleteAttributeCategory: (id: string) =>
      generatePath(`${x}/people/attributes/delete/${id}`),
    deleteContractor: (id: string) =>
      generatePath(`${x}/resources/contractors/delete/${id}`),
    deleteCurrency: (id: string) =>
      generatePath(`${x}/accounting/currencies/delete/${id}`),
    deleteCustomer: (id: string) => generatePath(`${x}/customer/${id}/delete`),
    deleteCustomerContact: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/contacts/delete/${id}`),
    deleteCustomerLocation: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/locations/delete/${id}`),
    deleteCustomerPart: (id: string, customerPartToItemId: string) =>
      generatePath(
        `${x}/part/${id}/sales/customer-parts/delete/${customerPartToItemId}`
      ),
    deleteCustomerStatus: (id: string) =>
      generatePath(`${x}/sales/customer-statuses/delete/${id}`),
    deleteCustomerType: (id: string) =>
      generatePath(`${x}/sales/customer-types/delete/${id}`),
    deleteCustomField: (tableId: string, id: string) =>
      generatePath(`${x}/settings/custom-fields/${tableId}/delete/${id}`),
    deleteDepartment: (id: string) =>
      generatePath(`${x}/people/departments/delete/${id}`),
    deleteDocument: (id: string) => generatePath(`${x}/documents/${id}/trash`),
    deleteDocumentPermanently: (id: string) =>
      generatePath(`${x}/documents/${id}/delete`),
    deleteEmployeeAbility: (abilityId: string, id: string) =>
      generatePath(`${x}/resources/ability/${abilityId}/employee/delete/${id}`),
    deleteEmployeeType: (id: string) =>
      generatePath(`${x}/users/employee-types/delete/${id}`),
    deleteGroup: (id: string) => generatePath(`${x}/users/groups/delete/${id}`),
    deleteHoliday: (id: string) =>
      generatePath(`${x}/people/holidays/delete/${id}`),
    deleteLocation: (id: string) =>
      generatePath(`${x}/resources/locations/delete/${id}`),
    deleteItem: (id: string) => generatePath(`${x}/items/delete/${id}`),
    deleteItemPostingGroup: (id: string) =>
      generatePath(`${x}/items/groups/delete/${id}`),
    deleteJob: (id: string) => generatePath(`${x}/job/${id}/delete`),
    deleteJobMaterial: (jobId: string, id: string) =>
      generatePath(`${x}/job/methods/${jobId}/material/delete/${id}`),
    deleteJobOperationTool: (id: string) =>
      generatePath(`${x}/job/methods/operation/tool/delete/${id}`),
    deleteMaterialForm: (id: string) =>
      generatePath(`${x}/items/forms/delete/${id}`),
    deleteMaterialSubstance: (id: string) =>
      generatePath(`${x}/items/substances/delete/${id}`),
    deleteMethodMaterial: (id: string) =>
      generatePath(`${x}/items/methods/material/delete/${id}`),
    deleteMethodOperationTool: (id: string) =>
      generatePath(`${x}/items/methods/operation/tool/delete/${id}`),
    deleteNote: (id: string) => generatePath(`${x}/shared/notes/${id}/delete`),
    deletePartner: (id: string) =>
      generatePath(`${x}/resources/partners/delete/${id}`),
    deletePaymentTerm: (id: string) =>
      generatePath(`${x}/accounting/payment-terms/delete/${id}`),
    deleteProcess: (id: string) =>
      generatePath(`${x}/resources/processes/delete/${id}`),
    deleteProductionEvent: (id: string) =>
      generatePath(`${x}/job/methods/event/delete/${id}`),
    deleteProductionQuantity: (id: string) =>
      generatePath(`${x}/job/methods/quantity/delete/${id}`),
    deletePurchaseInvoice: (id: string) =>
      generatePath(`${x}/purchase-invoice/delete/${id}`),
    deletePurchaseInvoiceLine: (invoiceId: string, lineId: string) =>
      generatePath(`${x}/purchase-invoice/${invoiceId}/lines/delete/${lineId}`),
    deletePurchaseOrder: (id: string) =>
      generatePath(`${x}/purchase-order/delete/${id}`),
    deletePurchaseOrderLine: (orderId: string, lineId: string) =>
      generatePath(`${x}/purchase-order/${orderId}/lines/delete/${lineId}`),
    deleteQuote: (id: string) => generatePath(`${x}/quote/${id}/delete`),
    deleteQuoteLine: (id: string, lineId: string) =>
      generatePath(`${x}/quote/${id}/${lineId}/delete`),
    deleteQuoteLineCost: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/${quoteId}/${lineId}/cost/delete`),
    deleteQuoteMaterial: (quoteId: string, lineId: string, id: string) =>
      generatePath(
        `${x}/quote/methods/${quoteId}/${lineId}/material/delete/${id}`
      ),
    deleteQuoteOperationTool: (id: string) =>
      generatePath(`${x}/quote/methods/operation/tool/delete/${id}`),

    deleteReceipt: (id: string) => generatePath(`${x}/receipt/delete/${id}`),
    deleteSalesOrder: (id: string) =>
      generatePath(`${x}/sales-order/${id}/delete`),
    deleteSalesOrderLine: (orderId: string, lineId: string) =>
      generatePath(`${x}/sales-order/${orderId}/${lineId}/delete`),
    deleteSalesRfq: (id: string) => generatePath(`${x}/sales-rfq/${id}/delete`),
    deleteSalesRfqLine: (id: string, lineId: string) =>
      generatePath(`${x}/sales-rfq/${id}/${lineId}/delete`),
    deleteScrapReason: (id: string) =>
      generatePath(`${x}/production/scrap-reasons/delete/${id}`),
    deleteShift: (id: string) =>
      generatePath(`${x}/people/shifts/delete/${id}`),
    deleteShippingMethod: (id: string) =>
      generatePath(`${x}/inventory/shipping-methods/delete/${id}`),
    deleteSupplierContact: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/contacts/delete/${id}`),
    deleteSupplierLocation: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/locations/delete/${id}`),
    deleteSupplierProcess: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/processes/delete/${id}`),
    deleteSupplierStatus: (id: string) =>
      generatePath(`${x}/purchasing/supplier-statuses/delete/${id}`),
    deleteSupplierType: (id: string) =>
      generatePath(`${x}/purchasing/supplier-types/delete/${id}`),
    deleteUom: (id: string) => generatePath(`${x}/items/uom/delete/${id}`),
    deleteUserAttribute: (id: string) =>
      generatePath(`${x}/account/${id}/delete/attribute`),
    deleteWorkCenter: (id: string) =>
      generatePath(`${x}/resources/work-centers/delete/${id}`),
    department: (id: string) => generatePath(`${x}/people/departments/${id}`),
    departments: `${x}/people/departments`,
    document: (id: string) => generatePath(`${x}/documents/search/${id}`),
    documentView: (id: string) =>
      generatePath(`${x}/documents/search/view/${id}`),
    documents: `${x}/documents/search`,
    documentFavorite: `${x}/documents/favorite`,
    documentRestore: (id: string) =>
      generatePath(`${x}/documents/${id}/restore`),
    documentsTrash: `${x}/documents/search?q=trash`,
    employeeAbility: (abilityId: string, id: string) =>
      generatePath(`${x}/resources/ability/${abilityId}/employee/${id}`),
    employeeAccount: (id: string) => generatePath(`${x}/users/employees/${id}`),
    employeeAccounts: `${x}/users/employees`,
    employeeType: (id: string) =>
      generatePath(`${x}/users/employee-types/${id}`),
    employeeTypes: `${x}/users/employee-types`,
    externalQuote: (id: string) => generatePath(`/share/quote/${id}`),
    feedback: `${x}/feedback`,
    fiscalYears: `${x}/accounting/years`,
    forgotPassword: "/forgot-password",
    group: (id: string) => generatePath(`${x}/users/groups/${id}`),
    groups: `${x}/users/groups`,
    holiday: (id: string) => generatePath(`${x}/people/holidays/${id}`),
    holidays: `${x}/people/holidays`,
    import: (tableId: string) => generatePath(`${x}/shared/import/${tableId}`),
    integration: (id: string) =>
      generatePath(`${x}/settings/integrations/${id}`),
    integrationDeactivate: (id: string) =>
      generatePath(`${x}/settings/integrations/deactivate/${id}`),
    integrations: `${x}/settings/integrations`,
    inventory: `${x}/inventory/quantities`,
    inventoryItem: (id: string) =>
      generatePath(`${x}/inventory/quantities/${id}/details`),
    inventoryItemActivity: (id: string) =>
      generatePath(`${x}/inventory/quantities/${id}/activity`),
    inventoryItemAdjustment: (id: string) =>
      generatePath(`${x}/inventory/quantities/${id}/adjustment`),
    inventoryRoot: `${x}/inventory`,
    invoicing: `${x}/invoicing`,
    items: `${x}/items`,
    itemCostUpdate: (id: string) => generatePath(`${x}/items/cost/${id}`),
    itemPostingGroup: (id: string) => generatePath(`${x}/items/groups/${id}`),
    itemPostingGroups: `${x}/items/groups`,
    job: (id: string) => generatePath(`${x}/job/${id}`),
    jobComplete: (id: string) => generatePath(`${x}/job/${id}/complete`),
    jobDetails: (id: string) => generatePath(`${x}/job/${id}/details`),
    jobMaterial: (jobId: string, id: string) =>
      generatePath(`${x}/job/methods/${jobId}/material/${id}`),
    jobMaterials: (id: string) => generatePath(`${x}/job/${id}/materials`),
    jobMethod: (jobId: string, methodId: string) =>
      generatePath(`${x}/job/${jobId}/method/${methodId}`),
    jobMakeMethod: (jobId: string, makeMethodId: string, materialId: string) =>
      generatePath(`${x}/job/${jobId}/make/${makeMethodId}/${materialId}`),
    jobMethodMaterial: (
      jobId: string,
      methodType: string,
      makeMethodId: string,
      materialId: string
    ) =>
      generatePath(
        `${x}/job/${jobId}/${methodType}/${makeMethodId}/${materialId}`
      ),
    jobMaterialsOrder: `${x}/job/methods/material/order`,
    jobMethodGet: `${x}/job/methods/get`,
    jobMethodSave: `${x}/job/methods/save`,
    jobOperation: (jobId: string, id: string) =>
      generatePath(`${x}/job/methods/${jobId}/operation/${id}`),
    jobOperations: (id: string) => generatePath(`${x}/job/${id}/operations`),
    jobOperationsOrder: `${x}/job/methods/operation/order`,
    jobOperationsDelete: `${x}/job/methods/operation/delete`,
    jobOperationTool: (id: string) =>
      generatePath(`${x}/job/methods/operation/tool/${id}`),
    jobOperationStatus: `${x}/job/methods/operation/status`,
    jobProductionEvents: (id: string) => generatePath(`${x}/job/${id}/events`),
    jobProductionQuantities: (id: string) =>
      generatePath(`${x}/job/${id}/quantities`),
    jobs: `${x}/production/jobs`,
    jobRecalculate: (id: string) => generatePath(`${x}/job/${id}/recalculate`),
    jobRelease: (id: string) => generatePath(`${x}/job/${id}/release`),
    jobStatus: (id: string) => generatePath(`${x}/job/${id}/status`),
    location: (id: string) => generatePath(`${x}/resources/locations/${id}`),
    locations: `${x}/resources/locations`,
    login: "/login",
    logout: "/logout",
    logos: `${x}/settings/logos`,
    makeMethodGet: `${x}/items/methods/get`,
    makeMethodSave: `${x}/items/methods/save`,
    material: (id: string) => generatePath(`${x}/material/${id}`),
    materialCosting: (id: string) =>
      generatePath(`${x}/material/${id}/costing`),
    materialDetails: (id: string) =>
      generatePath(`${x}/material/${id}/details`),
    materialForm: (id: string) => generatePath(`${x}/items/forms/${id}`),
    materialForms: `${x}/items/forms`,
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
    materialRoot: `${x}/material`,
    materialSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/material/${itemId}/suppliers/${id}`),
    materialSuppliers: (id: string) =>
      generatePath(`${x}/material/${id}/suppliers`),
    materials: `${x}/items/materials`,
    materialSubstance: (id: string) =>
      generatePath(`${x}/items/substances/${id}`),
    materialSubstances: `${x}/items/substances`,
    methodMaterial: (id: string) =>
      generatePath(`${x}/items/methods/material/${id}`),
    methodMaterials: `${x}/items/methods/materials`,
    methodMaterialsOrder: `${x}/items/methods/material/order`,
    methodOperation: (id: string) =>
      generatePath(`${x}/items/methods/operation/${id}`),
    methodOperations: `${x}/items/methods/operations`,
    methodOperationsOrder: `${x}/items/methods/operation/order`,
    methodOperationsDelete: `${x}/items/methods/operation/delete`,
    methodOperationTool: (id: string) =>
      generatePath(`${x}/items/methods/operation/tool/${id}`),
    newAbility: `${x}/resources/abilities/new`,
    newAccountingCategory: `${x}/accounting/categories/new`,
    newAccountingSubcategory: (id: string) =>
      generatePath(`${x}/accounting/categories/list/${id}/new`),
    newApiKey: `${x}/settings/api-keys/new`,
    newAttribute: `${x}/people/attribute/new`,
    newAttributeCategory: `${x}/people/attributes/new`,
    newAttributeForCategory: (id: string) =>
      generatePath(`${x}/people/attributes/list/${id}/new`),
    newChartOfAccount: `${x}/accounting/charts/new`,
    newCompany: `${x}/settings/company/new`,
    newConsumable: `${x}/consumable/new`,
    newConsumableSupplier: (id: string) =>
      generatePath(`${x}/consumable/${id}/purchasing/new`),
    newContractor: `${x}/resources/contractors/new`,
    newCurrency: `${x}/accounting/currencies/new`,
    newCustomer: `${x}/customer/new`,
    newCustomerAccount: `${x}/users/customers/new`,
    newCustomerContact: (id: string) =>
      generatePath(`${x}/customer/${id}/contacts/new`),
    newCustomerLocation: (id: string) =>
      generatePath(`${x}/customer/${id}/locations/new`),
    newCustomerStatus: `${x}/sales/customer-statuses/new`,
    newCustomerType: `${x}/sales/customer-types/new`,
    newCustomField: (tableId: string) =>
      generatePath(`${x}/settings/custom-fields/${tableId}/new`),
    newCustomerPart: (id: string) =>
      generatePath(`${x}/part/${id}/sales/customer-parts/new`),
    newDepartment: `${x}/people/departments/new`,
    newDocument: `${x}/documents/new`,
    newEmployee: `${x}/users/employees/new`,
    newEmployeeAbility: (id: string) =>
      generatePath(`${x}/resources/ability/${id}/employee/new`),
    newEmployeeType: `${x}/users/employee-types/new`,
    newFixture: `${x}/fixture/new`,
    newFixtureSupplier: (id: string) =>
      generatePath(`${x}/fixture/${id}/purchasing/new`),
    newGroup: `${x}/users/groups/new`,
    newHoliday: `${x}/people/holidays/new`,
    newJob: `${x}/job/new`,
    newJobMaterial: (jobId: string) =>
      generatePath(`${x}/job/methods/${jobId}/material/new`),
    newJobOperation: (jobId: string) =>
      generatePath(`${x}/job/methods/${jobId}/operation/new`),
    newJobOperationTool: `${x}/job/methods/operation/tool/new`,
    newLocation: `${x}/resources/locations/new`,
    newMaterial: `${x}/material/new`,
    newMethodMaterial: `${x}/items/methods/material/new`,
    newMethodOperation: `${x}/items/methods/operation/new`,
    newMethodOperationTool: `${x}/items/methods/operation/tool/new`,
    newNote: `${x}/shared/notes/new`,
    newPart: `${x}/part/new`,
    newItemPostingGroup: `${x}/items/groups/new`,
    newMaterialForm: `${x}/items/forms/new`,
    newMaterialSubstance: `${x}/items/substances/new`,
    newMaterialSupplier: (id: string) =>
      generatePath(`${x}/material/${id}/purchasing/new`),
    newPartSupplier: (id: string) =>
      generatePath(`${x}/part/${id}/purchasing/new`),
    newPartner: `${x}/resources/partners/new`,
    newPaymentTerm: `${x}/accounting/payment-terms/new`,
    newProcess: `${x}/resources/processes/new`,
    newPurchaseInvoice: `${x}/purchase-invoice/new`,
    newPurchaseInvoiceLine: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/lines/new`),
    newPurchaseOrder: `${x}/purchase-order/new`,
    newPurchaseOrderLine: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/lines/new`),
    newQuote: `${x}/quote/new`,
    newQuoteLine: (id: string) => generatePath(`${x}/quote/${id}/new`),
    newQuoteLineCost: (id: string, lineId: string) =>
      generatePath(`${x}/quote/${id}/${lineId}/cost/new`),
    newQuoteOperation: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/methods/${quoteId}/${lineId}/operation/new`),
    newQuoteOperationTool: `${x}/quote/methods/operation/tool/new`,
    newQuoteMaterial: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/methods/${quoteId}/${lineId}/material/new`),
    newReceipt: `${x}/receipt/new`,
    newSalesOrder: `${x}/sales-order/new`,
    newSalesOrderLine: (id: string) =>
      generatePath(`${x}/sales-order/${id}/new`),
    newSalesRFQ: `${x}/sales-rfq/new`,
    newSalesRFQLine: (id: string) => generatePath(`${x}/sales-rfq/${id}/new`),
    newScrapReason: `${x}/production/scrap-reasons/new`,
    newShelf: `${x}/inventory/shelves/new`,
    newShift: `${x}/people/shifts/new`,
    newShippingMethod: `${x}/inventory/shipping-methods/new`,
    newService: `${x}/service/new`,
    newServiceSupplier: (id: string) =>
      generatePath(`${x}/service/${id}/purchasing/new`),
    newSupplier: `${x}/supplier/new`,
    newSupplierAccount: `${x}/users/suppliers/new`,
    newSupplierContact: (id: string) =>
      generatePath(`${x}/supplier/${id}/contacts/new`),
    newSupplierLocation: (id: string) =>
      generatePath(`${x}/supplier/${id}/locations/new`),
    newSupplierProcess: (id: string) =>
      generatePath(`${x}/supplier/${id}/processes/new`),
    newSupplierStatus: `${x}/purchasing/supplier-statuses/new`,
    newSupplierType: `${x}/purchasing/supplier-types/new`,
    newTag: `${x}/settings/tags/new`,
    newTool: `${x}/tool/new`,
    newToolSupplier: (id: string) =>
      generatePath(`${x}/tool/${id}/purchasing/new`),
    newUom: `${x}/items/uom/new`,
    newWorkCenter: `${x}/resources/work-centers/new`,
    notificationSettings: `${x}/account/notifications`,
    part: (id: string) => generatePath(`${x}/part/${id}`),
    partCosting: (id: string) => generatePath(`${x}/part/${id}/costing`),
    partDetails: (id: string) => generatePath(`${x}/part/${id}/details`),
    partInventory: (id: string) => generatePath(`${x}/part/${id}/inventory`),
    partInventoryLocation: (id: string, locationId: string) =>
      generatePath(`${x}/part/${id}/inventory?location=${locationId}`),
    partMakeMethod: (id: string) =>
      generatePath(`${x}/part/${id}/manufacturing/method`),
    partManufacturing: (id: string) =>
      generatePath(`${x}/part/${id}/manufacturing`),
    partManufacturingMaterial: (
      itemId: string,
      makeMethodId: string,
      methodMaterialId: string
    ) =>
      generatePath(
        `${x}/part/${itemId}/manufacturing/${makeMethodId}/${methodMaterialId}`
      ),
    partPlanning: (id: string) => generatePath(`${x}/part/${id}/planning`),
    partPlanningLocation: (id: string, locationId: string) =>
      generatePath(`${x}/part/${id}/planning?location=${locationId}`),
    partPricing: (id: string) => generatePath(`${x}/part/${id}/pricing`),
    partPurchasing: (id: string) => generatePath(`${x}/part/${id}/purchasing`),
    partRoot: `${x}/part`,
    partSales: (id: string) => generatePath(`${x}/part/${id}/sales`),
    partSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/part/${itemId}/suppliers/${id}`),
    parts: `${x}/items/parts`,
    partner: (id: string, abilityId: string) =>
      generatePath(`${x}/resources/partners/${id}/${abilityId}`),
    partners: `${x}/resources/partners`,
    paymentTerm: (id: string) =>
      generatePath(`${x}/accounting/payment-terms/${id}`),
    paymentTerms: `${x}/accounting/payment-terms`,
    people: `${x}/people/people`,
    person: (id: string) => generatePath(`${x}/person/${id}`),
    personDetails: (id: string) => generatePath(`${x}/person/${id}/details`),
    personJob: (id: string) => generatePath(`${x}/person/${id}/job`),
    process: (id: string) => generatePath(`${x}/resources/processes/${id}`),
    processes: `${x}/resources/processes`,
    production: `${x}/production`,
    profile: `${x}/account/profile`,
    purchaseInvoice: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}`),
    purchaseInvoiceDetails: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/details`),
    purchaseInvoiceLine: (invoiceId: string, id: string) =>
      generatePath(`${x}/purchase-invoice/${invoiceId}/lines/${id}`),
    purchaseInvoiceLines: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/lines`),
    purchaseInvoicePost: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/post`),
    purchaseInvoiceRoot: `${x}/purchase-invoice`,
    purchaseInvoices: `${x}/invoicing/purchasing`,
    purchaseOrder: (id: string) => generatePath(`${x}/purchase-order/${id}`),
    purchaseOrderDelivery: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/delivery`),
    purchaseOrderDetails: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/details`),
    purchaseOrderExternalDocuments: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/external`),
    purchaseOrderFavorite: `${x}/purchasing/orders/favorite`,
    purchaseOrderInternalDocuments: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/internal`),
    purchaseOrderLines: (orderId: string) =>
      generatePath(`${x}/purchase-order/${orderId}/lines`),
    purchaseOrderLine: (orderId: string, id: string) =>
      generatePath(`${x}/purchase-order/${orderId}/lines/${id}`),
    purchaseOrderPayment: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/payment`),
    purchaseOrderRelease: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/release`),
    purchaseOrderRoot: `${x}/purchase-order`,
    purchaseOrders: `${x}/purchasing/orders`,
    purchasing: `${x}/purchasing`,
    quote: (id: string) => generatePath(`${x}/quote/${id}`),
    quoteAssembly: (quoteId: string, lineId: string, assemblyId: string) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/assembly/${assemblyId}`
      ),
    quoteDetails: (id: string) => generatePath(`${x}/quote/${id}/details`),
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
    quoteLineCost: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/${quoteId}/${lineId}/cost/update`),
    quoteLineMethodMaterial: (
      quoteId: string,
      lineId: string,
      methodType: string,
      methodId: string,
      id: string
    ) =>
      generatePath(
        `${x}/quote/${quoteId}/${lineId}/${methodType}/${methodId}/${id}`
      ),
    quoteLineMakeMethod: (
      quoteId: string,
      lineId: string,
      makeMethodId: string,
      materialId: string
    ) =>
      generatePath(
        `${x}/quote/${quoteId}/${lineId}/make/${makeMethodId}/${materialId}`
      ),
    quoteLineMethod: (quoteId: string, quoteLineId: string, methodId: string) =>
      generatePath(`${x}/quote/${quoteId}/${quoteLineId}/method/${methodId}`),
    quoteLineRecalculatePrice: (quoteId: string, lineId: string) =>
      generatePath(`${x}/quote/${quoteId}/${lineId}/recalculate-price`),

    quoteMaterial: (quoteId: string, lineId: string, id: string) =>
      generatePath(`${x}/quote/methods/${quoteId}/${lineId}/material/${id}`),
    quoteMaterialsOrder: `${x}/quote/methods/material/order`,
    quoteMethodGet: `${x}/quote/methods/get`,
    quoteMethodSave: `${x}/quote/methods/save`,
    quoteOperation: (quoteId: string, lineId: string, id: string) =>
      generatePath(`${x}/quote/methods/${quoteId}/${lineId}/operation/${id}`),
    quoteOperationsOrder: `${x}/quote/methods/operation/order`,
    quoteOperationsDelete: `${x}/quote/methods/operation/delete`,
    quoteOperationTool: (id: string) =>
      generatePath(`${x}/quote/methods/operation/tool/${id}`),
    quotePayment: (id: string) => generatePath(`${x}/quote/${id}/payment`),
    quoteShipment: (id: string) => generatePath(`${x}/quote/${id}/shipment`),
    quoteStatus: (id: string) => generatePath(`${x}/quote/${id}/status`),
    quotes: `${x}/sales/quotes`,
    receipt: (id: string) => generatePath(`${x}/receipt/${id}`),
    receiptInvoice: (id: string) => generatePath(`${x}/receipt/${id}/invoice`),
    receiptDetails: (id: string) => generatePath(`${x}/receipt/${id}/details`),
    receiptLines: (id: string) => generatePath(`${x}/receipt/${id}/lines`),
    receipts: `${x}/inventory/receipts`,
    receiptPost: (id: string) => generatePath(`${x}/receipt/${id}/post`),
    receiptRoot: `${x}/receipt`,
    refreshSession: "/refresh-session",
    resendInvite: `${x}/users/resend-invite`,
    resetPassword: "/reset-password",
    resources: `${x}/resources`,
    root: "/",
    routings: `${x}/items/routing`,
    sales: `${x}/sales`,
    salesInvoices: `${x}/invoicing/sales`,
    salesOrder: (id: string) => generatePath(`${x}/sales-order/${id}`),
    salesOrderShipment: (id: string) =>
      generatePath(`${x}/sales-order/${id}/shipment`),
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
    salesOrderLineToJob: (orderId: string, lineId: string) =>
      generatePath(`${x}/sales-order/${orderId}/${lineId}/job`),
    salesOrderPayment: (id: string) =>
      generatePath(`${x}/sales-order/${id}/payment`),
    salesOrderRelease: (id: string) =>
      generatePath(`${x}/sales-order/${id}/release`),
    salesOrderStatus: (id: string) =>
      generatePath(`${x}/sales-order/${id}/status`),
    salesOrders: `${x}/sales/orders`,
    salesRfq: (id: string) => generatePath(`${x}/sales-rfq/${id}`),
    salesRfqConvert: (id: string) =>
      generatePath(`${x}/sales-rfq/${id}/convert`),
    salesRfqDetails: (id: string) =>
      generatePath(`${x}/sales-rfq/${id}/details`),
    salesRfqDrag: (id: string) => generatePath(`${x}/sales-rfq/${id}/drag`),
    salesRfqFavorite: `${x}/sales/rfqs/favorite`,
    salesRfqLine: (id: string, lineId: string) =>
      generatePath(`${x}/sales-rfq/${id}/${lineId}/details`),
    salesRfqLinesOrder: (id: string) =>
      generatePath(`${x}/sales-rfq/${id}/lines/order`),
    salesRfqRoot: `${x}/sales-rfq`,
    salesRfqStatus: (id: string) => generatePath(`${x}/sales-rfq/${id}/status`),
    salesRfqs: `${x}/sales/rfqs`,
    salesSettings: `${x}/settings/sales`,
    schedule: `${x}/schedule`,
    scheduleOperationUpdate: `${x}/schedule/operation/update`,
    scrapReason: (id: string) =>
      generatePath(`${x}/production/scrap-reasons/${id}`),
    scrapReasons: `${x}/production/scrap-reasons`,
    service: (id: string) => generatePath(`${x}/service/${id}`),
    services: `${x}/items/services`,
    serviceDetails: (id: string) => `${x}/service/${id}/details`,
    serviceRoot: `${x}/service`,
    servicePurchasing: (id: string) =>
      generatePath(`${x}/service/${id}/purchasing`),
    serviceSupplier: (serviceId: string, id: string) =>
      generatePath(`${x}/service/${serviceId}/suppliers/${id}`),
    serviceSuppliers: (id: string) =>
      generatePath(`${x}/service/${id}/suppliers`),
    settings: `${x}/settings`,
    sequences: `${x}/settings/sequences`,
    shelf: (id: string) => generatePath(`${x}/inventory/shelves/${id}`),
    shift: (id: string) => generatePath(`${x}/people/shifts/${id}`),
    shifts: `${x}/people/shifts`,
    shipments: `${x}/inventory/shipments`,
    shippingMethod: (id: string) =>
      generatePath(`${x}/inventory/shipping-methods/${id}`),
    shippingMethods: `${x}/inventory/shipping-methods`,
    supplier: (id: string) => generatePath(`${x}/supplier/${id}`),
    suppliers: `${x}/purchasing/suppliers`,
    supplierAccounts: `${x}/users/suppliers`,
    supplierAccounting: (id: string) =>
      generatePath(`${x}/supplier/${id}/accounting`),
    supplierContact: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/contacts/${id}`),
    supplierDetails: (id: string) =>
      generatePath(`${x}/supplier/${id}/details`),
    supplierContacts: (id: string) =>
      generatePath(`${x}/supplier/${id}/contacts`),
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
    supplierShipping: (id: string) =>
      generatePath(`${x}/supplier/${id}/shipping`),
    supplierQuotes: `${x}/purchasing/quotes`,
    supplierQuoteFavorite: `${x}/purchasing/quotes/favorite`,
    supplierQuoteDetails: (id: string) =>
      generatePath(`${x}/supplier-quote/${id}/details`),
    supplierRoot: `${x}/supplier`,
    supplierStatus: (id: string) =>
      generatePath(`${x}/purchasing/supplier-statuses/${id}`),
    supplierStatuses: `${x}/purchasing/supplier-statuses`,
    supplierType: (id: string) =>
      generatePath(`${x}/purchasing/supplier-types/${id}`),
    supplierTypes: `${x}/purchasing/supplier-types`,
    tableSequence: (id: string) =>
      generatePath(`${x}/settings/sequences/${id}`),
    tags: `${x}/settings/tags`,
    terms: `${x}/settings/terms`,
    theme: `${x}/account/theme`,
    timecards: `${x}/timecards`,
    tool: (id: string) => generatePath(`${x}/tool/${id}`),
    toolCosting: (id: string) => generatePath(`${x}/tool/${id}/costing`),
    toolDetails: (id: string) => generatePath(`${x}/tool/${id}/details`),
    toolInventory: (id: string) => generatePath(`${x}/tool/${id}/inventory`),
    toolInventoryLocation: (id: string, locationId: string) =>
      generatePath(`${x}/tool/${id}/inventory?location=${locationId}`),
    toolMakeMethod: (id: string) =>
      generatePath(`${x}/tool/${id}/manufacturing/method`),
    toolManufacturing: (id: string) =>
      generatePath(`${x}/tool/${id}/manufacturing`),
    toolManufacturingMaterial: (
      itemId: string,
      makeMethodId: string,
      methodMaterialId: string
    ) =>
      generatePath(
        `${x}/tool/${itemId}/manufacturing/${makeMethodId}/${methodMaterialId}`
      ),

    toolPlanning: (id: string) => generatePath(`${x}/tool/${id}/planning`),
    toolPlanningLocation: (id: string, locationId: string) =>
      generatePath(`${x}/tool/${id}/planning?location=${locationId}`),
    toolPricing: (id: string) => generatePath(`${x}/tool/${id}/pricing`),
    toolPurchasing: (id: string) => generatePath(`${x}/tool/${id}/purchasing`),
    toolRoot: `${x}/tool`,
    toolSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/tool/${itemId}/suppliers/${id}`),
    toolSuppliers: (id: string) => generatePath(`${x}/tool/${id}/suppliers`),
    tools: `${x}/items/tools`,
    uom: (id: string) => generatePath(`${x}/items/uom/${id}`),
    uoms: `${x}/items/uom`,
    userAttribute: (id: string) => generatePath(`${x}/account/${id}/attribute`),
    users: `${x}/users`,
    workCenters: `${x}/resources/work-centers`,
    workCenter: (id: string) =>
      generatePath(`${x}/resources/work-centers/${id}`),
  },
} as const;

export const onboardingSequence = [
  path.to.onboarding.theme,
  path.to.onboarding.user,
  path.to.onboarding.company,
] as const;

export const getStoragePath = (bucket: string, path: string) => {
  return `${SUPABASE_API_URL}/storage/v1/object/public/${bucket}/${path}`;
};

export const requestReferrer = (request: Request) => {
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

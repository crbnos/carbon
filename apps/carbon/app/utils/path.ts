import { generatePath } from "@remix-run/react";
import { SUPABASE_API_URL } from "~/config/env";

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
      currencies: `${api}/accounting/currencies`,
      customerContacts: (id: string) =>
        generatePath(`${api}/sales/customer-contacts?customerId=${id}`),
      customerLocations: (id: string) =>
        generatePath(`${api}/sales/customer-locations?customerId=${id}`),
      customerStatuses: `${api}/sales/customer-statuses`,
      customerTypes: `${api}/sales/customer-types`,
      departments: `${api}/resources/departments`,
      employeeTypes: `${api}/users/employee-types`,
      emptyPermissions: `${api}/users/empty-permissions`,
      equipmentTypes: `${api}/resources/equipment-types`,
      groupsByType: (type?: string) =>
        generatePath(`${api}/users/groups?type=${type}`),
      item: (type: string) => generatePath(`${api}/item/${type}`),
      locations: `${api}/resources/locations`,
      itemGroups: `${api}/items/groups`,
      rollback: (table: string, id: string) =>
        generatePath(
          `${api}/settings/sequence/rollback?table=${table}&currentSequence=${id}`
        ),
      sequences: (table: string) => `${api}/settings/sequences?table=${table}`,
      services: `${api}/items/services`,
      shifts: (id: string) =>
        generatePath(`${api}/resources/shifts?location=${id}`),
      shelves: (id: string) =>
        generatePath(`${api}/items/shelf?locationId=${id}`),
      supplierContacts: (id: string) =>
        generatePath(`${api}/purchasing/supplier-contacts?supplierId=${id}`),
      supplierLocations: (id: string) =>
        generatePath(`${api}/purchasing/supplier-locations?supplierId=${id}`),
      supplierStatuses: `${api}/purchasing/supplier-statuses`,
      supplierTypes: `${api}/purchasing/supplier-types`,
      unitOfMeasures: `${api}/items/uoms`,
      workCells: (id: string) =>
        generatePath(`${api}/resources/work-cells?location=${id}`),
      workCellTypes: `${api}/resources/work-cell-types`,
    },
    file: {
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
    attribute: (id: string) => generatePath(`${x}/resources/attribute/${id}`),
    attributes: `${x}/resources/attributes`,
    attributeCategory: (id: string) =>
      generatePath(`${x}/resources/attributes/${id}`),
    attributeCategoryList: (id: string) =>
      generatePath(`${x}/resources/attributes/list/${id}`),
    bulkEditPermissions: `${x}/users/bulk-edit-permissions`,
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
    consumablePlanning: (id: string) =>
      generatePath(`${x}/consumable/${id}/planning`),
    consumablePurchasing: (id: string) =>
      generatePath(`${x}/consumable/${id}/purchasing`),
    consumableSuppliers: (id: string) =>
      generatePath(`${x}/consumable/${id}/suppliers`),
    convertQuoteToOrder: (id: string) =>
      generatePath(`${x}/quote/${id}/convert-to-order`),
    currency: (id: string) => generatePath(`${x}/accounting/currencies/${id}`),
    currencies: `${x}/accounting/currencies`,
    customer: (id: string) => generatePath(`${x}/customer/${id}`),
    customerDetails: (id: string) =>
      generatePath(`${x}/customer/${id}/details`),
    customerRoot: `${x}/customer`,
    customers: `${x}/sales/customers`,
    customerAccounts: `${x}/users/customers`,
    customerContact: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/contacts/${id}`),
    customerContacts: (id: string) =>
      generatePath(`${x}/customer/${id}/contacts`),
    customerLocation: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/locations/${id}`),
    customerLocations: (id: string) =>
      generatePath(`${x}/customer/${id}/locations`),
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
    deleteAttribute: (id: string) =>
      generatePath(`${x}/resources/attribute/delete/${id}`),
    deleteAttributeCategory: (id: string) =>
      generatePath(`${x}/resources/attributes/delete/${id}`),
    deleteContractor: (id: string) =>
      generatePath(`${x}/resources/contractors/delete/${id}`),
    deleteCurrency: (id: string) =>
      generatePath(`${x}/accounting/currencies/delete/${id}`),
    deleteCustomerContact: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/contacts/delete/${id}`),
    deleteCustomerLocation: (customerId: string, id: string) =>
      generatePath(`${x}/customer/${customerId}/locations/delete/${id}`),
    deleteCustomerStatus: (id: string) =>
      generatePath(`${x}/sales/customer-statuses/delete/${id}`),
    deleteCustomerType: (id: string) =>
      generatePath(`${x}/sales/customer-types/delete/${id}`),
    deleteCustomField: (tableId: string, id: string) =>
      generatePath(`${x}/settings/custom-fields/${tableId}/delete/${id}`),
    deleteDepartment: (id: string) =>
      generatePath(`${x}/resources/departments/delete/${id}`),
    deleteDocument: (id: string) => generatePath(`${x}/documents/${id}/delete`),
    deleteEmployeeAbility: (abilityId: string, id: string) =>
      generatePath(`${x}/resources/ability/${abilityId}/employee/delete/${id}`),
    deleteEmployeeType: (id: string) =>
      generatePath(`${x}/users/employee-types/delete/${id}`),
    deleteEquipment: (id: string) =>
      generatePath(`${x}/resources/equipment/unit/delete/${id}`),
    deleteEquipmentType: (id: string) =>
      generatePath(`${x}/resources/equipment/delete/${id}`),
    deleteGroup: (id: string) => generatePath(`${x}/users/groups/delete/${id}`),
    deleteHoliday: (id: string) =>
      generatePath(`${x}/resources/holidays/delete/${id}`),
    deleteLocation: (id: string) =>
      generatePath(`${x}/resources/locations/delete/${id}`),
    deleteNote: (id: string) => generatePath(`${x}/shared/notes/${id}/delete`),
    deleteItemGroup: (id: string) =>
      generatePath(`${x}/items/groups/delete/${id}`),
    deleteMaterialForm: (id: string) =>
      generatePath(`${x}/items/forms/delete/${id}`),
    deleteMaterialSubstance: (id: string) =>
      generatePath(`${x}/items/substances/delete/${id}`),
    deletePartner: (id: string) =>
      generatePath(`${x}/resources/partners/delete/${id}`),
    deletePaymentTerm: (id: string) =>
      generatePath(`${x}/accounting/payment-terms/delete/${id}`),
    deletePurchaseInvoice: (id: string) =>
      generatePath(`${x}/purchase-invoice/delete/${id}`),
    deletePurchaseInvoiceLine: (invoiceId: string, lineId: string) =>
      generatePath(`${x}/purchase-invoice/${invoiceId}/lines/delete/${lineId}`),
    deletePurchaseOrder: (id: string) =>
      generatePath(`${x}/purchase-order/delete/${id}`),
    deletePurchaseOrderLine: (orderId: string, lineId: string) =>
      generatePath(`${x}/purchase-order/${orderId}/lines/delete/${lineId}`),
    deleteQuote: (id: string) => generatePath(`${x}/quote/delete/${id}`),
    deleteQuoteAssembly: (
      quoteId: string,
      lineId: string,
      assemblyId: string
    ) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/assembly/${assemblyId}/delete`
      ),
    deleteQuoteLine: (id: string, lineId: string) =>
      generatePath(`${x}/quote/${id}/lines/${lineId}/details/delete`),
    deleteReceipt: (id: string) => generatePath(`${x}/receipt/delete/${id}`),
    deleteRequestForQuote: (id: string) =>
      generatePath(`${x}/rfq/delete/${id}`),
    deleteSalesOrder: (id: string) =>
      generatePath(`${x}/sales-order/delete/${id}`),
    deleteSalesOrderLine: (orderId: string, lineId: string) =>
      generatePath(`${x}/sales-order/${orderId}/lines/delete/${lineId}`),
    deleteShift: (id: string) =>
      generatePath(`${x}/resources/shifts/delete/${id}`),
    deleteShippingMethod: (id: string) =>
      generatePath(`${x}/inventory/shipping-methods/delete/${id}`),
    deleteSupplierContact: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/contacts/delete/${id}`),
    deleteSupplierLocation: (supplierId: string, id: string) =>
      generatePath(`${x}/supplier/${supplierId}/locations/delete/${id}`),
    deleteSupplierStatus: (id: string) =>
      generatePath(`${x}/purchasing/supplier-statuses/delete/${id}`),
    deleteSupplierType: (id: string) =>
      generatePath(`${x}/purchasing/supplier-types/delete/${id}`),
    deleteUom: (id: string) => generatePath(`${x}/items/uom/delete/${id}`),
    deleteUserAttribute: (id: string) =>
      generatePath(`${x}/account/${id}/delete/attribute`),
    deleteWorkCell: (id: string) =>
      generatePath(`${x}/resources/work-cells/cell/delete/${id}`),
    deleteWorkCellType: (id: string) =>
      generatePath(`${x}/resources/work-cells/delete/${id}`),
    department: (id: string) =>
      generatePath(`${x}/resources/departments/${id}`),
    departments: `${x}/resources/departments`,
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
    equipment: `${x}/resources/equipment`,
    equipmentType: (id: string) =>
      generatePath(`${x}/resources/equipment/${id}`),
    equipmentTypeList: (id: string) =>
      generatePath(`${x}/resources/equipment/list/${id}`),
    equipmentUnit: (id: string) =>
      generatePath(`${x}/resources/equipment/unit/${id}`),
    fiscalYears: `${x}/accounting/years`,
    fixtures: `${x}/items/fixtures`,
    fixtureInventory: (id: string) =>
      generatePath(`${x}/fixture/${id}/inventory`),
    fixturePlanning: (id: string) =>
      generatePath(`${x}/fixture/${id}/planning`),
    forgotPassword: "/forgot-password",
    group: (id: string) => generatePath(`${x}/users/groups/${id}`),
    groups: `${x}/users/groups`,
    holiday: (id: string) => generatePath(`${x}/resources/holidays/${id}`),
    holidays: `${x}/resources/holidays`,
    integration: (name: string) =>
      generatePath(`${x}/settings/integrations/${name}`),
    integrations: `${x}/settings/integrations`,
    inventory: `${x}/inventory`,
    invoicing: `${x}/invoicing`,
    items: `${x}/items`,
    itemGroup: (id: string) => generatePath(`${x}/items/groups/${id}`),
    itemGroups: `${x}/items/groups`,
    jobs: `${x}/jobs`,
    location: (id: string) => generatePath(`${x}/resources/locations/${id}`),
    locations: `${x}/resources/locations`,
    login: "/login",
    logout: "/logout",
    materials: `${x}/items/materials`,
    materialForm: (id: string) => generatePath(`${x}/items/forms/${id}`),
    materialForms: `${x}/items/forms`,
    materialInventory: (id: string) =>
      generatePath(`${x}/material/${id}/inventory`),
    materialPlanning: (id: string) =>
      generatePath(`${x}/material/${id}/planning`),
    materialSubstance: (id: string) =>
      generatePath(`${x}/items/substances/${id}`),
    materialSubstances: `${x}/items/substances`,
    messaging: `${x}/messaging`,
    newAbility: `${x}/resources/abilities/new`,
    newAccountingCategory: `${x}/accounting/categories/new`,
    newAccountingSubcategory: (id: string) =>
      generatePath(`${x}/accounting/categories/list/${id}/new`),
    newAttribute: `${x}/resources/attribute/new`,
    newAttributeCategory: `${x}/resources/attributes/new`,
    newAttributeForCategory: (id: string) =>
      generatePath(`${x}/resources/attributes/list/${id}/new`),
    newChartOfAccount: `${x}/accounting/charts/new`,
    newCompany: `${x}/settings/company/new`,
    newConsumable: `${x}/consumable/new`,
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
    newDepartment: `${x}/resources/departments/new`,
    newDocument: `${x}/documents/new`,
    newEmployee: `${x}/users/employees/new`,
    newEmployeeAbility: (id: string) =>
      generatePath(`${x}/resources/ability/${id}/employee/new`),
    newEmployeeType: `${x}/users/employee-types/new`,
    newEquipment: (id: string) =>
      generatePath(`${x}/resources/equipment/list/${id}/new`),
    newEquipmentUnit: `${x}/resources/equipment/unit/new`,
    newEquipmentType: `${x}/resources/equipment/new`,
    newGroup: `${x}/users/groups/new`,
    newHoliday: `${x}/resources/holidays/new`,
    newLocation: `${x}/resources/locations/new`,
    newNote: `${x}/shared/notes/new`,
    newPart: `${x}/part/new`,
    newItemGroup: `${x}/items/groups/new`,
    newMaterialForm: `${x}/items/forms/new`,
    newMaterialSubstance: `${x}/items/substances/new`,
    newPartSupplier: (id: string) =>
      generatePath(`${x}/part/${id}/suppliers/new`),
    newPartner: `${x}/resources/partners/new`,
    newPaymentTerm: `${x}/accounting/payment-terms/new`,
    newPurchaseInvoice: `${x}/purchase-invoice/new`,
    newPurchaseInvoiceLine: (id: string) =>
      generatePath(`${x}/purchase-invoice/${id}/lines/new`),
    newPurchaseOrder: `${x}/purchase-order/new`,
    newPurchaseOrderLine: (id: string) =>
      generatePath(`${x}/purchase-order/${id}/lines/new`),
    newQuote: `${x}/quote/new`,
    newQuoteAssembly: (quoteId: string, lineId: string, parentId?: string) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/assembly/new${
          parentId ? `?parentAssemblyId=${parentId}` : ""
        }`
      ),
    newQuoteLine: (id: string) => generatePath(`${x}/quote/${id}/new`),
    newQuoteLineQuantity: (id: string, lineId: string) =>
      generatePath(`${x}/quote/${id}/lines/${lineId}/new`),
    newQuoteOperation: (quoteId: string, lineId: string, parentId?: string) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/operation/new${
          parentId ? `?quoteAssemblyId=${parentId}` : ""
        }`
      ),
    newQuoteMaterial: (quoteId: string, lineId: string, operationId: string) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/operation/${operationId}/material/new`
      ),
    newReceipt: `${x}/receipt/new`,
    newRequestForQuote: `${x}/rfq/new`,
    newSalesOrder: `${x}/sales-order/new`,
    newSalesOrderLine: (id: string) =>
      generatePath(`${x}/sales-order/${id}/lines/new`),
    newShift: `${x}/resources/shifts/new`,
    newShippingMethod: `${x}/inventory/shipping-methods/new`,
    newService: `${x}/service/new`,
    newServiceSupplier: (id: string) =>
      generatePath(`${x}/service/${id}/suppliers/new`),
    newSupplier: `${x}/supplier/new`,
    newSupplierAccount: `${x}/users/suppliers/new`,
    newSupplierContact: (id: string) =>
      generatePath(`${x}/supplier/${id}/contacts/new`),
    newSupplierLocation: (id: string) =>
      generatePath(`${x}/supplier/${id}/locations/new`),
    newSupplierStatus: `${x}/purchasing/supplier-statuses/new`,
    newSupplierType: `${x}/purchasing/supplier-types/new`,
    newTool: `${x}/tool/new`,
    newToolSupplier: (id: string) =>
      generatePath(`${x}/tool/${id}/suppliers/new`),
    newUom: `${x}/items/uom/new`,
    newWorkCell: `${x}/resources/work-cells/cell/new`,
    newWorkCellUnit: (id: string) =>
      generatePath(`${x}/resources/work-cells/list/${id}/new`),
    newWorkCellType: `${x}/resources/work-cells/new`,
    part: (id: string) => generatePath(`${x}/part/${id}`),
    partCosting: (id: string) => generatePath(`${x}/part/${id}/costing`),
    partDetails: (id: string) => generatePath(`${x}/part/${id}/details`),
    partInventory: (id: string) => generatePath(`${x}/part/${id}/inventory`),
    partInventoryLocation: (id: string, locationId: string) =>
      generatePath(`${x}/part/${id}/inventory?location=${locationId}`),
    partManufacturing: (id: string) =>
      generatePath(`${x}/part/${id}/manufacturing`),
    partPlanning: (id: string) => generatePath(`${x}/part/${id}/planning`),
    partPlanningLocation: (id: string, locationId: string) =>
      generatePath(`${x}/part/${id}/planning?location=${locationId}`),
    partPricing: (id: string) => generatePath(`${x}/part/${id}/pricing`),
    partPurchasing: (id: string) => generatePath(`${x}/part/${id}/purchasing`),
    partRoot: `${x}/part`,
    partSalePrice: (id: string) => generatePath(`${x}/part/${id}/sale-price`),
    partSupplier: (itemId: string, id: string) =>
      generatePath(`${x}/part/${itemId}/suppliers/${id}`),
    partSuppliers: (id: string) => generatePath(`${x}/part/${id}/suppliers`),
    parts: `${x}/items/parts`,
    partner: (id: string, abilityId: string) =>
      generatePath(`${x}/resources/partners/${id}/${abilityId}`),
    partners: `${x}/resources/partners`,
    paymentTerm: (id: string) =>
      generatePath(`${x}/accounting/payment-terms/${id}`),
    paymentTerms: `${x}/accounting/payment-terms`,
    people: `${x}/resources/people`,
    person: (id: string) => generatePath(`${x}/person/${id}`),
    personDetails: (id: string) => generatePath(`${x}/person/${id}/details`),
    personJob: (id: string) => generatePath(`${x}/person/${id}/job`),
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
    purchaseOrders: `${x}/purchasing/orders`,
    purchasing: `${x}/purchasing`,
    quote: (id: string) => generatePath(`${x}/quote/${id}`),
    quoteAssembly: (quoteId: string, lineId: string, assemblyId: string) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/assembly/${assemblyId}`
      ),
    quoteDetails: (id: string) => generatePath(`${x}/quote/${id}/details`),
    quoteExternalDocuments: (id: string) =>
      generatePath(`${x}/quote/${id}/external`),
    quoteFavorite: `${x}/sales/quotes/favorite`,
    quoteInternalDocuments: (id: string) =>
      generatePath(`${x}/quote/${id}/internal`),
    quoteLine: (quoteId: string, id: string) =>
      generatePath(`${x}/quote/${quoteId}/lines/${id}/details`),
    quoteMaterial: (
      quoteId: string,
      lineId: string,
      operationId: string,
      materialId: string
    ) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/operation/${operationId}/material/${materialId}`
      ),
    quoteOperation: (quoteId: string, lineId: string, operationId: string) =>
      generatePath(
        `${x}/quote/${quoteId}/lines/${lineId}/operation/${operationId}`
      ),
    quoteRelease: (id: string) => generatePath(`${x}/quote/${id}/release`),
    quotes: `${x}/sales/quotes`,
    receipt: (id: string) => generatePath(`${x}/receipt/${id}`),
    receiptInvoice: (id: string) => generatePath(`${x}/receipt/${id}/invoice`),
    receiptDetails: (id: string) => generatePath(`${x}/receipt/${id}/details`),
    receiptLines: (id: string) => generatePath(`${x}/receipt/${id}/lines`),
    receipts: `${x}/inventory/receipts`,
    receiptPost: (id: string) => generatePath(`${x}/receipt/${id}/post`),
    receiptRoot: `${x}/receipt`,
    refreshSession: "/refresh-session",
    requestForQuote: (id: string) => generatePath(`${x}/rfq/${id}`),
    requestForQuoteFavorite: `${x}/purchasing/rfqs/favorite`,
    requestForQuotes: `${x}/purchasing/rfqs`,
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
    salesOrderExternalDocuments: (id: string) =>
      generatePath(`${x}/sales-order/${id}/external`),
    salesOrderFavorite: `${x}/sales-order/orders/favorite`,
    salesOrderInternalDocuments: (id: string) =>
      generatePath(`${x}/sales-order/${id}/internal`),
    salesOrderLines: (orderId: string) =>
      generatePath(`${x}/sales-order/${orderId}/lines`),
    salesOrderLine: (orderId: string, id: string) =>
      generatePath(`${x}/sales-order/${orderId}/lines/${id}`),
    salesOrderPayment: (id: string) =>
      generatePath(`${x}/sales-order/${id}/payment`),
    salesOrderRelease: (id: string) =>
      generatePath(`${x}/sales-order/${id}/release`),
    salesOrders: `${x}/sales/orders`,
    scheduling: `${x}/scheduling`,
    service: (id: string) => generatePath(`${x}/service/${id}`),
    services: `${x}/items/services`,
    serviceDetails: (id: string) => `${x}/service/${id}/details`,
    serviceRoot: `${x}/service`,
    serviceSupplier: (serviceId: string, id: string) =>
      generatePath(`${x}/service/${serviceId}/suppliers/${id}`),
    serviceSuppliers: (id: string) =>
      generatePath(`${x}/service/${id}/suppliers`),
    settings: `${x}/settings`,
    sequences: `${x}/settings/sequences`,
    shift: (id: string) => generatePath(`${x}/resources/shifts/${id}`),
    shifts: `${x}/resources/shifts`,
    shipments: `${x}/inventory/shipments`,
    shippingMethod: (id: string) =>
      generatePath(`${x}/inventory/shipping-methods/${id}`),
    shippingMethods: `${x}/inventory/shipping-methods`,
    supplier: (id: string) => generatePath(`${x}/supplier/${id}`),
    suppliers: `${x}/purchasing/suppliers`,
    supplierAccounts: `${x}/users/suppliers`,
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
    supplierShipping: (id: string) =>
      generatePath(`${x}/supplier/${id}/shipping`),
    supplierRoot: `${x}/supplier`,
    supplierStatus: (id: string) =>
      generatePath(`${x}/purchasing/supplier-statuses/${id}`),
    supplierStatuses: `${x}/purchasing/supplier-statuses`,
    supplierType: (id: string) =>
      generatePath(`${x}/purchasing/supplier-types/${id}`),
    supplierTypes: `${x}/purchasing/supplier-types`,
    tableSequence: (id: string) =>
      generatePath(`${x}/settings/sequences/${id}`),
    theme: `${x}/account/theme`,
    timecards: `${x}/timecards`,
    tool: (id: string) => generatePath(`${x}/tool/${id}`),
    toolCosting: (id: string) => generatePath(`${x}/tool/${id}/costing`),
    toolDetails: (id: string) => generatePath(`${x}/tool/${id}/details`),
    toolInventory: (id: string) => generatePath(`${x}/tool/${id}/inventory`),
    toolInventoryLocation: (id: string, locationId: string) =>
      generatePath(`${x}/tool/${id}/inventory?location=${locationId}`),
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
    workCell: (id: string) =>
      generatePath(`${x}/resources/work-cells/cell/${id}`),
    workCells: `${x}/resources/work-cells`,
    workCellType: (id: string) =>
      generatePath(`${x}/resources/work-cells/${id}`),
    workCellTypeList: (id: string) =>
      generatePath(`/${x}/resources/work-cells/list/${id}`),
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

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  acceptDigitalQuote,
  activateRentalAgreement,
  amendContract,
  attachQuoteFile,
  attachSalesRfqFile,
  cancelContract,
  classifyRentalUnit,
  configureQuoteLine,
  confirmContract,
  confirmReturnOrder,
  confirmSalesOrder,
  convertQuote,
  convertSalesRfq,
  copyItemMethodToQuoteLine,
  copyItemMethodToQuoteMaterial,
  copyQuoteLineMethod,
  createContract,
  createQuoteLine,
  createQuoteMaterial,
  createQuoteOperation,
  createRentalAgreement,
  createReturnOrderLine,
  createSalesOrderLine,
  createSalesRfq,
  deleteQuoteMaterialAndReprice,
  deleteQuoteOperationAndReprice,
  deliverRentalUnit,
  escalateReturnOrderLine,
  finalizeAndSendQuote,
  mapSalesRfqLines,
  previewContractAmendment,
  previewContractCancellation,
  rejectDigitalQuote,
  releaseRentalUnit,
  returnRentalUnit,
  revertContractCancellation,
  sellRentalUnit,
  setContractInvoiceAutomation,
  setContractTerm,
  setContractType,
  setQuoteStatus,
  setRentalAgreementStatus,
  setRentalAgreementTerm,
  setRentalInvoiceAutomation,
  setSalesOrderStatus,
  setSalesRfqStatus,
  shipSalesOrderLine,
  updateContractTerms,
  updateQuoteDetails,
  updateQuoteField,
  updateQuoteLine,
  updateQuoteMaterial,
  updateQuoteOperation,
  updateReturnOrderLine,
  updateSalesOrderDetails,
  updateSalesOrderField,
  updateSalesOrderLine,
  updateSalesReturnOrderField,
  updateSalesRfqField
} from "./sales.server";
import {
  cancelSalesReturnOrderTool,
  copyQuoteTool,
  createOpportunityDocumentUploadUrlTool,
  createOpportunityLineDocumentUploadUrlTool,
  createPricingRuleTool,
  createReplacementSalesOrderTool,
  createSalesReturnOrderCreditTool,
  deleteCustomerBankAccountTool,
  deleteCustomerContactTool,
  deleteCustomerItemPriceOverrideTool,
  deleteCustomerItemRentalRateTool,
  deleteCustomerLocationTool,
  deleteCustomerStatusTool,
  deleteCustomerTool,
  deleteCustomerTypeTool,
  deleteNoQuoteReasonTool,
  deletePricingRuleTool,
  deleteQuoteLineTool,
  deleteQuoteOperationParameterTool,
  deleteQuoteOperationStepTool,
  deleteQuoteOperationToolTool,
  deleteQuoteTool,
  deleteRentalAgreementChargeTool,
  deleteRentalAgreementLineTool,
  deleteRentalAgreementTool,
  deleteReturnReasonTool,
  deleteSalesOrderLineTool,
  deleteSalesOrderTool,
  deleteSalesReturnOrderLineTool,
  deleteSalesReturnOrderTool,
  deleteSalesRFQLineTool,
  deleteSalesRFQTool,
  duplicatePricingRuleTool,
  getBaseCatalogTool,
  getConfigurationParametersByQuoteLineIdTool,
  getContractAmendmentsTool,
  getContractInvoiceScheduleTool,
  getContractLinesTool,
  getContractLineTool,
  getContractsTool,
  getContractTool,
  getCreditableQuantitiesTool,
  getCustomerBankAccountsTool,
  getCustomerContactsTool,
  getCustomerContactTool,
  getCustomerContractStatusesTool,
  getCustomerItemPriceOverrideByIdTool,
  getCustomerItemPriceOverrideTool,
  getCustomerItemRentalRatesTool,
  getCustomerItemRentalRateTool,
  getCustomerLocationsTool,
  getCustomerLocationTool,
  getCustomerPaymentTool,
  getCustomerShippingTool,
  getCustomerStatusesListTool,
  getCustomerStatusesTool,
  getCustomerStatusTool,
  getCustomersListTool,
  getCustomersTool,
  getCustomerTaxTool,
  getCustomerTool,
  getCustomerTypesListTool,
  getCustomerTypesTool,
  getCustomerTypeTool,
  getDefaultRentalRatesTool,
  getExternalSalesOrderLinesTool,
  getItemRentalRateTool,
  getModelByQuoteLineIdTool,
  getNoQuoteReasonsTool,
  getNoQuoteReasonTool,
  getOpenSalesOrderLinesForItemTool,
  getOpportunityDocumentsTool,
  getOpportunityLineDocumentsTool,
  getOpportunityTool,
  getPricingRulesTool,
  getPricingRuleTool,
  getQuoteByExternalIdTool,
  getQuoteCustomerDetailsTool,
  getQuoteLinePricesByQuoteIdTool,
  getQuoteLinePricesTool,
  getQuoteLinePriceTracesTool,
  getQuoteLinesListTool,
  getQuoteLinesTool,
  getQuoteLineTool,
  getQuoteMakeMethodTool,
  getQuoteMaterialsByMethodIdTool,
  getQuoteMethodTreesTool,
  getQuoteOperationsByLineTool,
  getQuoteOperationsByMethodIdTool,
  getQuotePaymentTool,
  getQuoteShipmentTool,
  getQuotesListTool,
  getQuotesTool,
  getQuoteTool,
  getRelatedPricesForQuoteLineTool,
  getRentableFleetAssetsTool,
  getRentalAgreementChargesTool,
  getRentalAgreementDepositsTool,
  getRentalAgreementLinesTool,
  getRentalAgreementLineTool,
  getRentalAgreementRelatedDocumentsTool,
  getRentalAgreementsTool,
  getRentalAgreementTool,
  getRentalBillingPeriodsTool,
  getReturnableLinesForCustomerTool,
  getReturnReasonsListTool,
  getReturnReasonsTool,
  getReturnReasonTool,
  getRootQuoteMakeMethodTool,
  getSalesDocumentsAssignedToMeTool,
  getSalesOrderInvoiceLinesTool,
  getSalesOrderInvoicePaymentsByIdsTool,
  getSalesOrderInvoicesByIdsTool,
  getSalesOrderLineShipmentsTool,
  getSalesOrderLinesTool,
  getSalesOrderLineTool,
  getSalesOrderPaymentTool,
  getSalesOrderRelatedItemsTool,
  getSalesOrderShipmentTool,
  getSalesOrdersListTool,
  getSalesOrdersTool,
  getSalesOrderTool,
  getSalesReturnOrderCreditsTool,
  getSalesReturnOrderIssuesTool,
  getSalesReturnOrderLinesTool,
  getSalesReturnOrderLineTool,
  getSalesReturnOrderReceiptsTool,
  getSalesReturnOrdersTool,
  getSalesReturnOrderTool,
  getSalesRFQLinesTool,
  getSalesRFQLineTool,
  getSalesRFQsTool,
  getSalesRFQTool,
  getSalesTermsTool,
  getShippedTrackedEntitiesForCustomerTool,
  insertCustomerContactTool,
  insertCustomerLocationTool,
  insertQuoteTool,
  insertSalesOrderTool,
  insertSalesReturnOrderTool,
  reopenSalesReturnOrderTool,
  repriceQuoteLineFromRulesTool,
  resolvePriceListTool,
  resolvePriceTool,
  setSalesReturnOrderLineDispositionTool,
  shortCloseSalesReturnOrderLineTool,
  updateCustomerContactTool,
  updateCustomerLocationTool,
  updateCustomerPaymentTool,
  updateCustomerShippingTool,
  updateCustomerTaxTool,
  updatePricingRuleTool,
  updateQuoteExchangeRateTool,
  updateQuoteLineOrderTool,
  updateQuoteLinePrecisionTool,
  updateQuoteMaterialOrderTool,
  updateQuoteOperationOrderTool,
  updateSalesOrderExchangeRateTool,
  updateSalesOrderLineOrderTool,
  updateSalesRFQLineOrderTool,
  upsertContractLineCreateTool,
  upsertContractLineUpdateTool,
  upsertCustomerBankAccountCreateTool,
  upsertCustomerBankAccountUpdateTool,
  upsertCustomerCreateTool,
  upsertCustomerItemPriceOverrideTool,
  upsertCustomerItemRentalRateTool,
  upsertCustomerStatusCreateTool,
  upsertCustomerStatusUpdateTool,
  upsertCustomerTypeCreateTool,
  upsertCustomerTypeUpdateTool,
  upsertCustomerUpdateTool,
  upsertItemRentalRateTool,
  upsertMakeMethodFromQuoteLineTool,
  upsertMakeMethodFromQuoteMethodTool,
  upsertNoQuoteReasonCreateTool,
  upsertNoQuoteReasonUpdateTool,
  upsertQuoteLineAdditionalChargesTool,
  upsertQuoteLinePricesTool,
  upsertQuoteOperationParameterCreateTool,
  upsertQuoteOperationParameterUpdateTool,
  upsertQuoteOperationStepCreateTool,
  upsertQuoteOperationStepUpdateTool,
  upsertQuoteOperationToolCreateTool,
  upsertQuoteOperationToolUpdateTool,
  upsertQuotePaymentTool,
  upsertQuoteShipmentTool,
  upsertRentalAgreementChargeCreateTool,
  upsertRentalAgreementChargeUpdateTool,
  upsertRentalAgreementLineCreateTool,
  upsertRentalAgreementLineUpdateTool,
  upsertReturnReasonCreateTool,
  upsertReturnReasonUpdateTool,
  upsertSalesOrderPaymentTool,
  upsertSalesOrderShipmentTool,
  upsertSalesRFQCreateTool,
  upsertSalesRFQLineCreateTool,
  upsertSalesRFQLineUpdateTool,
  upsertSalesRFQUpdateTool
} from "./sales.tools.server";

/** The sales module's operations, by entity. */
export const sales = {
  rfq: {
    create: createSalesRfq,
    updateField: updateSalesRfqField,
    setStatus: setSalesRfqStatus,
    convert: convertSalesRfq,
    attachFile: attachSalesRfqFile,
    mapLines: mapSalesRfqLines
  },
  quote: {
    update: updateQuoteDetails,
    setStatus: setQuoteStatus,
    updateField: updateQuoteField,
    finalize: finalizeAndSendQuote,
    convert: convertQuote,
    attachFile: attachQuoteFile,
    line: {
      create: createQuoteLine,
      update: updateQuoteLine,
      configure: configureQuoteLine,
      copyItemMethod: copyItemMethodToQuoteLine,
      copyLineMethod: copyQuoteLineMethod
    },
    material: {
      create: createQuoteMaterial,
      update: updateQuoteMaterial,
      delete: deleteQuoteMaterialAndReprice,
      copyItemMethod: copyItemMethodToQuoteMaterial
    },
    operation: {
      create: createQuoteOperation,
      update: updateQuoteOperation,
      delete: deleteQuoteOperationAndReprice
    },
    digital: { accept: acceptDigitalQuote, reject: rejectDigitalQuote },
    copy: copyQuoteTool,
    delete: deleteQuoteTool,
    get: getQuoteTool,
    insert: insertQuoteTool
  },
  order: {
    update: updateSalesOrderDetails,
    setStatus: setSalesOrderStatus,
    updateField: updateSalesOrderField,
    confirm: confirmSalesOrder,
    line: {
      create: createSalesOrderLine,
      update: updateSalesOrderLine,
      ship: shipSalesOrderLine
    }
  },
  returnOrder: {
    updateField: updateSalesReturnOrderField,
    confirm: confirmReturnOrder,
    line: {
      create: createReturnOrderLine,
      update: updateReturnOrderLine,
      escalate: escalateReturnOrderLine
    }
  },
  contract: {
    create: createContract,
    updateTerms: updateContractTerms,
    setTerm: setContractTerm,
    setType: setContractType,
    setInvoiceAutomation: setContractInvoiceAutomation,
    confirm: confirmContract,
    previewAmendment: previewContractAmendment,
    amend: amendContract,
    previewCancellation: previewContractCancellation,
    cancel: cancelContract,
    revertCancellation: revertContractCancellation,
    get: getContractTool
  },
  rentalAgreement: {
    create: createRentalAgreement,
    setTerm: setRentalAgreementTerm,
    setInvoiceAutomation: setRentalInvoiceAutomation,
    activate: activateRentalAgreement,
    setStatus: setRentalAgreementStatus,
    unit: {
      deliver: deliverRentalUnit,
      return: returnRentalUnit,
      release: releaseRentalUnit,
      classify: classifyRentalUnit,
      sell: sellRentalUnit
    },
    get: getRentalAgreementTool,
    delete: deleteRentalAgreementTool
  },
  pricingRule: {
    create: createPricingRuleTool,
    delete: deletePricingRuleTool,
    duplicate: duplicatePricingRuleTool,
    get: getPricingRuleTool,
    update: updatePricingRuleTool
  },
  customer: {
    delete: deleteCustomerTool,
    get: getCustomerTool,
    create: upsertCustomerCreateTool,
    update: upsertCustomerUpdateTool
  },
  customerBankAccount: {
    delete: deleteCustomerBankAccountTool,
    create: upsertCustomerBankAccountCreateTool,
    update: upsertCustomerBankAccountUpdateTool
  },
  customerBankAccounts: {
    get: getCustomerBankAccountsTool
  },
  customerContact: {
    delete: deleteCustomerContactTool,
    get: getCustomerContactTool,
    insert: insertCustomerContactTool,
    update: updateCustomerContactTool
  },
  customerLocation: {
    delete: deleteCustomerLocationTool,
    get: getCustomerLocationTool,
    insert: insertCustomerLocationTool,
    update: updateCustomerLocationTool
  },
  customerStatus: {
    delete: deleteCustomerStatusTool,
    get: getCustomerStatusTool,
    create: upsertCustomerStatusCreateTool,
    update: upsertCustomerStatusUpdateTool
  },
  customerType: {
    delete: deleteCustomerTypeTool,
    get: getCustomerTypeTool,
    create: upsertCustomerTypeCreateTool,
    update: upsertCustomerTypeUpdateTool
  },
  noQuoteReason: {
    delete: deleteNoQuoteReasonTool,
    get: getNoQuoteReasonTool,
    create: upsertNoQuoteReasonCreateTool,
    update: upsertNoQuoteReasonUpdateTool
  },
  quoteLine: {
    delete: deleteQuoteLineTool,
    get: getQuoteLineTool
  },
  quoteOperationStep: {
    delete: deleteQuoteOperationStepTool,
    create: upsertQuoteOperationStepCreateTool,
    update: upsertQuoteOperationStepUpdateTool
  },
  quoteOperationParameter: {
    delete: deleteQuoteOperationParameterTool,
    create: upsertQuoteOperationParameterCreateTool,
    update: upsertQuoteOperationParameterUpdateTool
  },
  quoteOperationTool: {
    delete: deleteQuoteOperationToolTool,
    create: upsertQuoteOperationToolCreateTool,
    update: upsertQuoteOperationToolUpdateTool
  },
  salesOrder: {
    delete: deleteSalesOrderTool,
    get: getSalesOrderTool,
    insert: insertSalesOrderTool
  },
  salesOrderLine: {
    delete: deleteSalesOrderLineTool,
    get: getSalesOrderLineTool
  },
  salesRFQ: {
    delete: deleteSalesRFQTool,
    get: getSalesRFQTool,
    create: upsertSalesRFQCreateTool,
    update: upsertSalesRFQUpdateTool
  },
  salesRFQLine: {
    delete: deleteSalesRFQLineTool,
    get: getSalesRFQLineTool,
    create: upsertSalesRFQLineCreateTool,
    update: upsertSalesRFQLineUpdateTool
  },
  configurationParametersByQuoteLineId: {
    get: getConfigurationParametersByQuoteLineIdTool
  },
  customerContacts: {
    get: getCustomerContactsTool
  },
  customerItemPriceOverride: {
    get: getCustomerItemPriceOverrideTool,
    upsert: upsertCustomerItemPriceOverrideTool,
    delete: deleteCustomerItemPriceOverrideTool
  },
  customerLocations: {
    get: getCustomerLocationsTool
  },
  customerPayment: {
    get: getCustomerPaymentTool,
    update: updateCustomerPaymentTool
  },
  customerShipping: {
    get: getCustomerShippingTool,
    update: updateCustomerShippingTool
  },
  customerTax: {
    get: getCustomerTaxTool,
    update: updateCustomerTaxTool
  },
  customers: {
    get: getCustomersTool
  },
  customersList: {
    get: getCustomersListTool
  },
  customerStatuses: {
    get: getCustomerStatusesTool
  },
  customerStatusesList: {
    get: getCustomerStatusesListTool
  },
  customerTypes: {
    get: getCustomerTypesTool
  },
  customerTypesList: {
    get: getCustomerTypesListTool
  },
  externalSalesOrderLines: {
    get: getExternalSalesOrderLinesTool
  },
  modelByQuoteLineId: {
    get: getModelByQuoteLineIdTool
  },
  noQuoteReasons: {
    get: getNoQuoteReasonsTool
  },
  opportunity: {
    get: getOpportunityTool
  },
  opportunityDocuments: {
    get: getOpportunityDocumentsTool
  },
  opportunityLineDocuments: {
    get: getOpportunityLineDocumentsTool
  },
  pricingRules: {
    get: getPricingRulesTool
  },
  quotes: {
    get: getQuotesTool
  },
  quotesList: {
    get: getQuotesListTool
  },
  quoteCustomerDetails: {
    get: getQuoteCustomerDetailsTool
  },
  quoteLinesList: {
    get: getQuoteLinesListTool
  },
  quoteMakeMethod: {
    get: getQuoteMakeMethodTool
  },
  rootQuoteMakeMethod: {
    get: getRootQuoteMakeMethodTool
  },
  quoteMethodTrees: {
    get: getQuoteMethodTreesTool
  },
  quoteLines: {
    get: getQuoteLinesTool
  },
  quoteByExternalId: {
    get: getQuoteByExternalIdTool
  },
  quoteLinePrices: {
    get: getQuoteLinePricesTool,
    upsert: upsertQuoteLinePricesTool
  },
  quoteLinePricesByQuoteId: {
    get: getQuoteLinePricesByQuoteIdTool
  },
  quoteMaterialsByMethodId: {
    get: getQuoteMaterialsByMethodIdTool
  },
  quoteOperationsByLine: {
    get: getQuoteOperationsByLineTool
  },
  quoteOperationsByMethodId: {
    get: getQuoteOperationsByMethodIdTool
  },
  quotePayment: {
    get: getQuotePaymentTool,
    upsert: upsertQuotePaymentTool
  },
  quoteShipment: {
    get: getQuoteShipmentTool,
    upsert: upsertQuoteShipmentTool
  },
  relatedPricesForQuoteLine: {
    get: getRelatedPricesForQuoteLineTool
  },
  salesDocumentsAssignedToMe: {
    get: getSalesDocumentsAssignedToMeTool
  },
  salesOrderRelatedItems: {
    get: getSalesOrderRelatedItemsTool
  },
  salesOrders: {
    get: getSalesOrdersTool
  },
  salesOrdersList: {
    get: getSalesOrdersListTool
  },
  salesOrderPayment: {
    get: getSalesOrderPaymentTool,
    upsert: upsertSalesOrderPaymentTool
  },
  salesTerms: {
    get: getSalesTermsTool
  },
  salesOrderShipment: {
    get: getSalesOrderShipmentTool,
    upsert: upsertSalesOrderShipmentTool
  },
  salesOrderLines: {
    get: getSalesOrderLinesTool
  },
  salesOrderInvoiceLines: {
    get: getSalesOrderInvoiceLinesTool
  },
  salesOrderInvoicesByIds: {
    get: getSalesOrderInvoicesByIdsTool
  },
  salesOrderInvoicePaymentsByIds: {
    get: getSalesOrderInvoicePaymentsByIdsTool
  },
  openSalesOrderLinesForItem: {
    get: getOpenSalesOrderLinesForItemTool
  },
  salesOrderLineShipments: {
    get: getSalesOrderLineShipmentsTool
  },
  salesRFQs: {
    get: getSalesRFQsTool
  },
  salesRFQLines: {
    get: getSalesRFQLinesTool
  },
  price: {
    resolve: resolvePriceTool
  },
  priceList: {
    resolve: resolvePriceListTool
  },
  baseCatalog: {
    get: getBaseCatalogTool
  },
  customerItemPriceOverrideById: {
    get: getCustomerItemPriceOverrideByIdTool
  },
  quoteExchangeRate: {
    update: updateQuoteExchangeRateTool
  },
  quoteLinePrecision: {
    update: updateQuoteLinePrecisionTool
  },
  salesOrderExchangeRate: {
    update: updateSalesOrderExchangeRateTool
  },
  quoteMaterialOrder: {
    update: updateQuoteMaterialOrderTool
  },
  quoteOperationOrder: {
    update: updateQuoteOperationOrderTool
  },
  makeMethodFromQuoteLine: {
    upsert: upsertMakeMethodFromQuoteLineTool
  },
  makeMethodFromQuoteMethod: {
    upsert: upsertMakeMethodFromQuoteMethodTool
  },
  quoteLineOrder: {
    update: updateQuoteLineOrderTool
  },
  quoteLineAdditionalCharges: {
    upsert: upsertQuoteLineAdditionalChargesTool
  },
  quoteLinePriceTraces: {
    get: getQuoteLinePriceTracesTool
  },
  quoteLineFromRules: {
    reprice: repriceQuoteLineFromRulesTool
  },
  salesOrderLineOrder: {
    update: updateSalesOrderLineOrderTool
  },
  salesRFQLineOrder: {
    update: updateSalesRFQLineOrderTool
  },
  returnReasons: {
    get: getReturnReasonsTool
  },
  returnReasonsList: {
    get: getReturnReasonsListTool
  },
  returnReason: {
    get: getReturnReasonTool,
    create: upsertReturnReasonCreateTool,
    update: upsertReturnReasonUpdateTool,
    delete: deleteReturnReasonTool
  },
  salesReturnOrders: {
    get: getSalesReturnOrdersTool
  },
  salesReturnOrder: {
    get: getSalesReturnOrderTool,
    insert: insertSalesReturnOrderTool,
    delete: deleteSalesReturnOrderTool,
    reopen: reopenSalesReturnOrderTool,
    cancel: cancelSalesReturnOrderTool
  },
  salesReturnOrderLines: {
    get: getSalesReturnOrderLinesTool
  },
  salesReturnOrderLine: {
    get: getSalesReturnOrderLineTool,
    delete: deleteSalesReturnOrderLineTool
  },
  salesReturnOrderReceipts: {
    get: getSalesReturnOrderReceiptsTool
  },
  salesReturnOrderCredits: {
    get: getSalesReturnOrderCreditsTool
  },
  salesReturnOrderIssues: {
    get: getSalesReturnOrderIssuesTool
  },
  closeSalesReturnOrderLine: {
    short: shortCloseSalesReturnOrderLineTool
  },
  returnableLinesForCustomer: {
    get: getReturnableLinesForCustomerTool
  },
  shippedTrackedEntitiesForCustomer: {
    get: getShippedTrackedEntitiesForCustomerTool
  },
  creditableQuantities: {
    get: getCreditableQuantitiesTool
  },
  salesReturnOrderCredit: {
    create: createSalesReturnOrderCreditTool
  },
  replacementSalesOrder: {
    create: createReplacementSalesOrderTool
  },
  salesReturnOrderLineDisposition: {
    set: setSalesReturnOrderLineDispositionTool
  },
  opportunityDocumentUploadUrl: {
    create: createOpportunityDocumentUploadUrlTool
  },
  opportunityLineDocumentUploadUrl: {
    create: createOpportunityLineDocumentUploadUrlTool
  },
  rentalAgreements: {
    get: getRentalAgreementsTool
  },
  rentalAgreementLines: {
    get: getRentalAgreementLinesTool
  },
  rentalAgreementLine: {
    get: getRentalAgreementLineTool,
    create: upsertRentalAgreementLineCreateTool,
    update: upsertRentalAgreementLineUpdateTool,
    delete: deleteRentalAgreementLineTool
  },
  rentalAgreementCharges: {
    get: getRentalAgreementChargesTool
  },
  rentalAgreementCharge: {
    create: upsertRentalAgreementChargeCreateTool,
    update: upsertRentalAgreementChargeUpdateTool,
    delete: deleteRentalAgreementChargeTool
  },
  rentalBillingPeriods: {
    get: getRentalBillingPeriodsTool
  },
  rentableFleetAssets: {
    get: getRentableFleetAssetsTool
  },
  itemRentalRate: {
    get: getItemRentalRateTool,
    upsert: upsertItemRentalRateTool
  },
  defaultRentalRates: {
    get: getDefaultRentalRatesTool
  },
  customerItemRentalRates: {
    get: getCustomerItemRentalRatesTool
  },
  customerItemRentalRate: {
    get: getCustomerItemRentalRateTool,
    upsert: upsertCustomerItemRentalRateTool,
    delete: deleteCustomerItemRentalRateTool
  },
  rentalAgreementDeposits: {
    get: getRentalAgreementDepositsTool
  },
  rentalAgreementRelatedDocuments: {
    get: getRentalAgreementRelatedDocumentsTool
  },
  contracts: {
    get: getContractsTool
  },
  contractLines: {
    get: getContractLinesTool
  },
  contractLine: {
    get: getContractLineTool,
    create: upsertContractLineCreateTool,
    update: upsertContractLineUpdateTool
  },
  contractInvoiceSchedule: {
    get: getContractInvoiceScheduleTool
  },
  contractAmendments: {
    get: getContractAmendmentsTool
  },
  customerContractStatuses: {
    get: getCustomerContractStatusesTool
  }
};

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  activateLease,
  addReturnOrderLine,
  applyPlanningActions,
  assignPurchasingPlanningActions,
  cancelLease,
  cancelPurchasingRfq,
  cancelReturnOrder,
  closePurchaseOrderAndApprovals,
  confirmReturnOrder,
  createPurchasingRfq,
  deactivateSupplier,
  decidePurchaseOrderApproval,
  decideSupplierApproval,
  declineDigitalSupplierQuote,
  deletePurchaseOrders,
  dismissPurchasingPlanningActions,
  finalizePurchaseOrderAndNotify,
  finalizePurchasingRfqAndNotify,
  finalizeSupplierQuoteWithLink,
  modifyLease,
  orderPlannedPurchases,
  overrideLeaseLineClassification,
  purchaseLeaseLine,
  recordSupplierQuoteLinkVisit,
  removeLeaseLineClassificationOverride,
  reopenPurchaseOrder,
  reopenPurchasingPlanningActions,
  reopenReturnOrder,
  requestSupplierApproval,
  sendSupplierQuoteToSupplier,
  submitDigitalSupplierQuote,
  terminateLeaseLine,
  updateDigitalSupplierQuoteLineNotes,
  updatePlanningPurchaseOrderLine,
  updatePurchaseOrders,
  updatePurchasingRfqs,
  updateReturnOrderLine,
  updateReturnOrders,
  updateSupplierQuotes
} from "./purchasing.server";
import {
  convertSupplierQuoteToOrderTool,
  createPurchaseReturnOrderCreditTool,
  createReplacementPurchaseOrderTool,
  createSupplierInteractionDocumentUploadUrlTool,
  createSupplierInteractionLineDocumentUploadUrlTool,
  deleteLeaseLineTool,
  deleteLeasePaymentTool,
  deleteLeaseTool,
  deletePurchaseOrderLineTool,
  deletePurchaseReturnOrderLineTool,
  deletePurchaseReturnOrderTool,
  deletePurchasingRFQLineTool,
  deletePurchasingRFQTool,
  deleteSupplierBankAccountTool,
  deleteSupplierContactTool,
  deleteSupplierLocationTool,
  deleteSupplierProcessTool,
  deleteSupplierQuoteLineTool,
  deleteSupplierQuoteTool,
  deleteSupplierTool,
  deleteSupplierTypeTool,
  duplicatePurchaseOrderTool,
  getCreditableQuantitiesForPurchaseReturnTool,
  getDefaultAttachmentsForPOTool,
  getLeaseEventsTool,
  getLeaseLinesTool,
  getLeasePaymentsTool,
  getLeaseRelatedDocumentsTool,
  getLeaseScheduleTool,
  getLeasesTool,
  getLeaseTool,
  getLinkedSupplierQuotesTool,
  getPurchaseOrderDeliveryTool,
  getPurchaseOrderLinesTool,
  getPurchaseOrderLineTool,
  getPurchaseOrderPaymentTool,
  getPurchaseOrdersTool,
  getPurchaseOrderTool,
  getPurchaseReturnOrderCreditsTool,
  getPurchaseReturnOrderIssuesTool,
  getPurchaseReturnOrderLinesTool,
  getPurchaseReturnOrderLineTool,
  getPurchaseReturnOrderLineTrackedEntitiesTool,
  getPurchaseReturnOrderShipmentsTool,
  getPurchaseReturnOrdersTool,
  getPurchaseReturnOrderTool,
  getPurchasingDocumentsAssignedToMeTool,
  getPurchasingPlanningTool,
  getPurchasingRFQLinesTool,
  getPurchasingRFQLineTool,
  getPurchasingRFQSuppliersWithLinksTool,
  getPurchasingRFQsTool,
  getPurchasingRFQTool,
  getReturnableEntitiesForSupplierTool,
  getReturnableLinesForSupplierTool,
  getSiblingQuotesForQuoteTool,
  getSupplierBankAccountsTool,
  getSupplierContactsTool,
  getSupplierContactTool,
  getSupplierInteractionDocumentsTool,
  getSupplierInteractionLineDocumentsTool,
  getSupplierInteractionTool,
  getSupplierLocationsTool,
  getSupplierLocationTool,
  getSupplierPaymentTool,
  getSupplierProcessesByProcessTool,
  getSupplierProcessesBySupplierTool,
  getSupplierQuoteByExternalLinkIdTool,
  getSupplierQuoteLinePricesByQuoteIdTool,
  getSupplierQuoteLinePricesTool,
  getSupplierQuoteLinesTool,
  getSupplierQuoteLineTool,
  getSupplierQuotesForComparisonTool,
  getSupplierQuotesTool,
  getSupplierQuoteTool,
  getSupplierReportContactsTool,
  getSupplierShippingTool,
  getSuppliersListTool,
  getSuppliersTool,
  getSupplierTaxTool,
  getSupplierTool,
  getSupplierTypesListTool,
  getSupplierTypesTool,
  getSupplierTypeTool,
  insertLeaseTool,
  insertPurchaseOrderTool,
  insertPurchaseReturnOrderTool,
  insertSupplierContactTool,
  insertSupplierLocationTool,
  insertSupplierQuoteTool,
  shortClosePurchaseOrderLineTool,
  shortClosePurchaseReturnOrderLineTool,
  updateLeaseDetailsTool,
  updatePurchaseOrderExchangeRateTool,
  updatePurchaseOrderFavoriteTool,
  updatePurchaseOrderLineOrderTool,
  updatePurchaseOrderTool,
  updatePurchasingRFQLineOrderTool,
  updatePurchasingRFQStatusTool,
  updateSupplierContactTool,
  updateSupplierLocationTool,
  updateSupplierPaymentTool,
  updateSupplierQuoteExchangeRateTool,
  updateSupplierQuoteLineOrderTool,
  updateSupplierQuoteStatusTool,
  updateSupplierQuoteTool,
  updateSupplierShippingTool,
  updateSupplierTaxTool,
  upsertLeasePaymentTool,
  upsertPurchaseOrderDeliveryTool,
  upsertPurchaseOrderLineCreateTool,
  upsertPurchaseOrderLineUpdateTool,
  upsertPurchaseOrderPaymentTool,
  upsertPurchasingRFQLineCreateTool,
  upsertPurchasingRFQLineUpdateTool,
  upsertPurchasingRFQSuppliersTool,
  upsertPurchasingRFQTool,
  upsertSupplierBankAccountCreateTool,
  upsertSupplierBankAccountUpdateTool,
  upsertSupplierCreateTool,
  upsertSupplierProcessCreateTool,
  upsertSupplierProcessUpdateTool,
  upsertSupplierQuoteLineCreateTool,
  upsertSupplierQuoteLineUpdateTool,
  upsertSupplierTypeCreateTool,
  upsertSupplierTypeUpdateTool,
  upsertSupplierUpdateTool
} from "./purchasing.tools.server";

/** The purchasing module's operations, by entity. */
export const purchasing = {
  purchaseOrder: {
    update: updatePurchaseOrders,
    updateDetails: updatePurchaseOrderTool,
    delete: deletePurchaseOrders,
    finalize: finalizePurchaseOrderAndNotify,
    decideApproval: decidePurchaseOrderApproval,
    reopen: reopenPurchaseOrder,
    close: closePurchaseOrderAndApprovals,
    duplicate: duplicatePurchaseOrderTool,
    get: getPurchaseOrderTool,
    insert: insertPurchaseOrderTool
  },
  purchaseReturnOrder: {
    update: updateReturnOrders,
    confirm: confirmReturnOrder,
    cancel: cancelReturnOrder,
    reopen: reopenReturnOrder,
    addLine: addReturnOrderLine,
    updateLine: updateReturnOrderLine,
    get: getPurchaseReturnOrderTool,
    insert: insertPurchaseReturnOrderTool,
    delete: deletePurchaseReturnOrderTool
  },
  rfq: {
    create: createPurchasingRfq,
    update: updatePurchasingRfqs,
    cancel: cancelPurchasingRfq,
    finalize: finalizePurchasingRfqAndNotify
  },
  supplierQuote: {
    update: updateSupplierQuotes,
    updateDetails: updateSupplierQuoteTool,
    finalize: finalizeSupplierQuoteWithLink,
    send: sendSupplierQuoteToSupplier,
    digital: {
      submit: submitDigitalSupplierQuote,
      decline: declineDigitalSupplierQuote,
      updateLineNotes: updateDigitalSupplierQuoteLineNotes,
      recordVisit: recordSupplierQuoteLinkVisit
    },
    delete: deleteSupplierQuoteTool,
    get: getSupplierQuoteTool,
    insert: insertSupplierQuoteTool
  },
  supplier: {
    requestApproval: requestSupplierApproval,
    deactivate: deactivateSupplier,
    decideApproval: decideSupplierApproval,
    delete: deleteSupplierTool,
    get: getSupplierTool,
    create: upsertSupplierCreateTool,
    update: upsertSupplierUpdateTool
  },
  lease: {
    activate: activateLease,
    cancel: cancelLease,
    modify: modifyLease,
    get: getLeaseTool,
    insert: insertLeaseTool,
    delete: deleteLeaseTool
  },
  planning: {
    order: orderPlannedPurchases,
    updateLine: updatePlanningPurchaseOrderLine,
    apply: applyPlanningActions,
    dismiss: dismissPurchasingPlanningActions,
    reopen: reopenPurchasingPlanningActions,
    assign: assignPurchasingPlanningActions
  },
  leaseLine: {
    terminate: terminateLeaseLine,
    purchase: purchaseLeaseLine,
    overrideClassification: overrideLeaseLineClassification,
    removeClassificationOverride: removeLeaseLineClassificationOverride,
    delete: deleteLeaseLineTool
  },
  supplierQuoteToOrder: {
    convert: convertSupplierQuoteToOrderTool
  },
  purchaseOrderLine: {
    delete: deletePurchaseOrderLineTool,
    get: getPurchaseOrderLineTool,
    create: upsertPurchaseOrderLineCreateTool,
    update: upsertPurchaseOrderLineUpdateTool
  },
  supplierContact: {
    delete: deleteSupplierContactTool,
    get: getSupplierContactTool,
    insert: insertSupplierContactTool,
    update: updateSupplierContactTool
  },
  supplierLocation: {
    delete: deleteSupplierLocationTool,
    get: getSupplierLocationTool,
    insert: insertSupplierLocationTool,
    update: updateSupplierLocationTool
  },
  supplierBankAccount: {
    delete: deleteSupplierBankAccountTool,
    create: upsertSupplierBankAccountCreateTool,
    update: upsertSupplierBankAccountUpdateTool
  },
  supplierBankAccounts: {
    get: getSupplierBankAccountsTool
  },
  supplierProcess: {
    delete: deleteSupplierProcessTool,
    create: upsertSupplierProcessCreateTool,
    update: upsertSupplierProcessUpdateTool
  },
  supplierQuoteLine: {
    delete: deleteSupplierQuoteLineTool,
    get: getSupplierQuoteLineTool,
    create: upsertSupplierQuoteLineCreateTool,
    update: upsertSupplierQuoteLineUpdateTool
  },
  supplierType: {
    delete: deleteSupplierTypeTool,
    get: getSupplierTypeTool,
    create: upsertSupplierTypeCreateTool,
    update: upsertSupplierTypeUpdateTool
  },
  purchaseOrders: {
    get: getPurchaseOrdersTool
  },
  purchaseOrderDelivery: {
    get: getPurchaseOrderDeliveryTool,
    upsert: upsertPurchaseOrderDeliveryTool
  },
  purchaseOrderPayment: {
    get: getPurchaseOrderPaymentTool,
    upsert: upsertPurchaseOrderPaymentTool
  },
  purchaseOrderLines: {
    get: getPurchaseOrderLinesTool
  },
  purchasingDocumentsAssignedToMe: {
    get: getPurchasingDocumentsAssignedToMeTool
  },
  purchasingPlanning: {
    get: getPurchasingPlanningTool
  },
  supplierContacts: {
    get: getSupplierContactsTool
  },
  supplierInteraction: {
    get: getSupplierInteractionTool
  },
  supplierInteractionDocuments: {
    get: getSupplierInteractionDocumentsTool
  },
  supplierInteractionLineDocuments: {
    get: getSupplierInteractionLineDocumentsTool
  },
  supplierLocations: {
    get: getSupplierLocationsTool
  },
  supplierPayment: {
    get: getSupplierPaymentTool,
    update: updateSupplierPaymentTool
  },
  supplierProcessesByProcess: {
    get: getSupplierProcessesByProcessTool
  },
  supplierProcessesBySupplier: {
    get: getSupplierProcessesBySupplierTool
  },
  supplierQuoteByExternalLinkId: {
    get: getSupplierQuoteByExternalLinkIdTool
  },
  supplierQuotes: {
    get: getSupplierQuotesTool
  },
  supplierQuoteLines: {
    get: getSupplierQuoteLinesTool
  },
  supplierQuoteLinePrices: {
    get: getSupplierQuoteLinePricesTool
  },
  supplierQuoteLinePricesByQuoteId: {
    get: getSupplierQuoteLinePricesByQuoteIdTool
  },
  supplierShipping: {
    get: getSupplierShippingTool,
    update: updateSupplierShippingTool
  },
  supplierReportContacts: {
    get: getSupplierReportContactsTool
  },
  suppliers: {
    get: getSuppliersTool
  },
  suppliersList: {
    get: getSuppliersListTool
  },
  supplierTypes: {
    get: getSupplierTypesTool
  },
  supplierTypesList: {
    get: getSupplierTypesListTool
  },
  purchaseOrderExchangeRate: {
    update: updatePurchaseOrderExchangeRateTool
  },
  purchaseOrderFavorite: {
    update: updatePurchaseOrderFavoriteTool
  },
  supplierQuoteExchangeRate: {
    update: updateSupplierQuoteExchangeRateTool
  },
  supplierQuoteStatus: {
    update: updateSupplierQuoteStatusTool
  },
  supplierTax: {
    get: getSupplierTaxTool,
    update: updateSupplierTaxTool
  },
  purchaseOrderLineOrder: {
    update: updatePurchaseOrderLineOrderTool
  },
  closePurchaseOrderLine: {
    short: shortClosePurchaseOrderLineTool
  },
  supplierQuoteLineOrder: {
    update: updateSupplierQuoteLineOrderTool
  },
  purchasingRFQ: {
    delete: deletePurchasingRFQTool,
    get: getPurchasingRFQTool,
    upsert: upsertPurchasingRFQTool
  },
  purchasingRFQLine: {
    delete: deletePurchasingRFQLineTool,
    get: getPurchasingRFQLineTool,
    create: upsertPurchasingRFQLineCreateTool,
    update: upsertPurchasingRFQLineUpdateTool
  },
  purchasingRFQs: {
    get: getPurchasingRFQsTool
  },
  purchasingRFQLines: {
    get: getPurchasingRFQLinesTool
  },
  purchasingRFQLineOrder: {
    update: updatePurchasingRFQLineOrderTool
  },
  purchasingRFQSuppliers: {
    upsert: upsertPurchasingRFQSuppliersTool
  },
  purchasingRFQStatus: {
    update: updatePurchasingRFQStatusTool
  },
  linkedSupplierQuotes: {
    get: getLinkedSupplierQuotesTool
  },
  siblingQuotesForQuote: {
    get: getSiblingQuotesForQuoteTool
  },
  supplierQuotesForComparison: {
    get: getSupplierQuotesForComparisonTool
  },
  purchasingRFQSuppliersWithLinks: {
    get: getPurchasingRFQSuppliersWithLinksTool
  },
  defaultAttachmentsForPO: {
    get: getDefaultAttachmentsForPOTool
  },
  purchaseReturnOrders: {
    get: getPurchaseReturnOrdersTool
  },
  purchaseReturnOrderLines: {
    get: getPurchaseReturnOrderLinesTool
  },
  purchaseReturnOrderLine: {
    get: getPurchaseReturnOrderLineTool,
    delete: deletePurchaseReturnOrderLineTool
  },
  purchaseReturnOrderLineTrackedEntities: {
    get: getPurchaseReturnOrderLineTrackedEntitiesTool
  },
  purchaseReturnOrderShipments: {
    get: getPurchaseReturnOrderShipmentsTool
  },
  purchaseReturnOrderCredits: {
    get: getPurchaseReturnOrderCreditsTool
  },
  purchaseReturnOrderIssues: {
    get: getPurchaseReturnOrderIssuesTool
  },
  closePurchaseReturnOrderLine: {
    short: shortClosePurchaseReturnOrderLineTool
  },
  returnableLinesForSupplier: {
    get: getReturnableLinesForSupplierTool
  },
  returnableEntitiesForSupplier: {
    get: getReturnableEntitiesForSupplierTool
  },
  creditableQuantitiesForPurchaseReturn: {
    get: getCreditableQuantitiesForPurchaseReturnTool
  },
  purchaseReturnOrderCredit: {
    create: createPurchaseReturnOrderCreditTool
  },
  replacementPurchaseOrder: {
    create: createReplacementPurchaseOrderTool
  },
  supplierInteractionDocumentUploadUrl: {
    create: createSupplierInteractionDocumentUploadUrlTool
  },
  supplierInteractionLineDocumentUploadUrl: {
    create: createSupplierInteractionLineDocumentUploadUrlTool
  },
  leases: {
    get: getLeasesTool
  },
  leaseDetails: {
    update: updateLeaseDetailsTool
  },
  leaseLines: {
    get: getLeaseLinesTool
  },
  leasePayments: {
    get: getLeasePaymentsTool
  },
  leasePayment: {
    upsert: upsertLeasePaymentTool,
    delete: deleteLeasePaymentTool
  },
  leaseSchedule: {
    get: getLeaseScheduleTool
  },
  leaseEvents: {
    get: getLeaseEventsTool
  },
  leaseRelatedDocuments: {
    get: getLeaseRelatedDocumentsTool
  }
};

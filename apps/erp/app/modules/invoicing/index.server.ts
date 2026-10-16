// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  adjustPayables,
  adjustReceivables,
  createPayment,
  createPurchaseInvoice,
  createSalesInvoiceLine,
  deleteDraftMemo,
  deleteDraftPurchaseInvoice,
  deleteDraftPurchaseInvoiceLine,
  deleteDraftSalesInvoice,
  deleteDraftSalesInvoiceLine,
  mapPurchaseInvoiceLines,
  payReimbursement,
  postMemo,
  postPayment,
  postPurchaseInvoice,
  postReimbursement,
  postSalesInvoice,
  saveAndPostReimbursement,
  saveReimbursement,
  sendSalesInvoice,
  updatePurchaseInvoiceField,
  updateSalesInvoiceField,
  updateSalesInvoiceLine,
  voidCharge,
  voidMemo,
  voidPayment,
  voidPurchaseInvoice,
  voidReimbursement,
  voidSalesInvoice
} from "./invoicing.server";
import {
  applyCreditsToInvoicesTool,
  createPurchaseInvoiceFromPurchaseOrderTool,
  createSalesInvoiceFromSalesOrderTool,
  createSalesInvoiceFromShipmentTool,
  deletePaymentTool,
  getApAgingTool,
  getApOpenBySupplierTool,
  getApTieOutTool,
  getArAgingTool,
  getArOpenByCustomerTool,
  getArTieOutTool,
  getAvailableCreditsForPartyTool,
  getAvailableOnAccountCreditSourcesTool,
  getChargesTool,
  getChargeTool,
  getCompanyHasOpenCreditsTool,
  getInvoiceSettlementsForInvoiceTool,
  getInvoiceSettlementsTool,
  getMemoApplicationsTool,
  getMemosTool,
  getMemoTool,
  getOpenPurchaseInvoicesForSupplierTool,
  getOpenReimbursementsForEmployeeTool,
  getOpenSalesInvoicesForCustomerTool,
  getPaymentCurrencyConfigurationTool,
  getPaymentsTool,
  getPaymentTool,
  getPurchaseInvoiceDeliveryTool,
  getPurchaseInvoiceLinesTool,
  getPurchaseInvoiceLineTool,
  getPurchaseInvoicesTool,
  getPurchaseInvoiceTool,
  getReimbursementRelatedItemsTool,
  getReimbursementsTool,
  getReimbursementTool,
  getSalesInvoiceLinesTool,
  getSalesInvoiceLineTool,
  getSalesInvoiceShipmentTool,
  getSalesInvoicesTool,
  getSalesInvoiceTool,
  getStagedCreditsForPaymentTool,
  insertSalesInvoiceTool,
  replaceInvoiceSettlementsTool,
  updatePurchaseInvoiceExchangeRateTool,
  updatePurchaseInvoiceLineOrderTool,
  updatePurchaseInvoiceTool,
  updateSalesInvoiceExchangeRateTool,
  updateSalesInvoiceLineOrderTool,
  upsertMemoCreateTool,
  upsertMemoUpdateTool,
  upsertPaymentUpdateTool,
  upsertPurchaseInvoiceDeliveryTool,
  upsertPurchaseInvoiceLineCreateTool,
  upsertPurchaseInvoiceLineUpdateTool,
  upsertSalesInvoiceShipmentTool
} from "./invoicing.tools.server";

/** The invoicing module's operations, by entity. */
export const invoicing = {
  salesInvoice: {
    updateField: updateSalesInvoiceField,
    post: postSalesInvoice,
    void: voidSalesInvoice,
    send: sendSalesInvoice,
    delete: deleteDraftSalesInvoice,
    line: {
      create: createSalesInvoiceLine,
      update: updateSalesInvoiceLine,
      delete: deleteDraftSalesInvoiceLine
    },
    get: getSalesInvoiceTool,
    insert: insertSalesInvoiceTool
  },
  purchaseInvoice: {
    create: createPurchaseInvoice,
    updateField: updatePurchaseInvoiceField,
    post: postPurchaseInvoice,
    void: voidPurchaseInvoice,
    delete: deleteDraftPurchaseInvoice,
    mapLines: mapPurchaseInvoiceLines,
    line: {
      delete: deleteDraftPurchaseInvoiceLine
    },
    get: getPurchaseInvoiceTool,
    update: updatePurchaseInvoiceTool
  },
  payment: {
    create: createPayment,
    post: postPayment,
    void: voidPayment,
    get: getPaymentTool,
    update: upsertPaymentUpdateTool,
    delete: deletePaymentTool
  },
  memo: {
    post: postMemo,
    void: voidMemo,
    delete: deleteDraftMemo,
    get: getMemoTool,
    create: upsertMemoCreateTool,
    update: upsertMemoUpdateTool
  },
  charge: {
    void: voidCharge,
    get: getChargeTool
  },
  receivables: {
    adjust: adjustReceivables
  },
  payables: {
    adjust: adjustPayables
  },
  reimbursement: {
    update: saveReimbursement,
    updateAndPost: saveAndPostReimbursement,
    post: postReimbursement,
    void: voidReimbursement,
    pay: payReimbursement,
    get: getReimbursementTool
  },
  purchaseInvoiceFromPurchaseOrder: {
    create: createPurchaseInvoiceFromPurchaseOrderTool
  },
  salesInvoiceFromSalesOrder: {
    create: createSalesInvoiceFromSalesOrderTool
  },
  salesInvoiceFromShipment: {
    create: createSalesInvoiceFromShipmentTool
  },
  purchaseInvoices: {
    get: getPurchaseInvoicesTool
  },
  purchaseInvoiceDelivery: {
    get: getPurchaseInvoiceDeliveryTool,
    upsert: upsertPurchaseInvoiceDeliveryTool
  },
  purchaseInvoiceLines: {
    get: getPurchaseInvoiceLinesTool
  },
  purchaseInvoiceLine: {
    get: getPurchaseInvoiceLineTool,
    create: upsertPurchaseInvoiceLineCreateTool,
    update: upsertPurchaseInvoiceLineUpdateTool
  },
  salesInvoices: {
    get: getSalesInvoicesTool
  },
  salesInvoiceShipment: {
    get: getSalesInvoiceShipmentTool,
    upsert: upsertSalesInvoiceShipmentTool
  },
  salesInvoiceLines: {
    get: getSalesInvoiceLinesTool
  },
  salesInvoiceLine: {
    get: getSalesInvoiceLineTool
  },
  purchaseInvoiceExchangeRate: {
    update: updatePurchaseInvoiceExchangeRateTool
  },
  salesInvoiceExchangeRate: {
    update: updateSalesInvoiceExchangeRateTool
  },
  purchaseInvoiceLineOrder: {
    update: updatePurchaseInvoiceLineOrderTool
  },
  salesInvoiceLineOrder: {
    update: updateSalesInvoiceLineOrderTool
  },
  payments: {
    get: getPaymentsTool
  },
  charges: {
    get: getChargesTool
  },
  reimbursements: {
    get: getReimbursementsTool
  },
  reimbursementRelatedItems: {
    get: getReimbursementRelatedItemsTool
  },
  invoiceSettlements: {
    get: getInvoiceSettlementsTool,
    replace: replaceInvoiceSettlementsTool
  },
  invoiceSettlementsForInvoice: {
    get: getInvoiceSettlementsForInvoiceTool
  },
  memoApplications: {
    get: getMemoApplicationsTool
  },
  openSalesInvoicesForCustomer: {
    get: getOpenSalesInvoicesForCustomerTool
  },
  openPurchaseInvoicesForSupplier: {
    get: getOpenPurchaseInvoicesForSupplierTool
  },
  openReimbursementsForEmployee: {
    get: getOpenReimbursementsForEmployeeTool
  },
  paymentCurrencyConfiguration: {
    get: getPaymentCurrencyConfigurationTool
  },
  availableOnAccountCreditSources: {
    get: getAvailableOnAccountCreditSourcesTool
  },
  memos: {
    get: getMemosTool
  },
  availableCreditsForParty: {
    get: getAvailableCreditsForPartyTool
  },
  companyHasOpenCredits: {
    get: getCompanyHasOpenCreditsTool
  },
  stagedCreditsForPayment: {
    get: getStagedCreditsForPaymentTool
  },
  creditsToInvoices: {
    apply: applyCreditsToInvoicesTool
  },
  arTieOut: {
    get: getArTieOutTool
  },
  apTieOut: {
    get: getApTieOutTool
  },
  arOpenByCustomer: {
    get: getArOpenByCustomerTool
  },
  apOpenBySupplier: {
    get: getApOpenBySupplierTool
  },
  arAging: {
    get: getArAgingTool
  },
  apAging: {
    get: getApAgingTool
  }
};

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
    }
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
    }
  },
  payment: {
    create: createPayment,
    post: postPayment,
    void: voidPayment
  },
  memo: {
    post: postMemo,
    void: voidMemo,
    delete: deleteDraftMemo
  },
  charge: {
    void: voidCharge
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
    pay: payReimbursement
  }
};

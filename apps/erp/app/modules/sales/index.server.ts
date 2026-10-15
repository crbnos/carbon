// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  acceptDigitalQuote,
  attachQuoteFile,
  attachSalesRfqFile,
  configureQuoteLine,
  confirmReturnOrder,
  confirmSalesOrder,
  convertQuote,
  convertSalesRfq,
  copyItemMethodToQuoteLine,
  copyItemMethodToQuoteMaterial,
  copyQuoteLineMethod,
  createQuoteLine,
  createQuoteMaterial,
  createQuoteOperation,
  createReturnOrderLine,
  createSalesOrderLine,
  createSalesRfq,
  deleteQuoteMaterialAndReprice,
  deleteQuoteOperationAndReprice,
  escalateReturnOrderLine,
  finalizeAndSendQuote,
  mapSalesRfqLines,
  rejectDigitalQuote,
  setSalesRfqStatus,
  shipSalesOrderLine,
  updateQuoteField,
  updateQuoteLine,
  updateQuoteMaterial,
  updateQuoteOperation,
  updateReturnOrderLine,
  updateSalesOrderField,
  updateSalesOrderLine,
  updateSalesReturnOrderField,
  updateSalesRfqField
} from "./sales.server";

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
    digital: { accept: acceptDigitalQuote, reject: rejectDigitalQuote }
  },
  order: {
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
  }
};

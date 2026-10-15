// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  acceptDigitalQuote,
  attachQuoteFile,
  attachSalesRfqFile,
  configureQuoteLine,
  confirmSalesOrder,
  convertQuote,
  convertSalesRfq,
  createQuoteLine,
  createSalesOrderLine,
  createSalesRfq,
  finalizeAndSendQuote,
  mapSalesRfqLines,
  rejectDigitalQuote,
  setSalesRfqStatus,
  shipSalesOrderLine,
  updateQuoteField,
  updateQuoteLine,
  updateSalesOrderField,
  updateSalesOrderLine,
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
      configure: configureQuoteLine
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
  }
};

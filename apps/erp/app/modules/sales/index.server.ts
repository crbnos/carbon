// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  attachQuoteFile,
  attachSalesRfqFile,
  configureQuoteLine,
  convertQuote,
  convertSalesRfq,
  createQuoteLine,
  createSalesRfq,
  finalizeAndSendQuote,
  mapSalesRfqLines,
  setSalesRfqStatus,
  updateQuoteField,
  updateQuoteLine,
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
    }
  }
};

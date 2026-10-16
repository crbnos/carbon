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
    digital: { accept: acceptDigitalQuote, reject: rejectDigitalQuote }
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
    revertCancellation: revertContractCancellation
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
    }
  }
};

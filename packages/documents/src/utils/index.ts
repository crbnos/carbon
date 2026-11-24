// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Client-safe: imported by browser code, so it must stay free of the react-pdf
// graph `./pdf` pulls in. Not a wildcard barrel — the per-document util files
// each export their own `getLineDescription`.
export {
  formatLinePartNumber,
  formatPartNumber,
  isPartNumberDisplay,
  LEGACY_PART_NUMBER_DISPLAY,
  PART_NUMBER_DISPLAYS,
  type PartNumberDisplay,
  type PartNumberDisplaySummary,
  type PartNumberParty,
  type PartNumberSurface,
  resolvePartNumberDisplay,
  summarizePartNumberDisplay
} from "./part-number";
export {
  getLineSupplierPartId,
  getPurchaseOrderDisplayId
} from "./purchase-order";
export { getQuoteDisplayId } from "./quote";
export { withRevisionSuffix } from "./revision";
export { getTaxTotal as getSalesInvoiceTaxTotal } from "./sales-invoice";
export { getLineTotal as getSalesOrderLineTotal } from "./sales-order";
export {
  buildTaxSummary,
  getInvoiceMessages,
  isPostedSalesInvoiceStatus,
  lineTaxSummaryEntries,
  postedTaxSummaryEntries,
  resolveSellerRegistration,
  salesInvoiceTaxSummaryLines,
  TAX_CODE_SUMMARY_SELECT,
  type TaxCodeSummaryRow,
  type TaxLedgerSummaryRow,
  type TaxRegistrationRow,
  type TaxSummaryCode,
  type TaxSummaryEntry,
  type TaxSummaryLine,
  toTaxSummaryCodes
} from "./tax-summary";

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { DEFAULT_CURRENCY_DECIMALS } from "@carbon/utils";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  resolveTemplate,
  salesOrderTexts,
  type ValueCollector
} from "../template";
import type { AccountsReceivableBillingAddress, PDF } from "../types";
import type { PartNumberDisplay } from "../utils/part-number";
import { getLineTaxableSubtotal } from "../utils/sales-order";
import {
  getMoneyFormatter,
  getRateFormatter,
  resolveRegistrationLine
} from "../utils/shared";
import {
  buildTaxSummary,
  lineTaxSummaryEntries,
  type TaxCodeSummaryRow,
  toTaxSummaryCodes
} from "../utils/tax-summary";
import { DocumentPage } from "./blocks/DocumentPage";
import { documentChrome } from "./blocks/documentChrome";
import type { SalesOrderData, SalesOrderLocations } from "./blocks/salesOrder";
import {
  buildSalesOrderVars,
  salesOrderBlockRegistry
} from "./blocks/salesOrder";

interface SalesOrderPDFProps extends PDF {
  valueCollector?: ValueCollector;
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"];
  salesOrderLines: Database["public"]["Views"]["salesOrderLines"]["Row"][];
  salesOrderLocations: SalesOrderLocations;
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  accountsReceivableBillingAddress?: AccountsReceivableBillingAddress | null;
  paymentTerms: { id: string; name: string }[];
  shippingMethods: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
  /** Stored layout. When omitted, the default Sales Order layout is used. */
  template?: DocumentTemplate | null;
  /** Shared sections referenced by the template, keyed by id. */
  sections?: Record<string, ResolvedSection>;
  /** Settlement decimals from the document currency's row; null/omitted falls back to 2. */
  currencyDecimals?: number | null;
  /** The Edit document modal's unsaved display choice for every line. */
  partNumberDisplayDraft?: PartNumberDisplay;
  /** The codes the lines name (`TAX_CODE_SUMMARY_SELECT`), for the tax summary. */
  taxCodes?: TaxCodeSummaryRow[] | null;
  /** The date the codes' components are read on (YYYY-MM-DD). */
  taxDate?: string | null;
}

const SalesOrderPDF = ({
  valueCollector,
  accountsReceivableBillingAddress,
  company,
  companySettings,
  meta,
  salesOrder,
  salesOrderLines,
  salesOrderLocations,
  terms,
  paymentTerms,
  shippingMethods,
  thumbnails,
  locale,
  currencyDecimals,
  template,
  sections = {},
  taxCodes,
  taxDate,
  partNumberDisplayDraft
}: SalesOrderPDFProps) => {
  const currencyCode = salesOrder.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. Totals/tax/shipping stay on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const resolved = resolveTemplate("salesOrder", template);
  const { theme, settings, footerSectionId } = resolved;

  // Sales orders have no ledger: the summary splits each line's tax across
  // its code's components on the order date.
  const taxLines = salesOrderLines.map((line) => ({
    taxCodeId: line.taxCodeId,
    taxPercent: line.taxPercent ?? 0,
    base: getLineTaxableSubtotal(line)
  }));
  const taxSummary =
    taxDate && taxCodes && taxCodes.length > 0
      ? buildTaxSummary(
          lineTaxSummaryEntries(taxLines, toTaxSummaryCodes(taxCodes), taxDate),
          taxLines.reduce((sum, line) => sum + line.base * line.taxPercent, 0),
          currencyDecimals ?? DEFAULT_CURRENCY_DECIMALS
        )
      : [];

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildSalesOrderVars({
      salesOrder,
      salesOrderLines,
      salesOrderLocations,
      company,
      currencyCode,
      locale,
      paymentTerms,
      shippingMethods,
      numberFormatter
    })
  );
  const chrome = documentChrome({
    texts: salesOrderTexts.document,
    template: resolved,
    vars,
    sections
  });
  const { documentTitle, documentNumber, headerOptions } = chrome;

  const registration = resolveRegistrationLine({
    company,
    footerSectionId,
    sections,
    settings,
    vars
  });

  const data: SalesOrderData = {
    company,
    companySettings,
    locale,
    salesOrder,
    salesOrderLines,
    salesOrderLocations,
    accountsReceivableBillingAddress,
    paymentTerms,
    shippingMethods,
    terms,
    thumbnails,
    theme,
    sections,
    currencyCode,
    numberFormatter,
    rateFormatter,
    values,
    vars,
    headerOptions,
    taxSummary,
    documentTitle,
    documentNumber,
    partNumberDisplayDraft
  };

  return (
    <DocumentPage
      chrome={chrome}
      template={resolved}
      meta={meta}
      keywords="sales order"
      footerDocumentId={salesOrder?.salesOrderId}
      footerLabel={registration.label}
      showRegistrationLine={registration.show}
      registry={salesOrderBlockRegistry}
      data={data}
    />
  );
};

export default SalesOrderPDF;

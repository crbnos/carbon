// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  resolveTemplate,
  salesReturnOrderTexts,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import {
  getMoneyFormatter,
  getRateFormatter,
  resolveRegistrationLine
} from "../utils/shared";
import { DocumentPage } from "./blocks/DocumentPage";
import { documentChrome } from "./blocks/documentChrome";
import type {
  ReturnOrderAddress,
  SalesReturnOrderData,
  SalesReturnOrderPdfLine
} from "./blocks/salesReturnOrder";
import {
  buildSalesReturnOrderVars,
  salesReturnOrderBlockRegistry
} from "./blocks/salesReturnOrder";

interface SalesReturnOrderPDFProps extends PDF {
  valueCollector?: ValueCollector;
  salesReturnOrder: Database["public"]["Views"]["salesReturnOrders"]["Row"];
  salesReturnOrderLines: SalesReturnOrderPdfLine[];
  /** Company location the goods return to (the header's `locationId`). */
  returnToAddress?: ReturnOrderAddress | null;
  /** The returning customer (name + address). */
  customerAddress?: ReturnOrderAddress | null;
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  terms: JSONContent;
  /** Stored layout. When omitted, the default RMA layout is used. */
  template?: DocumentTemplate | null;
  /** Shared sections referenced by the template, keyed by id. */
  sections?: Record<string, ResolvedSection>;
  /** Settlement decimals from the document currency's row; null/omitted falls back to 2. */
  currencyDecimals?: number | null;
}

const SalesReturnOrderPDF = ({
  valueCollector,
  company,
  companySettings,
  meta,
  salesReturnOrder,
  salesReturnOrderLines,
  returnToAddress,
  customerAddress,
  terms,
  locale,
  currencyDecimals,
  template,
  sections = {}
}: SalesReturnOrderPDFProps) => {
  const currencyCode =
    salesReturnOrder.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. The total row stays on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const resolved = resolveTemplate("salesReturnOrder", template);
  const { theme, settings, footerSectionId } = resolved;

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildSalesReturnOrderVars({
      salesReturnOrder,
      salesReturnOrderLines,
      customerAddress,
      returnToAddress,
      company,
      currencyCode,
      locale,
      numberFormatter
    })
  );
  const chrome = documentChrome({
    texts: salesReturnOrderTexts.document,
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

  const data: SalesReturnOrderData = {
    company,
    companySettings,
    locale,
    salesReturnOrder,
    salesReturnOrderLines,
    returnToAddress,
    customerAddress,
    terms,
    theme,
    sections,
    currencyCode,
    numberFormatter,
    rateFormatter,
    values,
    vars,
    headerOptions,
    documentTitle,
    documentNumber
  };

  return (
    <DocumentPage
      chrome={chrome}
      template={resolved}
      meta={meta}
      keywords="rma, return merchandise authorization"
      footerDocumentId={salesReturnOrder?.salesReturnOrderId}
      footerLabel={registration.label}
      showRegistrationLine={registration.show}
      registry={salesReturnOrderBlockRegistry}
      data={data}
    />
  );
};

export default SalesReturnOrderPDF;

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
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
import { Template } from "./components";

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

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("salesReturnOrder", template);

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
  const {
    documentTitle,
    documentNumber,
    footerText,
    headerOptions,
    headerContent,
    footerContent,
    showFooter,
    visibleBlocks
  } = documentChrome({
    texts: salesReturnOrderTexts.document,
    settings,
    vars,
    blocks,
    sections,
    headerSectionId,
    footerSectionId
  });

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
    <Template
      theme={theme}
      title={documentTitle}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "rma, return merchandise authorization",
        subject: meta?.subject ?? documentTitle
      }}
      footerDocumentId={salesReturnOrder?.salesReturnOrderId}
      footerLabel={registration.label}
      showFooter={showFooter}
      showPageNumbers={settings.showPageNumbers}
      pageNumberFormat={settings.pageNumberFormat}
      showRegistrationLine={registration.show}
      fontFamily={settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
      footerText={footerText}
    >
      {visibleBlocks.map((block) => {
        const render = salesReturnOrderBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default SalesReturnOrderPDF;

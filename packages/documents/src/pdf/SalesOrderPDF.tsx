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
  salesOrderTexts,
  type ValueCollector
} from "../template";
import type { AccountsReceivableBillingAddress, PDF } from "../types";
import {
  getMoneyFormatter,
  getRateFormatter,
  resolveRegistrationLine
} from "../utils/shared";
import { documentChrome } from "./blocks/documentChrome";
import type { SalesOrderData, SalesOrderLocations } from "./blocks/salesOrder";
import {
  buildSalesOrderVars,
  salesOrderBlockRegistry
} from "./blocks/salesOrder";
import { Template } from "./components";

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
  sections = {}
}: SalesOrderPDFProps) => {
  const currencyCode = salesOrder.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. Totals/tax/shipping stay on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("salesOrder", template);

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
    texts: salesOrderTexts.document,
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
    documentTitle,
    documentNumber
  };

  return (
    <Template
      theme={theme}
      title={documentTitle}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "sales order",
        subject: meta?.subject ?? documentTitle
      }}
      footerDocumentId={salesOrder?.salesOrderId}
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
        const render = salesOrderBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default SalesOrderPDF;

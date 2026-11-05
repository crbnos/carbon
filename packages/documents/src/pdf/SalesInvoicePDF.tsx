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
  salesInvoiceTexts,
  type ValueCollector
} from "../template";
import type { AccountsReceivableBillingAddress, PDF } from "../types";
import {
  getMoneyFormatter,
  getRateFormatter,
  resolveRegistrationLine
} from "../utils/shared";
import type { SalesInvoiceData, SalesInvoiceLocations } from "./blocks";
import { buildSalesInvoiceVars, salesInvoiceBlockRegistry } from "./blocks";
import { documentChrome } from "./blocks/documentChrome";
import { Template } from "./components";

interface SalesInvoicePDFProps extends PDF {
  valueCollector?: ValueCollector;
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"];
  salesInvoiceLines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][];
  salesOrderIds?: string[];
  salesInvoiceLocations: SalesInvoiceLocations;
  salesInvoiceShipment: Database["public"]["Tables"]["salesInvoiceShipment"]["Row"];
  accountsReceivableBillingAddress?: AccountsReceivableBillingAddress | null;
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  paymentTerms: { id: string; name: string }[];
  shippingMethods: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
  /** Stored layout. When omitted, the default Sales Invoice layout is used. */
  template?: DocumentTemplate | null;
  /** Shared sections referenced by the template, keyed by id. */
  sections?: Record<string, ResolvedSection>;
  /** Settlement decimals from the document currency's row; null/omitted falls back to 2. */
  currencyDecimals?: number | null;
}

const SalesInvoicePDF = ({
  valueCollector,
  accountsReceivableBillingAddress,
  company,
  companySettings,
  meta,
  salesInvoice,
  salesInvoiceShipment,
  salesInvoiceLines,
  salesInvoiceLocations,
  salesOrderIds,
  terms,
  paymentTerms,
  shippingMethods,
  thumbnails,
  locale,
  currencyDecimals,
  template,
  sections = {}
}: SalesInvoicePDFProps) => {
  const currencyCode = salesInvoice.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. Totals/tax/shipping stay on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("salesInvoice", template);

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildSalesInvoiceVars({
      salesInvoice,
      salesInvoiceLines,
      salesInvoiceLocations,
      salesInvoiceShipment,
      salesOrderIds,
      paymentTerms,
      shippingMethods,
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
    texts: salesInvoiceTexts.document,
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

  // Header layout now lives on the global header section's config (not the
  // block), so every document shares one header configuration.

  const data: SalesInvoiceData = {
    company,
    companySettings,
    locale,
    salesInvoice,
    salesInvoiceLines,
    salesInvoiceLocations,
    salesInvoiceShipment,
    salesOrderIds,
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

  // The header/footer selectors are the single control for the top header and
  // the footer band. "None" (null id) removes them entirely; the built-in
  // default id keeps them. This drives both the company Header block and the
  // structural footer (registration line + page numbers).

  return (
    <Template
      theme={theme}
      title={documentTitle}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "sales invoice",
        subject: meta?.subject ?? documentTitle
      }}
      footerDocumentId={salesInvoice?.invoiceId}
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
        const render = salesInvoiceBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default SalesInvoicePDF;

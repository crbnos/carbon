// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { DEFAULT_CURRENCY_DECIMALS } from "@carbon/utils";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { AccountsReceivableBillingAddress, PDF } from "../types";
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
import type { SalesOrderData, SalesOrderLocations } from "./blocks/salesOrder";
import {
  buildSalesOrderVars,
  salesOrderBlockRegistry
} from "./blocks/salesOrder";
import { Template } from "./components";

interface SalesOrderPDFProps extends PDF {
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
  /** The codes the lines name (`TAX_CODE_SUMMARY_SELECT`), for the tax summary. */
  taxCodes?: TaxCodeSummaryRow[] | null;
  /** The date the codes' components are read on (YYYY-MM-DD). */
  taxDate?: string | null;
}

const SalesOrderPDF = ({
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
  title = "Sales Order"
}: SalesOrderPDFProps) => {
  const currencyCode = salesOrder.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. Totals/tax/shipping stay on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("salesOrder", template);

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

  const vars = buildSalesOrderVars({
    salesOrder,
    salesOrderLocations,
    company,
    currencyCode
  });

  const registration = resolveRegistrationLine({
    company,
    footerSectionId,
    sections,
    settings,
    vars
  });

  const headerOptions = {
    ...DEFAULT_HEADER_OPTIONS,
    ...(headerSectionId ? (sections[headerSectionId]?.config ?? {}) : {})
  };

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
    vars,
    headerOptions,
    taxSummary
  };

  const headerSection = headerSectionId
    ? sections[headerSectionId]?.content
    : undefined;
  const footerSection = footerSectionId
    ? sections[footerSectionId]?.content
    : undefined;
  const headerContent = headerSection
    ? interpolateContent(headerSection, vars)
    : undefined;
  const footerContent = footerSection
    ? interpolateContent(footerSection, vars)
    : undefined;

  const showHeader = headerSectionId !== null;
  const showFooter = footerSectionId !== null;
  const visibleBlocks = blocks.filter(
    (block) => block.visible && !(block.type === "header" && !showHeader)
  );

  return (
    <Template
      theme={theme}
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "sales order",
        subject: meta?.subject ?? "Sales Order"
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

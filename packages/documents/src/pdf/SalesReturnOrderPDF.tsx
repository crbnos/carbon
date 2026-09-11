import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { PDF } from "../types";
import {
  getMoneyFormatter,
  getRateFormatter,
  resolveRegistrationLine
} from "../utils/shared";
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
  sections = {},
  title = "Return Merchandise Authorization"
}: SalesReturnOrderPDFProps) => {
  const currencyCode =
    salesReturnOrder.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. The total row stays on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("salesReturnOrder", template);

  const vars = buildSalesReturnOrderVars({
    salesReturnOrder,
    customerAddress,
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
    vars,
    headerOptions
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
        keywords: meta?.keywords ?? "rma, return merchandise authorization",
        subject: meta?.subject ?? "Return Merchandise Authorization"
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

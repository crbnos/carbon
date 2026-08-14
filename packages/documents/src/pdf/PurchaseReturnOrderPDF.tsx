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
  PurchaseReturnOrderData,
  PurchaseReturnOrderPdfLine,
  ReturnOrderAddress
} from "./blocks/purchaseReturnOrder";
import {
  buildPurchaseReturnOrderVars,
  purchaseReturnOrderBlockRegistry
} from "./blocks/purchaseReturnOrder";
import { Template } from "./components";

interface PurchaseReturnOrderPDFProps extends PDF {
  purchaseReturnOrder: Database["public"]["Views"]["purchaseReturnOrders"]["Row"];
  purchaseReturnOrderLines: PurchaseReturnOrderPdfLine[];
  /** Company location the goods ship back from (the header's `locationId`). */
  shipFromAddress?: ReturnOrderAddress | null;
  /** The supplier the goods return to (name + ship-to address). */
  supplierAddress?: ReturnOrderAddress | null;
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  terms: JSONContent;
  /** Stored layout. When omitted, the default supplier-return layout is used. */
  template?: DocumentTemplate | null;
  /** Shared sections referenced by the template, keyed by id. */
  sections?: Record<string, ResolvedSection>;
  /** Settlement decimals from the document currency's row; null/omitted falls back to 2. */
  currencyDecimals?: number | null;
}

const PurchaseReturnOrderPDF = ({
  company,
  companySettings,
  meta,
  purchaseReturnOrder,
  purchaseReturnOrderLines,
  shipFromAddress,
  supplierAddress,
  terms,
  locale,
  currencyDecimals,
  template,
  sections = {},
  title = "Return to Supplier"
}: PurchaseReturnOrderPDFProps) => {
  const currencyCode =
    purchaseReturnOrder.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. The total row stays on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("purchaseReturnOrder", template);

  const vars = buildPurchaseReturnOrderVars({
    purchaseReturnOrder,
    supplierAddress,
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

  const data: PurchaseReturnOrderData = {
    company,
    companySettings,
    locale,
    purchaseReturnOrder,
    purchaseReturnOrderLines,
    shipFromAddress,
    supplierAddress,
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
        keywords: meta?.keywords ?? "supplier return, purchase return order",
        subject: meta?.subject ?? "Return to Supplier"
      }}
      footerDocumentId={purchaseReturnOrder?.purchaseReturnOrderId}
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
        const render = purchaseReturnOrderBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default PurchaseReturnOrderPDF;

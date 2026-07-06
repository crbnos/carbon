import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { AccountsReceivableBillingAddress, PDF } from "../types";
import { composeRegistrationLine } from "../utils/footer";
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
  template,
  sections = {},
  title = "Sales Order"
}: SalesOrderPDFProps) => {
  const currencyCode = salesOrder.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = new Intl.NumberFormat(locale, {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const registrationLine = composeRegistrationLine({
    companyName: company.name,
    country: company.countryCode,
    eori: company.eori
  });

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("salesOrder", template);

  const vars = buildSalesOrderVars({
    salesOrder,
    salesOrderLocations,
    company,
    currencyCode
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
        keywords: meta?.keywords ?? "sales order",
        subject: meta?.subject ?? "Sales Order"
      }}
      footerDocumentId={salesOrder?.salesOrderId}
      footerLabel={registrationLine ?? undefined}
      showFooter={showFooter}
      showPageNumbers={settings.showPageNumbers}
      pageNumberFormat={settings.pageNumberFormat}
      showRegistrationLine={settings.showRegistrationLine}
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

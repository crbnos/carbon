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
import type { SalesInvoiceData, SalesInvoiceLocations } from "./blocks";
import { buildSalesInvoiceVars, salesInvoiceBlockRegistry } from "./blocks";
import { Template } from "./components";

interface SalesInvoicePDFProps extends PDF {
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
}

const SalesInvoicePDF = ({
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
  template,
  sections = {},
  title = "Invoice"
}: SalesInvoicePDFProps) => {
  const currencyCode = salesInvoice.currencyCode ?? company.baseCurrencyCode;
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
    resolveTemplate("salesInvoice", template);

  const vars = buildSalesInvoiceVars({
    salesInvoice,
    salesInvoiceLocations,
    company,
    currencyCode
  });

  // Header layout now lives on the global header section's config (not the
  // block), so every document shares one header configuration.
  const headerOptions = {
    ...DEFAULT_HEADER_OPTIONS,
    ...(headerSectionId ? (sections[headerSectionId]?.config ?? {}) : {})
  };

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

  // The header/footer selectors are the single control for the top header and
  // the footer band. "None" (null id) removes them entirely; the built-in
  // default id keeps them. This drives both the company Header block and the
  // structural footer (registration line + page numbers).
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
        keywords: meta?.keywords ?? "sales invoice",
        subject: meta?.subject ?? "Invoice"
      }}
      footerDocumentId={salesInvoice?.invoiceId}
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
        const render = salesInvoiceBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default SalesInvoicePDF;

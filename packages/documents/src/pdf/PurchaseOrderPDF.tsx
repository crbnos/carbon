import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { AccountsPayableBillingAddress, PDF } from "../types";
import { composeRegistrationLine } from "../utils/footer";
import type { PurchaseOrderData } from "./blocks/purchaseOrder";
import {
  buildPurchaseOrderVars,
  purchaseOrderBlockRegistry
} from "./blocks/purchaseOrder";
import { Template } from "./components";

interface PurchaseOrderPDFProps extends PDF {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  accountsPayableBillingAddress?: AccountsPayableBillingAddress | null;
  paymentTerms?: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
  /** Stored layout. When omitted, the default Purchase Order layout is used. */
  template?: DocumentTemplate | null;
  /** Shared sections referenced by the template, keyed by id. */
  sections?: Record<string, ResolvedSection>;
}

const PurchaseOrderPDF = ({
  accountsPayableBillingAddress,
  company,
  companySettings,
  meta,
  paymentTerms,
  purchaseOrder,
  purchaseOrderLines,
  purchaseOrderLocations,
  terms,
  thumbnails,
  locale,
  template,
  sections = {},
  title = "Purchase Order"
}: PurchaseOrderPDFProps) => {
  const currencyCode =
    purchaseOrder.currencyCode ?? company.baseCurrencyCode ?? "USD";
  const numberFormatter = new Intl.NumberFormat(locale, {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const registrationLine = composeRegistrationLine({
    companyName: company.name,
    country: purchaseOrderLocations.companyCountryName ?? company.countryCode,
    eori: company.eori
  });

  const headerTitle = purchaseOrder?.purchaseOrderId
    ? `${title}: ${purchaseOrder.purchaseOrderId}`
    : title;

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("purchaseOrder", template);

  const vars = buildPurchaseOrderVars({
    purchaseOrder,
    purchaseOrderLocations,
    company,
    currencyCode
  });

  const headerOptions = {
    ...DEFAULT_HEADER_OPTIONS,
    ...(headerSectionId ? (sections[headerSectionId]?.config ?? {}) : {})
  };

  const data: PurchaseOrderData = {
    company,
    companySettings,
    locale,
    purchaseOrder,
    purchaseOrderLines,
    purchaseOrderLocations,
    accountsPayableBillingAddress,
    paymentTerms: paymentTerms ?? [],
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
      title={headerTitle}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "purchase order",
        subject: meta?.subject ?? "Purchase Order"
      }}
      footerDocumentId={purchaseOrder?.purchaseOrderId}
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
        const render = purchaseOrderBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default PurchaseOrderPDF;

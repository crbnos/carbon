// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { resolveRegistrationLine } from "../utils/shared";
import type {
  PurchasingRfqAddress,
  PurchasingRfqData,
  PurchasingRfqPdfLine
} from "./blocks/purchasingRfq";
import {
  buildPurchasingRfqVars,
  purchasingRfqBlockRegistry
} from "./blocks/purchasingRfq";
import { Template } from "./components";

interface PurchasingRfqPDFProps extends PDF {
  purchasingRfq: Database["public"]["Views"]["purchasingRfqs"]["Row"];
  purchasingRfqLines: PurchasingRfqPdfLine[];
  /** The receiving location the supplier quotes delivery to. */
  shipToAddress?: PurchasingRfqAddress | null;
  /** Base64 thumbnails keyed by line id. */
  thumbnails?: Record<string, string | null>;
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  terms: JSONContent;
  /** Stored layout. When omitted, the default RFQ layout is used. */
  template?: DocumentTemplate | null;
  /** Shared sections referenced by the template, keyed by id. */
  sections?: Record<string, ResolvedSection>;
}

/**
 * A purchasing RFQ on paper: the lines and quantity breaks the supplier
 * prices, with blank Unit Price, Lead Time and Total cells to fill in.
 */
const PurchasingRfqPDF = ({
  company,
  companySettings,
  meta,
  purchasingRfq,
  purchasingRfqLines,
  shipToAddress,
  thumbnails,
  terms,
  locale,
  template,
  sections = {},
  title = "Request for Quote"
}: PurchasingRfqPDFProps) => {
  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("purchasingRfq", template);

  const vars = buildPurchasingRfqVars({
    purchasingRfq,
    shipToAddress,
    company
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

  const data: PurchasingRfqData = {
    company,
    companySettings,
    locale,
    purchasingRfq,
    purchasingRfqLines,
    shipToAddress,
    thumbnails,
    terms,
    theme,
    sections,
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
        keywords: meta?.keywords ?? "request for quote, rfq",
        subject: meta?.subject ?? "Request for Quote"
      }}
      footerDocumentId={purchasingRfq?.rfqId}
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
        const render = purchasingRfqBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default PurchasingRfqPDF;

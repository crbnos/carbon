// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { View } from "@react-pdf/renderer";
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
  PurchasingRfqContact,
  PurchasingRfqData,
  PurchasingRfqPdfLine
} from "./blocks/purchasingRfq";
import {
  buildPurchasingRfqVars,
  purchasingRfqBlockRegistry
} from "./blocks/purchasingRfq";
import { hasContent, resolveTerms } from "./blocks/resolveTerms";
import { Template } from "./components";

interface PurchasingRfqPDFProps extends PDF {
  purchasingRfq: Database["public"]["Views"]["purchasingRfqs"]["Row"];
  purchasingRfqLines: PurchasingRfqPdfLine[];
  /** The receiving location the supplier quotes delivery to. */
  shipToAddress?: PurchasingRfqAddress | null;
  /** The buyer the supplier answers; signs the letter. */
  contact?: PurchasingRfqContact | null;
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
 * A purchasing RFQ as a letter to the supplier: letterhead, the request, the
 * items and quantity breaks, a sign-off, then the terms. The supplier answers
 * with a quotation in their own format; the share page is the structured path.
 */
const PurchasingRfqPDF = ({
  company,
  companySettings,
  meta,
  purchasingRfq,
  purchasingRfqLines,
  shipToAddress,
  contact,
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
    contact,
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

  // Terms start on their own page, after the sign-off.
  const termsBlock = blocks.find((block) => block.type === "terms");
  const hasTerms =
    termsBlock?.type === "terms" &&
    hasContent(resolveTerms(termsBlock, terms, vars));

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
      {/* Letter margins: the page shell's are sized for dense documents.
          The fixed spacer holds the top margin on every page; each block gets
          its own side margins so a block's `break` still starts a page. */}
      <View fixed style={{ height: 18 }} />
      {visibleBlocks.map((block) => {
        const render = purchasingRfqBlockRegistry[block.type];
        if (!render) return null;
        return (
          <View
            key={block.id}
            break={block.type === "terms" && hasTerms}
            style={{ paddingHorizontal: 30 }}
          >
            {render({ block, data })}
          </View>
        );
      })}
    </Template>
  );
};

export default PurchasingRfqPDF;

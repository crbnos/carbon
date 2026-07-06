import type { Database } from "@carbon/database";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { PDF } from "../types";
import type { StockTransferData } from "./blocks/stockTransfer";
import {
  buildStockTransferVars,
  stockTransferBlockRegistry
} from "./blocks/stockTransfer";
import { Template } from "./components";

interface StockTransferPDFProps extends PDF {
  stockTransfer: Database["public"]["Tables"]["stockTransfer"]["Row"];
  stockTransferLines: Database["public"]["Views"]["stockTransferLines"]["Row"][];
  location: Database["public"]["Tables"]["location"]["Row"];
  thumbnails?: Record<string, string | null>;
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
}

const StockTransferPDF = ({
  company,
  stockTransfer,
  stockTransferLines,
  location,
  locale,
  thumbnails,
  template,
  sections = {},
  title = "Stock Transfer"
}: StockTransferPDFProps) => {
  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("stockTransfer", template);

  const vars = buildStockTransferVars({ stockTransfer, location, company });

  const headerOptions = {
    ...DEFAULT_HEADER_OPTIONS,
    ...(headerSectionId ? (sections[headerSectionId]?.config ?? {}) : {})
  };

  const data: StockTransferData = {
    company,
    locale,
    stockTransfer,
    stockTransferLines,
    location,
    thumbnails,
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
        author: "Carbon",
        keywords: "stock transfer",
        subject: "Stock Transfer"
      }}
      footerDocumentId={stockTransfer?.stockTransferId}
      showFooter={showFooter}
      showPageNumbers={settings.showPageNumbers}
      pageNumberFormat={settings.pageNumberFormat}
      showRegistrationLine={settings.showRegistrationLine}
      fontFamily={settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
    >
      {visibleBlocks.map((block) => {
        const render = stockTransferBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default StockTransferPDF;

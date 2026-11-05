// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  resolveTemplate,
  stockTransferTexts,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import { documentChrome } from "./blocks/documentChrome";
import type { StockTransferData } from "./blocks/stockTransfer";
import {
  buildStockTransferVars,
  stockTransferBlockRegistry
} from "./blocks/stockTransfer";
import { Template } from "./components";

interface StockTransferPDFProps extends PDF {
  valueCollector?: ValueCollector;
  stockTransfer: Database["public"]["Tables"]["stockTransfer"]["Row"];
  stockTransferLines: Database["public"]["Views"]["stockTransferLines"]["Row"][];
  location: Database["public"]["Tables"]["location"]["Row"];
  thumbnails?: Record<string, string | null>;
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
}

const StockTransferPDF = ({
  valueCollector,
  company,
  stockTransfer,
  stockTransferLines,
  location,
  locale,
  thumbnails,
  template,
  sections = {}
}: StockTransferPDFProps) => {
  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("stockTransfer", template);

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildStockTransferVars({
      stockTransfer,
      location,
      company,
      locale
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
    texts: stockTransferTexts.document,
    settings,
    vars,
    blocks,
    sections,
    headerSectionId,
    footerSectionId
  });

  const data: StockTransferData = {
    documentTitle,
    documentNumber,
    company,
    locale,
    stockTransfer,
    stockTransferLines,
    location,
    thumbnails,
    theme,
    sections,
    values,
    vars,
    headerOptions
  };

  return (
    <Template
      theme={theme}
      title={documentTitle}
      meta={{
        author: "Carbon",
        keywords: "stock transfer",
        subject: documentTitle
      }}
      footerDocumentId={stockTransfer?.stockTransferId}
      showFooter={showFooter}
      showPageNumbers={settings.showPageNumbers}
      pageNumberFormat={settings.pageNumberFormat}
      showRegistrationLine={settings.showRegistrationLine}
      fontFamily={settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
      footerText={footerText}
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

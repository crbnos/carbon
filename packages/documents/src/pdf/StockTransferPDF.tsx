// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  resolveTemplate,
  stockTransferTexts,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import { DocumentPage } from "./blocks/DocumentPage";
import { documentChrome } from "./blocks/documentChrome";
import type { StockTransferData } from "./blocks/stockTransfer";
import {
  buildStockTransferVars,
  stockTransferBlockRegistry
} from "./blocks/stockTransfer";

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
  const resolved = resolveTemplate("stockTransfer", template);
  const { theme, settings } = resolved;

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildStockTransferVars({
      stockTransfer,
      location,
      company,
      locale
    })
  );
  const chrome = documentChrome({
    texts: stockTransferTexts.document,
    template: resolved,
    vars,
    sections
  });
  const { documentTitle, documentNumber, headerOptions } = chrome;

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
    <DocumentPage
      chrome={chrome}
      template={resolved}
      keywords="stock transfer"
      footerDocumentId={stockTransfer?.stockTransferId}
      registry={stockTransferBlockRegistry}
      data={data}
    />
  );
};

export default StockTransferPDF;

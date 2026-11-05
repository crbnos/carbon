// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  purchaseReturnOrderTexts,
  resolveTemplate,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import {
  getMoneyFormatter,
  getRateFormatter,
  resolveRegistrationLine
} from "../utils/shared";
import { documentChrome } from "./blocks/documentChrome";
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
  valueCollector?: ValueCollector;
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
  valueCollector,
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
  sections = {}
}: PurchaseReturnOrderPDFProps) => {
  const currencyCode =
    purchaseReturnOrder.currencyCode ?? company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. The total row stays on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("purchaseReturnOrder", template);

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildPurchaseReturnOrderVars({
      purchaseReturnOrder,
      purchaseReturnOrderLines,
      supplierAddress,
      shipFromAddress,
      company,
      currencyCode,
      locale,
      numberFormatter
    })
  );
  const {
    dt,
    documentTitle,
    documentNumber,
    footerText,
    headerOptions,
    headerContent,
    footerContent,
    showFooter,
    visibleBlocks
  } = documentChrome({
    texts: purchaseReturnOrderTexts.document,
    settings,
    vars,
    blocks,
    sections,
    headerSectionId,
    footerSectionId
  });

  const registration = resolveRegistrationLine({
    company,
    footerSectionId,
    sections,
    settings,
    vars
  });

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
    values,
    vars,
    headerOptions,
    documentTitle,
    documentNumber,
    supplierRmaLine: dt.prints("supplierRmaNumber")
      ? dt("supplierRmaNumber")
      : undefined
  };

  return (
    <Template
      theme={theme}
      title={documentTitle}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "supplier return, purchase return order",
        subject: meta?.subject ?? documentTitle
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
      footerText={footerText}
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

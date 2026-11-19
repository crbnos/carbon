// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
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
import { DocumentPage } from "./blocks/DocumentPage";
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

  const resolved = resolveTemplate("purchaseReturnOrder", template);
  const { theme, settings, footerSectionId } = resolved;

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
  const chrome = documentChrome({
    texts: purchaseReturnOrderTexts.document,
    template: resolved,
    vars,
    sections
  });
  const { dt, documentTitle, documentNumber, headerOptions } = chrome;

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
    <DocumentPage
      chrome={chrome}
      template={resolved}
      meta={meta}
      keywords="supplier return, purchase return order"
      footerDocumentId={purchaseReturnOrder?.purchaseReturnOrderId}
      footerLabel={registration.label}
      showRegistrationLine={registration.show}
      registry={purchaseReturnOrderBlockRegistry}
      data={data}
    />
  );
};

export default PurchaseReturnOrderPDF;

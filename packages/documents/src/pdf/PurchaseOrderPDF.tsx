// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  purchaseOrderTexts,
  resolveTemplate,
  type ValueCollector
} from "../template";
import type { AccountsPayableBillingAddress, PDF } from "../types";
import { getPurchaseOrderDisplayId } from "../utils/purchase-order";
import {
  getMoneyFormatter,
  getRateFormatter,
  resolveRegistrationLine
} from "../utils/shared";
import { DocumentPage } from "./blocks/DocumentPage";
import { documentChrome } from "./blocks/documentChrome";
import type {
  PurchaseOrderApproval,
  PurchaseOrderData
} from "./blocks/purchaseOrder";
import {
  buildPurchaseOrderVars,
  purchaseOrderBlockRegistry
} from "./blocks/purchaseOrder";

interface PurchaseOrderPDFProps extends PDF {
  valueCollector?: ValueCollector;
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
  /** Settlement decimals from the document currency's row; null/omitted falls back to 2. */
  currencyDecimals?: number | null;
  /** The approval that released the order; null when it was not approved. */
  approval?: PurchaseOrderApproval | null;
}

const PurchaseOrderPDF = ({
  valueCollector,
  accountsPayableBillingAddress,
  approval,
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
  currencyDecimals,
  template,
  sections = {}
}: PurchaseOrderPDFProps) => {
  const currencyCode =
    purchaseOrder.currencyCode ?? company.baseCurrencyCode ?? "USD";
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);
  // The unit-price COLUMN is a rate, not a settlement amount — see
  // getRateFormatter. Totals/tax/shipping stay on numberFormatter.
  const rateFormatter = getRateFormatter(locale, currencyDecimals);

  const displayId = purchaseOrder
    ? getPurchaseOrderDisplayId(purchaseOrder)
    : "";

  const resolved = resolveTemplate("purchaseOrder", template);
  const { theme, settings, footerSectionId } = resolved;

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildPurchaseOrderVars({
      purchaseOrder,
      purchaseOrderLines,
      purchaseOrderLocations,
      company,
      currencyCode,
      approval,
      locale,
      paymentTerms: paymentTerms ?? [],
      accountsPayableBillingAddress,
      numberFormatter
    })
  );
  const chrome = documentChrome({
    texts: purchaseOrderTexts.document,
    template: resolved,
    vars,
    sections
  });
  const { documentTitle, documentNumber, headerOptions } = chrome;
  const headerTitle = displayId
    ? `${documentTitle}: ${displayId}`
    : documentTitle;

  const registration = resolveRegistrationLine({
    company,
    footerSectionId,
    sections,
    settings,
    vars
  });

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
    approval,
    numberFormatter,
    rateFormatter,
    values,
    vars,
    headerOptions,
    documentTitle,
    documentNumber
  };

  return (
    <DocumentPage
      chrome={chrome}
      template={resolved}
      meta={meta}
      keywords="purchase order"
      title={headerTitle}
      footerDocumentId={displayId || undefined}
      footerLabel={registration.label}
      showRegistrationLine={registration.show}
      registry={purchaseOrderBlockRegistry}
      data={data}
    />
  );
};

export default PurchaseOrderPDF;

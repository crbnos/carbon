// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  DocumentValues,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company, CompanySettings } from "../../../types";
import type { ReturnOrderAddress } from "../returnOrder/vars";

/**
 * A line row as the RMA PDF route reads it: the table row plus the joined
 * return-reason and item names. Join fields are widened (nullable) so the
 * supabase-inferred select type stays assignable.
 */
export type SalesReturnOrderPdfLine =
  Database["public"]["Tables"]["salesReturnOrderLine"]["Row"] & {
    returnReason?: { name: string | null } | null;
    item?: {
      name: string | null;
      readableIdWithRevision: string | null;
      itemTrackingType?: string | null;
    } | null;
  };

export type { ReturnOrderAddress };

/** Everything a Sales Return Order (RMA) block renderer might need. */
export interface SalesReturnOrderData {
  company: Company;
  companySettings?: CompanySettings | null;
  locale: string;
  salesReturnOrder: Database["public"]["Views"]["salesReturnOrders"]["Row"];
  salesReturnOrderLines: SalesReturnOrderPdfLine[];
  /** Company location the goods return to (the header's `locationId`). */
  returnToAddress?: ReturnOrderAddress | null;
  /** The returning customer (name + address). */
  customerAddress?: ReturnOrderAddress | null;
  terms: JSONContent;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  currencyCode: string | null;
  numberFormatter: Intl.NumberFormat;
  /** Unit-price COLUMN only — a rate, not a settlement amount. */
  rateFormatter: Intl.NumberFormat;
  vars: Record<string, string>;
  values: DocumentValues;
  headerOptions: HeaderOptions;
  /** The printed document title, from the template's document texts. */
  documentTitle: string;
  /** The printed document number; absent when the user hid it. */
  documentNumber?: string;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: SalesReturnOrderData;
}) => JSX.Element | null;

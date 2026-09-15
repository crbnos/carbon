import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company, CompanySettings } from "../../../types";

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

/**
 * A party/address for the parties block. Pass a resolved display `country`
 * ("United States") when known; renderers fall back to mapping `countryCode`.
 */
export interface ReturnOrderAddress {
  name?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

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
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: SalesReturnOrderData;
}) => JSX.Element | null;

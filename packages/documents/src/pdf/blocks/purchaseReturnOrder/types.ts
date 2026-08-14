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
 * A line row as the supplier-return PDF route reads it: the table row plus the
 * joined return-reason and item names. Join fields are widened (nullable) so
 * the supabase-inferred select type stays assignable.
 */
export type PurchaseReturnOrderPdfLine =
  Database["public"]["Tables"]["purchaseReturnOrderLine"]["Row"] & {
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

/** Everything a Purchase Return Order block renderer might need. */
export interface PurchaseReturnOrderData {
  company: Company;
  companySettings?: CompanySettings | null;
  locale: string;
  purchaseReturnOrder: Database["public"]["Views"]["purchaseReturnOrders"]["Row"];
  purchaseReturnOrderLines: PurchaseReturnOrderPdfLine[];
  /** Company location the goods ship back from (the header's `locationId`). */
  shipFromAddress?: ReturnOrderAddress | null;
  /** The supplier the goods return to (name + ship-to address). */
  supplierAddress?: ReturnOrderAddress | null;
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
  data: PurchaseReturnOrderData;
}) => JSX.Element | null;

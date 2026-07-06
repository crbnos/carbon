import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../template";
import type {
  AccountsReceivableBillingAddress,
  Company,
  CompanySettings
} from "../../types";

export type SalesInvoiceLocations =
  Database["public"]["Views"]["salesInvoiceLocations"]["Row"] & {
    customerTaxId?: string | null;
    customerVatNumber?: string | null;
  };

/**
 * Everything a Sales Invoice block renderer might need. Built-in blocks read
 * from this; the driver builds it once and hands the same object to every
 * block, so there is no per-section prop drilling.
 */
export interface SalesInvoiceData {
  company: Company;
  companySettings?: CompanySettings | null;
  locale: string;
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"];
  salesInvoiceLines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][];
  salesInvoiceLocations: SalesInvoiceLocations;
  salesInvoiceShipment: Database["public"]["Tables"]["salesInvoiceShipment"]["Row"];
  salesOrderIds?: string[];
  accountsReceivableBillingAddress?: AccountsReceivableBillingAddress | null;
  paymentTerms: { id: string; name: string }[];
  shippingMethods: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
  /** Customizable color palette for the document. */
  theme: DocumentTheme;
  /** Resolved shared sections referenced by `shared` blocks, keyed by id. */
  sections: Record<string, ResolvedSection>;
  /** Precomputed display helpers (built once in the driver). */
  currencyCode: string | null;
  numberFormatter: Intl.NumberFormat;
  /** Merge-field values, keyed by token (e.g. `invoice.number`). */
  vars: Record<string, string>;
  /** Resolved header layout (from the global header section's config). */
  headerOptions: HeaderOptions;
}

/**
 * A block renderer is a pure function of the (block, data) pair. Built-in
 * renderers ignore `block` beyond its identity; extension renderers narrow
 * `block` by its `type` discriminant.
 */
export type BlockRenderer<D> = (args: {
  block: DocumentBlock;
  data: D;
}) => JSX.Element | null;

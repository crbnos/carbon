import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions
} from "../../../template";
import type {
  AccountsReceivableBillingAddress,
  Company,
  CompanySettings
} from "../../../types";

export type SalesOrderLocations =
  Database["public"]["Views"]["salesOrderLocations"]["Row"] & {
    customerTaxId?: string | null;
    customerVatNumber?: string | null;
  };

/** Everything a Sales Order block renderer might need. Mirrors SalesInvoiceData. */
export interface SalesOrderData {
  company: Company;
  companySettings?: CompanySettings | null;
  locale: string;
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"];
  salesOrderLines: Database["public"]["Views"]["salesOrderLines"]["Row"][];
  salesOrderLocations: SalesOrderLocations;
  accountsReceivableBillingAddress?: AccountsReceivableBillingAddress | null;
  paymentTerms: { id: string; name: string }[];
  shippingMethods: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
  theme: DocumentTheme;
  sections: Record<string, import("../../../template").ResolvedSection>;
  currencyCode: string | null;
  numberFormatter: Intl.NumberFormat;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: SalesOrderData;
}) => JSX.Element | null;

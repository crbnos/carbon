import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type {
  AccountsPayableBillingAddress,
  Company,
  CompanySettings
} from "../../../types";

/** Everything a Purchase Order block renderer might need. */
export interface PurchaseOrderData {
  company: Company;
  companySettings?: CompanySettings | null;
  locale: string;
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
  accountsPayableBillingAddress?: AccountsPayableBillingAddress | null;
  paymentTerms: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  currencyCode: string | null;
  numberFormatter: Intl.NumberFormat;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: PurchaseOrderData;
}) => JSX.Element | null;

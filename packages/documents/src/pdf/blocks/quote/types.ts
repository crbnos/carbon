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

export type QuoteCustomerDetails =
  Database["public"]["Views"]["quoteCustomerDetails"]["Row"] & {
    customerTaxId?: string | null;
    customerVatNumber?: string | null;
  };

type QuoteLinePrice = Database["public"]["Tables"]["quoteLinePrice"]["Row"];

export interface QuoteTotals {
  subtotal: number;
  shipping: number;
  fees: number;
  taxes: number;
  total: number;
}

/** Everything a Quote block renderer needs, incl. precomputed derived values. */
export interface QuoteData {
  company: Company;
  companySettings?: CompanySettings | null;
  locale: string;
  quote: Database["public"]["Views"]["quotes"]["Row"];
  quoteLines: Database["public"]["Views"]["quoteLines"]["Row"][];
  quoteLinePrices: QuoteLinePrice[];
  /** The day this prints, `YYYY-MM-DD`, in the company's time zone. */
  printDate: string;
  quoteCustomerDetails: QuoteCustomerDetails;
  payment?: Database["public"]["Tables"]["quotePayment"]["Row"] | null;
  shipment?: Database["public"]["Tables"]["quoteShipment"]["Row"] | null;
  paymentTerms: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
  exchangeRate: number;
  shouldConvertCurrency: boolean;
  // Derived (built once in the driver):
  pricesByLine: Record<string, QuoteLinePrice[]>;
  hasSinglePricePerLine: boolean;
  hasAnyLeadTime: boolean;
  maxLeadTime: number;
  totals: QuoteTotals;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  currencyCode: string | null;
  numberFormatter: Intl.NumberFormat;
  vars: Record<string, string>;
  values: DocumentValues;
  headerOptions: HeaderOptions;
  /** The printed document title, from the template's document texts. */
  documentTitle: string;
  /** The printed document number, from the template's document texts. */
  documentNumber?: string;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: QuoteData;
}) => JSX.Element | null;

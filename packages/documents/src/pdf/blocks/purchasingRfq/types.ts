// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentTheme,
  HeaderOptions,
  ResolvedSection
} from "../../../template";
import type { Company, CompanySettings } from "../../../types";

export type PurchasingRfqPdfLine =
  Database["public"]["Views"]["purchasingRfqLines"]["Row"];

/**
 * A party/address for the parties block. Pass a resolved display `country`
 * when known; renderers fall back to mapping `countryCode`.
 */
export interface PurchasingRfqAddress {
  name?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

/** The buyer a supplier sends the quotation to; signs the letter. */
export interface PurchasingRfqContact {
  name?: string | null;
  email?: string | null;
}

/** Everything a purchasing RFQ block renderer might need. */
export interface PurchasingRfqData {
  company: Company;
  companySettings?: CompanySettings | null;
  locale: string;
  purchasingRfq: Database["public"]["Views"]["purchasingRfqs"]["Row"];
  purchasingRfqLines: PurchasingRfqPdfLine[];
  /** The receiving location the supplier quotes delivery to. */
  shipToAddress?: PurchasingRfqAddress | null;
  contact?: PurchasingRfqContact | null;
  /** Base64 thumbnails keyed by line id. */
  thumbnails?: Record<string, string | null>;
  terms: JSONContent;
  theme: DocumentTheme;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
  headerOptions: HeaderOptions;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: PurchasingRfqData;
}) => JSX.Element | null;

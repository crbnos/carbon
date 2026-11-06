// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { interpolateString, tokensAllEmpty } from "../merge";
import type { DocumentTemplateType } from "../schema";
import { issueTexts } from "./issue";
import { jobTravelerTexts } from "./jobTraveler";
import { packingSlipTexts } from "./packingSlip";
import { purchaseOrderTexts } from "./purchaseOrder";
import { purchaseReturnOrderTexts } from "./purchaseReturnOrder";
import { purchasingRfqTexts } from "./purchasingRfq";
import { quoteTexts } from "./quote";
import { salesInvoiceTexts } from "./salesInvoice";
import { salesOrderTexts } from "./salesOrder";
import { salesReturnOrderTexts } from "./salesReturnOrder";
import { stockTransferTexts } from "./stockTransfer";
import { trackingLabelTexts } from "./trackingLabel";
import type { DocumentTextCatalog, TextCatalog, TextEntry } from "./types";
import { HIDEABLE_KINDS } from "./types";

export * from "./issue";
export * from "./jobTraveler";
export * from "./packingSlip";
export * from "./purchaseOrder";
export * from "./purchaseReturnOrder";
export * from "./purchasingRfq";
export * from "./quote";
export * from "./salesInvoice";
export * from "./salesOrder";
export * from "./salesReturnOrder";
export * from "./shared";
export * from "./stockTransfer";
export * from "./trackingLabel";
export * from "./types";

/** The part of a block (or of the settings) that holds the user's text changes. */
type StoredText = { text?: Record<string, string>; hidden?: string[] };

export type TextFn<K extends string> = ((
  key: K,
  rowVars?: Record<string, string>
) => string) & {
  /** False when the user hid this field or column. */
  shows: (key: K) => boolean;
  /**
   * False when this row has nothing to print: the user hid it or the row it
   * belongs to (`of`), it is empty, or every variable in it is empty (no "Reference:" on an order without one).
   */
  prints: (key: K, rowVars?: Record<string, string>) => boolean;
};

/**
 * The printed text for each key of `entries`: the user's text, else the
 * default, with `{variables}` filled. An empty string is a real value and
 * prints nothing. `rowVars` adds the variables of one table row.
 */
export function makeText<E extends readonly TextEntry[]>(
  entries: E,
  stored: StoredText | undefined,
  vars: Record<string, string>
): TextFn<E[number]["key"]> {
  const defaults = new Map<string, string>(
    entries.map((entry) => [entry.key, entry.default])
  );
  const owners = new Map(entries.map((entry) => [entry.key, entry.of]));
  const rawText = (key: string) =>
    stored?.text?.[key] ?? defaults.get(key) ?? "";
  const fn = ((key: string, rowVars?: Record<string, string>) => {
    const filled = rowVars ? { ...vars, ...rowVars } : vars;
    // A table cell has no `prints` check of its own: an edited "Qty: {qty}"
    // prints nothing on a row with no quantity, such as a comment line.
    if (rowVars && tokensAllEmpty(rawText(key), filled)) return "";
    return interpolateString(rawText(key), filled).trim();
  }) as TextFn<E[number]["key"]>;
  fn.shows = (key) => !(stored?.hidden ?? []).includes(key);
  fn.prints = (key, rowVars) =>
    fn.shows(key) &&
    fn.shows(owners.get(key) ?? key) &&
    fn(key, rowVars) !== "" &&
    !tokensAllEmpty(rawText(key), rowVars ? { ...vars, ...rowVars } : vars);
  return fn;
}

export const TEXT_CATALOG: TextCatalog = {
  salesInvoice: salesInvoiceTexts,
  salesOrder: salesOrderTexts,
  salesReturnOrder: salesReturnOrderTexts,
  purchaseOrder: purchaseOrderTexts,
  purchaseReturnOrder: purchaseReturnOrderTexts,
  purchasingRfq: purchasingRfqTexts,
  quote: quoteTexts,
  packingSlip: packingSlipTexts,
  stockTransfer: stockTransferTexts,
  jobTraveler: jobTravelerTexts,
  issue: issueTexts,
  trackingLabel: trackingLabelTexts
};

/** The text entries of one block type (or "document") of one document type. */
export function getTextEntries(
  documentType: DocumentTemplateType,
  blockType: keyof DocumentTextCatalog
): readonly TextEntry[] {
  return TEXT_CATALOG[documentType]?.[blockType] ?? [];
}

/** The document texts that print in the header; the footer panel has the rest. */
export const HEADER_TEXT_KEYS = [
  "title",
  "rentalTitle",
  "receivingReportTitle",
  "documentNumber",
  "salesOrderPrefix",
  "supplierRmaNumber"
];

/** The document texts the footer's own line prints. */
export const FOOTER_LINE_TEXT_KEYS = ["page", "of", "issueNumber"];

export function isHideable(entry: TextEntry): boolean {
  return HIDEABLE_KINDS.includes(entry.kind);
}

export * from "./validate";

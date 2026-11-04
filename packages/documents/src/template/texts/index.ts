// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { interpolateString } from "../merge";
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

export type TextFn<K extends string> = ((key: K) => string) & {
  /** False when the user hid this field or column. */
  shows: (key: K) => boolean;
};

/**
 * The printed text for each key of `entries`: the user's text, else the
 * default, with `{variables}` filled. An empty string is a real value and
 * prints nothing.
 */
export function makeText<E extends readonly TextEntry[]>(
  entries: E,
  stored: StoredText | undefined,
  vars: Record<string, string>
): TextFn<E[number]["key"]> {
  const defaults = new Map<string, string>(
    entries.map((entry) => [entry.key, entry.default])
  );
  const fn = ((key: string) => {
    const raw = stored?.text?.[key] ?? defaults.get(key) ?? "";
    return interpolateString(raw, vars);
  }) as TextFn<E[number]["key"]>;
  fn.shows = (key) => !(stored?.hidden ?? []).includes(key);
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

export function isHideable(entry: TextEntry): boolean {
  return HIDEABLE_KINDS.includes(entry.kind);
}

export * from "./validate";

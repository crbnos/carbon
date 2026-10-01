// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { StockTransferData } from "./types";

/** Merge-field variable map for a Stock Transfer. */
export function buildStockTransferVars(
  data: Pick<StockTransferData, "stockTransfer" | "location" | "company">
): Record<string, string> {
  const t = data.stockTransfer;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "transfer.number": str(t?.stockTransferId),
    "transfer.location": str(data.location?.name),
    "transfer.assignee": str(t?.assignee),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode)
  };
}

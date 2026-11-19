// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import type { LineMergeToken, MergeToken } from "../../../template";
import { str } from "../textVars";
import type { StockTransferData } from "./types";

/** Merge-field variable map for a Stock Transfer. */
export function buildStockTransferVars(
  data: Pick<
    StockTransferData,
    "stockTransfer" | "location" | "company" | "locale"
  >
): Record<MergeToken<"stockTransfer">, string> {
  const t = data.stockTransfer;
  const c = data.company;

  return {
    "transfer.number": str(t?.stockTransferId),
    "transfer.location": str(data.location?.name),
    "transfer.assignee": str(t?.assignee),
    "transfer.date": formatDate(t?.createdAt, undefined, data.locale),
    "company.name": str(c?.name),
    "company.addressLine1": str(c?.addressLine1),
    "company.addressLine2": str(c?.addressLine2),
    "company.city": str(c?.city),
    "company.statePostal": [c?.stateProvince, c?.postalCode]
      .filter(Boolean)
      .join(" "),
    "company.country": str(c?.countryCode),
    "company.phone": str(c?.phone),
    "company.email": str(c?.email),
    "company.website": str(c?.website)
  };
}

/**
 * `anyLabel` is the block's text for a line
 * with no storage unit on one side.
 */
export function buildStockTransferLineVars(
  line: StockTransferData["stockTransferLines"][number],
  rowNumber: number,
  anyLabel: string
): Record<LineMergeToken<"stockTransfer">, string> {
  return {
    "line.number": String(rowNumber),
    "line.description": str(line.itemDescription),
    "line.itemId": str(line.itemReadableId),
    "line.from": line.fromStorageUnitName || anyLabel,
    "line.to": line.toStorageUnitName || anyLabel,
    "line.quantity": str(line.quantity),
    "line.unit": str(line.unitOfMeasure)
  };
}

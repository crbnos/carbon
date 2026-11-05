// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { distinctItemText } from "@carbon/utils";
import type { RowVars } from "../../../template";
import { str } from "../textVars";

/** A return order's line, as both sides of a return read it. */
export interface ReturnOrderLine {
  id?: string | null;
  lineNumber?: number | null;
  quantity?: number | null;
  unitOfMeasureCode?: string | null;
  unitPrice?: number | null;
  item?: {
    name: string | null;
    readableIdWithRevision: string | null;
  } | null;
  returnReason?: { name: string | null } | null;
}

export function buildReturnOrderLineVars(
  line: ReturnOrderLine,
  rateFormatter: Intl.NumberFormat
): RowVars<"salesReturnOrder", "line"> {
  const itemId = line.item?.readableIdWithRevision;
  return {
    "line.number": str(line.lineNumber),
    "line.itemId": str(itemId),
    "line.itemName": str(distinctItemText(itemId, line.item?.name)),
    "line.quantity": str(line.quantity ?? 0),
    "line.unit": line.unitOfMeasureCode ?? "EA",
    "line.unitPrice": rateFormatter.format(line.unitPrice ?? 0),
    "line.reason": str(line.returnReason?.name)
  };
}

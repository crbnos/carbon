// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { distinctItemText } from "@carbon/utils";
import {
  formatPartNumber,
  type PartNumberDisplay,
  resolvePartNumberDisplay
} from "./part-number";
import { withRevisionSuffix } from "./revision";

/**
 * A PO line's title in the purchase order email: the asset name, the
 * description for G/L Account and Comment lines, else the line's part numbers
 * per its display choice.
 */
export function getLineDescription(
  line: Database["public"]["Views"]["purchaseOrderLines"]["Row"]
) {
  switch (line?.purchaseOrderLineType) {
    case "Fixed Asset":
      return line?.assetName ?? "Fixed Asset";
    case "G/L Account":
      return line?.description;
    case "Comment":
      return line?.description;
    default:
      return getLinePartNumber(
        line,
        resolvePartNumberDisplay("purchaseOrderEmail", line?.partNumberDisplay)
      );
  }
}

/**
 * A PO line's part numbers for one display choice: our item ID (with its
 * revision) and the supplier's number, which carries no revision.
 */
export function getLinePartNumber(
  line: Database["public"]["Views"]["purchaseOrderLines"]["Row"],
  display: PartNumberDisplay
) {
  return formatPartNumber(
    { ours: line?.itemReadableId, theirs: getLineSupplierPartId(line, null) },
    display
  );
}

/**
 * The supplier's part number for a PO line: the line's own number, else the
 * supplier part record's. Null when both are blank, or when it repeats
 * `shownId`, the identifier the document already prints for the line. That is
 * the item ID unless the caller passes another one: a Service line on the PDF
 * prints its description instead.
 */
export function getLineSupplierPartId(
  line: Database["public"]["Views"]["purchaseOrderLines"]["Row"],
  shownId: string | null | undefined = line?.itemReadableId
) {
  // Use `||` (not `??`) so an empty-string supplier part number falls
  // through. Supplier parts with no part number get backfilled onto the
  // line as "", and `??` would print a blank number.
  const supplierPartId =
    line?.supplierPartId?.trim() || line?.supplierPartIdFromSupplier?.trim();
  if (!supplierPartId || supplierPartId === shownId?.trim()) return null;
  return supplierPartId;
}

export function getLineDescriptionDetails(
  line: Database["public"]["Views"]["purchaseOrderLines"]["Row"]
) {
  switch (line?.purchaseOrderLineType) {
    case "Fixed Asset":
      return line?.description;
    case "G/L Account":
      return line.accountName
        ? `G/L Account: ${line.accountName}`
        : "G/L Account";
    case "Comment":
    default:
      // A service's readable id is its name — don't print it twice.
      return [
        distinctItemText(line?.itemReadableId, line?.description),
        line?.itemDescription
      ]
        .filter(Boolean)
        .join("\n");
  }
}

export function getLineTotal(
  line: Database["public"]["Views"]["purchaseOrderLines"]["Row"]
) {
  return (
    (line?.purchaseQuantity ?? 0) * (line?.supplierUnitPrice ?? 0) +
    (line?.supplierShippingCost ?? 0) +
    (line?.supplierTaxAmount ?? 0)
  );
}

export function getTotal(
  lines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][]
) {
  return lines.reduce((total, line) => total + getLineTotal(line), 0);
}

export function getPurchaseOrderDisplayId(
  purchaseOrder?: {
    purchaseOrderId?: string | null;
    revisionId?: number | null;
  } | null
) {
  return withRevisionSuffix(
    purchaseOrder?.purchaseOrderId,
    purchaseOrder?.revisionId
  );
}

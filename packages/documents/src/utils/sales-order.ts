// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { distinctItemText } from "@carbon/utils";
import {
  formatPartNumber,
  lineCustomerPart,
  type PartNumberDisplay,
  resolvePartNumberDisplay
} from "./part-number";

/**
 * A sales order line's title: the asset for a Fixed Asset line, the
 * description for a Comment line, else the line's part numbers per its display
 * choice. `draft` is the Edit document modal's unsaved pick.
 */
export function getLineDescription(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"],
  draft?: PartNumberDisplay
) {
  switch (line?.salesOrderLineType) {
    case "Fixed Asset":
      return (
        (line as any)?.assetReadableId ??
        (line as any)?.assetName ??
        "Fixed Asset"
      );
    case "Comment":
      return line?.description;
    default: {
      const customerPart = lineCustomerPart(line);
      return formatPartNumber(
        {
          ours: line?.itemReadableId,
          theirs: customerPart.id,
          theirsRevision: customerPart.revision
        },
        resolvePartNumberDisplay("salesOrder", draft ?? line?.partNumberDisplay)
      );
    }
  }
}

export function getLineDescriptionDetails(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  switch (line?.salesOrderLineType) {
    case "Fixed Asset":
      return line?.description;
    case "Comment":
    default:
      // A service's readable id is its name — don't print it twice. The
      // customer part number prints in the title only.
      return distinctItemText(line?.itemReadableId, line?.description) ?? "";
  }
}

export function getLineSubtotal(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  return (
    (line?.saleQuantity ?? 0) * (line?.convertedUnitPrice ?? 0) +
    (line?.convertedAddOnCost ?? 0) +
    (line?.convertedNonTaxableAddOnCost ?? 0) +
    (line?.convertedShippingCost ?? 0)
  );
}

export function getLineTaxableSubtotal(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  return (
    (line?.saleQuantity ?? 0) * (line?.convertedUnitPrice ?? 0) +
    (line?.convertedAddOnCost ?? 0) +
    (line?.convertedShippingCost ?? 0)
  );
}

export function getLineTaxesAndFees(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  const taxPercent = line.taxPercent ?? 0;
  const tax = getLineTaxableSubtotal(line) * taxPercent;
  const fees =
    (line.convertedAddOnCost ?? 0) +
    (line.convertedNonTaxableAddOnCost ?? 0) +
    (line.convertedShippingCost ?? 0);
  return tax + fees;
}

export function getLineTotal(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  const taxPercent = line.taxPercent ?? 0;
  const tax = getLineTaxableSubtotal(line) * taxPercent;
  return getLineSubtotal(line) + tax;
}

export function getTotal(
  lines: Database["public"]["Views"]["salesOrderLines"]["Row"][],
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"]
) {
  let total = 0;

  lines.forEach((line) => {
    total += getLineTotal(line);
  });

  return (
    total + (salesOrder.shippingCost ?? 0) * (salesOrder.exchangeRate ?? 1)
  );
}

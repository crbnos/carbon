// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { distinctItemText } from "@carbon/utils";
import { formatLinePartNumber, type PartNumberDisplay } from "./part-number";

type LineCustomerPart = { id: string | null; revision: string | null };

/**
 * A sales order line's customer part: its own copy, else the live
 * cross-reference (`customerPartToItem`). The pair stays together, so a copy's
 * number never prints with the cross-reference's revision.
 */
export function lineCustomerPart(line: {
  customerPartId?: string | null;
  customerPartRevision?: string | null;
  customerPartIdFromCustomer?: string | null;
  customerPartRevisionFromCustomer?: string | null;
}): LineCustomerPart {
  return line.customerPartId?.trim()
    ? { id: line.customerPartId, revision: line.customerPartRevision ?? null }
    : {
        id: line.customerPartIdFromCustomer ?? null,
        revision: line.customerPartRevisionFromCustomer ?? null
      };
}

/**
 * A sales order line's title: the asset for a Fixed Asset line, the
 * description for a Comment line, else the line's part numbers per its display
 * choice. `draft` is the Edit document modal's unsaved pick; `customerPart` is
 * the line's `lineCustomerPart`, when the caller has it already.
 */
export function getLineDescription(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"],
  draft?: PartNumberDisplay,
  customerPart?: LineCustomerPart
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
      const part = customerPart ?? lineCustomerPart(line);
      return formatLinePartNumber(
        "salesOrder",
        {
          ours: line?.itemReadableId,
          theirs: part.id,
          theirsRevision: part.revision
        },
        line?.partNumberDisplay,
        draft
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

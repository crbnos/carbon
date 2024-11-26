import type { Database } from "@carbon/database";

export function getLineDescription(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  switch (line?.salesOrderLineType) {
    case "Fixed Asset":
      return line?.assetId;
    case "Comment":
      return line?.description;
    default:
      let customerPartNumber = line.customerPartId
        ? ` (${line.customerPartId}${
            line.customerPartRevision ? ` Rev ${line.customerPartRevision}` : ""
          })`
        : "";

      return line?.itemReadableId + customerPartNumber;
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
      const itemDescription = line?.customerPartId
        ? `\n${line.customerPartId}${
            line.customerPartRevision ? ` Rev ${line.customerPartRevision}` : ""
          }`
        : "";
      return (line?.description ?? "") + itemDescription;
  }
}

export function getLineSubtotal(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  if (line?.saleQuantity && line?.convertedUnitPrice) {
    return (
      line.saleQuantity * line.convertedUnitPrice +
      (line.convertedAddOnCost ?? 0) +
      (line.convertedShippingCost ?? 0)
    );
  }
  return 0;
}

export function getLineTotal(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  const taxPercent = line.taxPercent ?? 0;
  const tax = getLineSubtotal(line) * taxPercent;
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

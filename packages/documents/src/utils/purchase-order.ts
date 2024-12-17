import type { Database } from "@carbon/database";

export function getLineDescription(
  line: Database["public"]["Views"]["purchaseOrderLines"]["Row"]
) {
  switch (line?.purchaseOrderLineType) {
    case "Fixed Asset":
      return line?.assetId;
    case "G/L Account":
    case "Comment":
      return line?.description;
    default:
      const supplierPartNumber = line.supplierPartId
        ? ` (${line.supplierPartId})`
        : "";
      return line?.itemReadableId + supplierPartNumber;
  }
}

export function getLineDescriptionDetails(
  line: Database["public"]["Views"]["purchaseOrderLines"]["Row"]
) {
  switch (line?.purchaseOrderLineType) {
    case "Fixed Asset":
      return line?.description;
    case "G/L Account":
      return `G/L Account: ${line?.accountNumber}`;
    case "Comment":
    default:
      const itemDescription = line?.itemDescription
        ? `\n${line.itemDescription}`
        : "";
      return line?.description + itemDescription;
  }
}

export function getLineTotal(
  line: Database["public"]["Views"]["purchaseOrderLines"]["Row"]
) {
  if (line?.purchaseQuantity && line?.supplierUnitPrice) {
    return (
      line.purchaseQuantity * line.supplierUnitPrice +
      (line.supplierShippingCost ?? 0) +
      (line.supplierTaxAmount ?? 0)
    );
  }

  return 0;
}

export function getTotal(
  lines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][]
) {
  let total = 0;

  lines.forEach((line) => {
    if (line?.purchaseQuantity && line?.supplierUnitPrice) {
      total +=
        line.purchaseQuantity * line.supplierUnitPrice +
        (line?.supplierShippingCost ?? 0) +
        (line?.supplierTaxAmount ?? 0);
    }
  });

  return total;
}

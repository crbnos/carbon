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
      return line?.itemId + supplierPartNumber;
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
  if (line?.purchaseQuantity && line?.unitPrice) {
    return line.purchaseQuantity * line.unitPrice;
  }

  return 0;
}

export function getTotal(
  lines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][]
) {
  let total = 0;

  lines.forEach((line) => {
    if (line?.purchaseQuantity && line?.unitPrice) {
      total += line.purchaseQuantity * line.unitPrice;
    }
  });

  return total;
}

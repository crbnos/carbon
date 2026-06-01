import type { Database } from "@carbon/database";

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
      return (
        line?.supplierPartId ??
        line?.supplierPartIdFromSupplier ??
        line?.itemReadableId
      );
  }
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

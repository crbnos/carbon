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

export function getLineTotal(
  line: Database["public"]["Views"]["salesOrderLines"]["Row"]
) {
  if (line?.saleQuantity && line?.unitPrice) {
    return line.saleQuantity * (line.unitPrice + (line.addOnCost ?? 0));
  }

  return 0;
}

export function getTotal(
  lines: Database["public"]["Views"]["salesOrderLines"]["Row"][]
) {
  let total = 0;

  lines.forEach((line) => {
    if (line?.saleQuantity && line?.unitPrice) {
      total += line.saleQuantity * (line.unitPrice + (line.addOnCost ?? 0));
    }
  });

  return total;
}

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
  line: Database["public"]["Views"]["salesOrderLines"]["Row"],
  shouldConvertCurrency: boolean
) {
  if (shouldConvertCurrency) {
    if (line?.saleQuantity && line?.convertedUnitPrice) {
      return (
        line.saleQuantity * line.convertedUnitPrice +
        (line.convertedAddOnCost ?? 0)
      );
    }
    return 0;
  } else {
    if (line?.saleQuantity && line?.unitPrice) {
      return line.saleQuantity * line.unitPrice + (line.addOnCost ?? 0);
    }
  }
  return 0;
}

export function getTotal(
  lines: Database["public"]["Views"]["salesOrderLines"]["Row"][],
  shouldConvertCurrency: boolean
) {
  let total = 0;

  lines.forEach((line) => {
    total += getLineTotal(line, shouldConvertCurrency);
  });

  return total;
}

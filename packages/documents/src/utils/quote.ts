import type { Database } from "@carbon/database";

export function getLineDescription(
  line: Database["public"]["Views"]["quoteLines"]["Row"]
) {
  const customerPartNumber = line.customerPartId
    ? ` (${line.customerPartId} ${
        line.customerPartRevision ? `Rev ${line.customerPartRevision}` : ""
      })`
    : "";
  return line?.itemId + customerPartNumber;
}

export function getLineDescriptionDetails(
  line: Database["public"]["Views"]["quoteLines"]["Row"]
) {
  return line?.description ? `${line.description}` : "";
}

export function getTotal(
  lines: Database["public"]["Views"]["quoteLines"]["Row"][]
) {
  let total = 0;

  lines.forEach((line) => {
    if (line?.pricingExtendedPrice) {
      total += line.pricingExtendedPrice;
    }
  });

  return total;
}

import type { Database } from "@carbon/database";

export function getLineDescription(
  line: Database["public"]["Views"]["quoteLines"]["Row"]
) {
  const customerPartNumber = line.customerPartId
    ? ` (${line.customerPartId} ${
        line.customerPartRevision ? `Rev ${line.customerPartRevision}` : ""
      })`
    : "";
  return line?.itemReadableId + customerPartNumber;
}

export function getLineDescriptionDetails(
  line: Database["public"]["Views"]["quoteLines"]["Row"]
) {
  return line?.description ? `${line.description}` : "";
}

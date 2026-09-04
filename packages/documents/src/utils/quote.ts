import type { Database } from "@carbon/database";
import { withRevisionSuffix } from "./revision";

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

export function getQuoteDisplayId(
  quote?: {
    quoteId?: string | null;
    revisionId?: number | null;
  } | null
) {
  return withRevisionSuffix(quote?.quoteId, quote?.revisionId);
}

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

/**
 * The quote number as the customer should see it: the revision suffix marks a
 * revised quote (Q000001-1). Revision 0 is the original and stays bare.
 */
export function getQuoteDisplayId(
  quote?: {
    quoteId?: string | null;
    revisionId?: number | null;
  } | null
) {
  return withRevisionSuffix(quote?.quoteId, quote?.revisionId);
}

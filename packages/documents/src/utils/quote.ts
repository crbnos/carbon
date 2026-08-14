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
  const id = quote?.quoteId;
  if (!id) return "";
  const revision = quote?.revisionId ?? 0;
  return revision > 0 ? `${id}-${revision}` : id;
}

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { distinctItemText } from "@carbon/utils";
import {
  formatPartNumber,
  type PartNumberDisplay,
  resolvePartNumberDisplay
} from "./part-number";
import { withRevisionSuffix } from "./revision";

/**
 * A quote line's title: its part numbers per its display choice. `draft` is
 * the Edit document modal's unsaved pick.
 */
export function getLineDescription(
  line: Database["public"]["Views"]["quoteLines"]["Row"],
  draft?: PartNumberDisplay
) {
  return formatPartNumber(
    {
      ours: line?.itemReadableId,
      theirs: line?.customerPartId,
      theirsRevision: line?.customerPartRevision
    },
    resolvePartNumberDisplay("quote", draft ?? line?.partNumberDisplay)
  );
}

export function getLineDescriptionDetails(
  line: Database["public"]["Views"]["quoteLines"]["Row"]
) {
  // A service's readable id is its name — don't print it twice.
  return distinctItemText(line?.itemReadableId, line?.description) ?? "";
}

export function getQuoteDisplayId(
  quote?: {
    quoteId?: string | null;
    revisionId?: number | null;
  } | null
) {
  return withRevisionSuffix(quote?.quoteId, quote?.revisionId);
}

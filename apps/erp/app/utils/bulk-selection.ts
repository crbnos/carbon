// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { allMatchingRequest, type BulkActionScope } from "~/components/Table";
import type { AllMatchingRequest } from "./table-jobs";

/**
 * What a bulk action posts for its selection: every matching row
 * (`allMatching`, the list and its URL search) when the Table's scope says
 * so, else the selected ids under the route's own field name.
 */

export type BulkSelection = {
  scope?: BulkActionScope;
  /** The route's id field: "items", "ids", "jobIds", "batchIds", … */
  idsField: string;
  ids: (string | null | undefined)[];
};

/** Adds the selection to a form body: one `idsField` entry per id, or the
 *  `allMatching` JSON the route reads with `parseAllMatching`. */
export function appendBulkSelection(
  formData: FormData,
  { scope, idsField, ids }: BulkSelection
): FormData {
  if (scope?.allMatching) {
    formData.append(
      "allMatching",
      JSON.stringify(allMatchingRequest(scope.allMatching))
    );
  } else {
    for (const id of ids) if (id) formData.append(idsField, id);
  }
  return formData;
}

/** The selection as a JSON body. */
export function bulkSelectionBody({
  scope,
  idsField,
  ids
}: BulkSelection):
  | { allMatching: AllMatchingRequest }
  | Record<string, string[]> {
  return scope?.allMatching
    ? { allMatching: allMatchingRequest(scope.allMatching) }
    : { [idsField]: ids.filter((id): id is string => !!id) };
}

/**
 * Whether an "every matching row" selection is past an action's row limit
 * (Jobs Release and Batches Release run on at most 2,000). The count is the
 * header's: exact up to 1,000, an estimate above, so the route checks again.
 */
export function isOverAllMatchingLimit(
  scope: BulkActionScope | undefined,
  limit: number
): boolean {
  return !!scope?.allMatching && scope.allMatching.count > limit;
}

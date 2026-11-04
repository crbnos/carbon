// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { useMemo } from "react";
import type { loader } from "~/routes/api+/inventory.non-nettable-storage-units";
import { path } from "~/utils/path";

const EMPTY = new Set<string>();

/**
 * The ids of the company's non-nettable storage units, so any screen that
 * shows a storage unit can mark it with `NonNettableBadge`. Empty while the
 * list loads.
 */
export function useNonNettableStorageUnits(): Set<string> {
  const query = useLoaderQuery<typeof loader>(
    path.to.api.nonNettableStorageUnits
  );
  const ids = query.data?.data;
  return useMemo(() => (ids ? new Set(ids) : EMPTY), [ids]);
}

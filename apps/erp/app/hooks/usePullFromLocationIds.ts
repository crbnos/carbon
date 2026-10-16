// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import type { loader } from "~/routes/api+/items.pull-from-locations";
import { path } from "~/utils/path";
import { useCompanySettings } from "./useCompanySettings";

/**
 * Strict backflush: the locations a pulled line needs a Pull From at, or null
 * while the setting is off or the list is still loading (a badge shows
 * nothing until it is known).
 */
export function usePullFromLocationIds(): string[] | null {
  const companySettings = useCompanySettings();
  const strict = companySettings?.requireBackflushStorageUnit === true;
  const query = useLoaderQuery<typeof loader>(
    strict ? path.to.api.pullFromLocations : null
  );
  return strict ? (query.data?.data ?? null) : null;
}

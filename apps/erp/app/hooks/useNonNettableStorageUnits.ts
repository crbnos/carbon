// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import type { loader } from "~/routes/api+/inventory.non-nettable-storage-units";
import { path } from "~/utils/path";

const EMPTY = new Set<string>();

/**
 * The ids of the company's non-nettable storage units, so any screen that
 * shows a storage unit can mark it with `NonNettableBadge`. Empty while the
 * list loads. A failed read is also empty, so it is reported with a toast
 * (one, however many components read it): without it, a missing marker would
 * look like a unit that is nettable.
 */
export function useNonNettableStorageUnits(): Set<string> {
  const { t } = useLingui();
  const query = useLoaderQuery<typeof loader>(
    path.to.api.nonNettableStorageUnits
  );
  const ids = query.data?.data;
  const failed = query.isError;

  useEffect(() => {
    if (!failed) return;
    toast.error(
      t`Could not load the non-nettable storage units. Non-nettable markers may be missing.`,
      { id: "non-nettable-storage-units-read" }
    );
  }, [failed, t]);

  return useMemo(() => (ids ? new Set(ids) : EMPTY), [ids]);
}

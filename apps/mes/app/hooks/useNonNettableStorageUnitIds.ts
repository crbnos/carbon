// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { fetchAllFromTable } from "@carbon/database";
import { useEffect, useState } from "react";
import { useUser } from "./useUser";

const EMPTY = new Set<string>();

/**
 * The ids of the company's non-nettable storage units, read once per mount,
 * so a list that shows storage units can mark them with `NonNettableBadge`.
 * Empty while it loads or when the read fails.
 */
export function useNonNettableStorageUnitIds(): Set<string> {
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();
  const [ids, setIds] = useState<Set<string>>(EMPTY);

  useEffect(() => {
    if (!carbon) return;
    let cancelled = false;
    // Every page: one read stops at PostgREST's 1,000 rows.
    fetchAllFromTable<{ id: string }>(carbon, "storageUnit", "id", (query) =>
      query
        .eq("companyId", companyId)
        .eq("effectiveNettable", false)
        .order("id")
    ).then(({ data }) => {
      if (!cancelled && data) setIds(new Set(data.map((unit) => unit.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [carbon, companyId]);

  return ids;
}

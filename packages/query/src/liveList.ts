// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { BroadcastChange } from "./useRealtime";

/**
 * A live list after one broadcast change. `fetched` holds the changed rows as
 * re-read from the database (empty for a DELETE). A changed row the read did
 * not return is gone, or no longer visible to this user, so it leaves the list.
 */
export function applyChange<Row extends { id: string }>(
  rows: Row[],
  change: Pick<BroadcastChange, "op" | "ids">,
  fetched: Row[],
  sort: (a: Row, b: Row) => number
): Row[] {
  const changed = new Set(change.ids ?? []);
  const kept = rows.filter((row) => !changed.has(row.id));
  if (change.op === "DELETE") return kept;
  return [...kept, ...fetched].sort(sort);
}

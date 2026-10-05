// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RealtimeTable } from "@carbon/database/realtime-tables";
import { getLogger } from "@carbon/logger";
import { useCarbon } from "@carbon/react";
import { useRef } from "react";
import { matchesFilter } from "./realtimeFilter";
import type { BroadcastChange } from "./useRealtime";
import { useTableChanges } from "./useRealtime";

const logger = getLogger("query", "changed-rows");

export type ChangedRows<Row> = {
  op: BroadcastChange["op"];
  /** Every id the change named. */
  ids: string[];
  /**
   * Those rows as they are now. Empty for a DELETE. A named row that is missing
   * here is gone, or is not visible to this user.
   */
  rows: Row[];
};

/**
 * Follows a table's rows for a component that keeps them in its own state (a
 * chat, a list of running events). A broadcast names the rows that changed and
 * carries no data, so this re-reads them through PostgREST — table RLS decides
 * what comes back — and hands them to `onChange`.
 *
 * `onResync` runs when the change cannot be applied row by row: after a
 * reconnect, or when more than 100 rows changed at once. Load the state again.
 */
export function useChangedRows<Row extends { id: string }>({
  companyId,
  table,
  columns = "*",
  filter,
  enabled = true,
  onChange,
  onResync
}: {
  companyId: string;
  table: RealtimeTable;
  columns?: string;
  /**
   * Only changes to rows of one record, as `useRealtimeTable` takes it
   * (`jobOperationId=eq.<id>`): other rows are not re-read at all.
   */
  filter?: string;
  enabled?: boolean;
  onChange: (change: ChangedRows<Row>) => void;
  onResync?: () => void;
}) {
  const { carbon } = useCarbon();
  const handlers = useRef({ onChange, onResync });
  handlers.current = { onChange, onResync };
  // Changes are applied in the order they arrived: a delete that lands while
  // an earlier update is still being re-read must not be undone by it.
  const queue = useRef<Promise<void>>(Promise.resolve());

  return useTableChanges({
    companyId,
    table,
    enabled,
    onChange: (change) => {
      if (change && !matchesFilter(filter, change)) return;
      queue.current = queue.current.then(() => apply(change));
    }
  });

  async function apply(change: BroadcastChange | null) {
    if (!change?.ids) {
      handlers.current.onResync?.();
      return;
    }
    const { op, ids } = change;
    if (op === "DELETE") {
      handlers.current.onChange({ op, ids, rows: [] });
      return;
    }
    const { data, error } = await carbon
      // The table is one of ~70 and the columns are the caller's: the typed
      // builder cannot express that, and the caller types the rows.
      .from(table as "item")
      .select(columns)
      .eq("companyId", companyId)
      .in("id", ids);
    if (error) {
      logger.error("Failed to read changed rows", { table, error });
      return;
    }
    handlers.current.onChange({
      op,
      ids,
      rows: (data ?? []) as unknown as Row[]
    });
  }
}

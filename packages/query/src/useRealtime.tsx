// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RealtimeTable } from "@carbon/database/realtime-tables";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFetchers, useMatches, useRevalidator } from "react-router";
import { getClientCache, LOADER } from "./cache";
import { matchesIdFilter } from "./realtimeFilter";
import { useRealtimeChannel } from "./useRealtimeChannel";

/** What `broadcast_table_changes` sends: no row data, only which rows changed. */
export type BroadcastChange = {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  /** Null when more than 100 rows changed, or the table has no `id`: resync. */
  ids: string[] | null;
};

const DEFAULT_DEBOUNCE_MS = 300;

/** The topic `broadcast_table_changes` sends a company's changes to a table on. */
export const companyTopic = (companyId: string, table: string) =>
  `company:${companyId}:${table}`;

/** Marks every cached loader entry stale (`cachedClientLoader`, `useLoaderQuery`). */
const invalidateLoaders = () => {
  getClientCache()?.invalidateQueries({ queryKey: [LOADER] });
};

/**
 * `revalidate()` that waits for submitting fetchers. React Router drops a
 * fetcher's redirect when a revalidation starts during its action, so a change
 * that arrives mid-submit is held and applied once the fetcher is done.
 */
export function useRealtimeRevalidator() {
  const revalidator = useRevalidator();
  const submitting = useFetchers().some((f) => f.state === "submitting");
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  const held = useRef(false);

  useEffect(() => {
    if (!submitting && held.current) {
      held.current = false;
      revalidator.revalidate();
    }
  }, [submitting, revalidator]);

  return useCallback(() => {
    if (submittingRef.current) {
      held.current = true;
      return;
    }
    revalidator.revalidate();
  }, [revalidator]);
}

/**
 * Calls `onChange` for each change to `table` in the company, and with `null`
 * after a reconnect (nothing is replayed, so the caller catches up).
 */
export function useTableChanges({
  companyId,
  table,
  enabled = true,
  onChange
}: {
  companyId: string;
  table: RealtimeTable;
  enabled?: boolean;
  onChange: (change: BroadcastChange | null) => void;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  return useRealtimeChannel({
    topic: companyTopic(companyId, table),
    private: true,
    enabled,
    dependencies: [companyId, table],
    onSubscribed: (isReconnect) => {
      if (isReconnect) onChangeRef.current(null);
    },
    setup(channel) {
      return channel.on("broadcast", { event: "*" }, ({ payload }) => {
        onChangeRef.current(payload as BroadcastChange);
      });
    }
  });
}

/**
 * Reloads the page's data when `table` changes in the company. A burst of
 * changes inside `debounceMs` is one reload.
 */
export function useRealtimeTable({
  companyId,
  table,
  filter,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  enabled = true
}: {
  companyId: string;
  table: RealtimeTable;
  /** `id=eq.<id>` or `id=in.(<ids>)`; any other filter is ignored. */
  filter?: string;
  debounceMs?: number;
  enabled?: boolean;
}) {
  const revalidate = useRealtimeRevalidator();
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    []
  );

  return useTableChanges({
    companyId,
    table,
    enabled,
    onChange: (change) => {
      if (change && !matchesIdFilter(filter, change.ids)) return;
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => {
        invalidateLoaders();
        revalidate();
      }, debounceMs);
    }
  });
}

function TableSubscription(props: { companyId: string; table: RealtimeTable }) {
  useRealtimeTable(props);
  return null;
}

/**
 * Keeps the matched routes live: each route names the tables it shows in
 * `handle.realtime`, and this subscribes to them for as long as it is matched.
 * It also follows the company's reference lists, which are read through cached
 * `api+` loaders rather than a matched route. Render it once, in the shell.
 */
export function RouteRealtime({ companyId }: { companyId: string }) {
  const matches = useMatches();
  const tables = useMemo(
    () =>
      [
        ...new Set(
          matches.flatMap(
            (match) =>
              (match.handle as { realtime?: RealtimeTable[] } | undefined)
                ?.realtime ?? []
          )
        )
      ].sort(),
    [matches]
  );

  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    []
  );
  useRealtimeChannel({
    topic: `company:${companyId}:reference`,
    private: true,
    dependencies: [companyId],
    onSubscribed: (isReconnect) => {
      if (isReconnect) invalidateLoaders();
    },
    setup(channel) {
      return channel.on("broadcast", { event: "*" }, () => {
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(invalidateLoaders, DEFAULT_DEBOUNCE_MS);
      });
    }
  });

  return (
    <>
      {tables.map((table) => (
        <TableSubscription key={table} companyId={companyId} table={table} />
      ))}
    </>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { RealtimeTable } from "@carbon/database/realtime-tables";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useCarbon } from "../CarbonContext";
import { applyChange } from "./liveList";
import type { BroadcastChange } from "./useRealtime";
import { useTableChanges } from "./useRealtime";

const logger = getLogger("react", "live-list");

type Carbon = SupabaseClient<Database>;

/**
 * A whole list the app keeps in memory and current: picker options, and labels
 * looked up by id. It is read from IndexedDB at once, fetched only when the
 * server's checksum says it changed, and patched from broadcasts after that.
 */
export type LiveList<Row extends { id: string }> = {
  /** The list's name in `list_checksums`, the query key and IndexedDB. */
  name: string;
  /** The table whose changes carry this list's row ids. */
  table: RealtimeTable;
  /** Tables that feed the list without sharing its ids: a change refetches it. */
  also?: RealtimeTable[];
  fetchAll: (carbon: Carbon, companyId: string) => Promise<Row[]>;
  /** The changed rows, re-read. Without it every change refetches the list. */
  fetchByIds?: (
    carbon: Carbon,
    companyId: string,
    ids: string[]
  ) => Promise<Row[]>;
  sort: (a: Row, b: Row) => number;
};

// A list of some row type, handled generically.
type AnyLiveList = LiveList<any>;

/** Where the lists are kept between sessions (localforage in both apps). */
export type LiveListStorage = {
  getItem: (key: string) => Promise<unknown>;
  setItem: (key: string, value: unknown) => Promise<unknown>;
};

type Stored = { rows: unknown[]; checksum: string | null };

export const liveListKey = (companyId: string, name: string) => [
  "live",
  companyId,
  name
];

// Every key carries the company: an unkeyed copy once hydrated one company's
// pickers with another's rows after a company switch.
const storageKey = (companyId: string, name: string) => `${name}:${companyId}`;

/** A list's rows and a setter, in the `[value, setValue]` shape its consumers use. */
export function useLiveList<Row extends { id: string }>(
  list: LiveList<Row>,
  companyId: string
) {
  const queryClient = useQueryClient();
  const queryKey = liveListKey(companyId, list.name);
  // Never fetches: `LiveLists` owns the data and writes it into the cache.
  const { data } = useQuery<Row[]>({
    queryKey,
    queryFn: () => [],
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY
  });

  const set = useCallback(
    (value: Row[] | ((current: Row[]) => Row[])) => {
      queryClient.setQueryData<Row[]>(
        liveListKey(companyId, list.name),
        (current) =>
          typeof value === "function" ? value(current ?? []) : value
      );
    },
    [queryClient, companyId, list.name]
  );

  return [data ?? EMPTY, set] as const;
}

const EMPTY: never[] = [];

function Subscription({
  companyId,
  table,
  onChange
}: {
  companyId: string;
  table: RealtimeTable;
  onChange: (change: BroadcastChange | null) => void;
}) {
  useTableChanges({ companyId, table, onChange });
  return null;
}

/**
 * Loads the lists and keeps them current. Render it once, in the shell.
 *
 * On load each list comes out of IndexedDB, then one `list_checksums` call
 * decides which lists to fetch: a list whose checksum matches the stored one is
 * not fetched at all. A reconnect runs the same comparison, since no broadcast
 * is replayed.
 */
export function LiveLists({
  companyId,
  lists,
  storage
}: {
  companyId: string;
  lists: AnyLiveList[];
  storage: () => Promise<LiveListStorage>;
}) {
  const { carbon, accessToken } = useCarbon();
  const queryClient = useQueryClient();
  // The company the callbacks below are working for. A fetch that finishes
  // after a company switch belongs to the old company and is dropped.
  const active = useRef(companyId);
  active.current = companyId;
  const ready = Boolean(carbon && accessToken);

  const persist = useCallback(
    async (list: AnyLiveList, rows: unknown[], checksum: string | null) => {
      const idb = await storage();
      const stored: Stored = { rows, checksum };
      await idb.setItem(storageKey(companyId, list.name), stored);
    },
    [storage, companyId]
  );

  /** Fetch the lists whose checksum differs from the stored one. */
  const sync = useCallback(
    async (targets: AnyLiveList[]) => {
      if (!carbon) return;
      const idb = await storage();
      const { data, error } = await carbon.rpc("list_checksums", {
        p_company_id: companyId
      });
      if (error) throw error;
      const checksums = new Map(
        (data ?? []).map((row) => [row.list, row.checksum])
      );

      await Promise.all(
        targets.map(async (list) => {
          const key = liveListKey(companyId, list.name);
          const stored = (await idb.getItem(
            storageKey(companyId, list.name)
          )) as Stored | null;
          const checksum = checksums.get(list.name) ?? null;
          if (
            checksum &&
            stored?.checksum === checksum &&
            queryClient.getQueryData(key)
          ) {
            return;
          }
          const rows = await list.fetchAll(carbon, companyId);
          if (active.current !== companyId) return;
          queryClient.setQueryData(key, rows);
          await persist(list, rows, checksum);
        })
      );
    },
    [carbon, companyId, queryClient, storage, persist]
  );

  // Cold load: IndexedDB first so pickers have options at once, then the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const idb = await storage();
      await Promise.all(
        lists.map(async (list) => {
          const stored = await idb.getItem(storageKey(companyId, list.name));
          // A bare array is the copy the previous provider wrote: no checksum.
          const rows = Array.isArray(stored)
            ? stored
            : (stored as Stored | null)?.rows;
          const key = liveListKey(companyId, list.name);
          if (rows && !cancelled && !queryClient.getQueryData(key)) {
            queryClient.setQueryData(key, rows);
          }
        })
      );
      if (cancelled || !ready) return;
      await sync(lists);
    })().catch((error) => logger.error("live list load failed", { error }));
    return () => {
      cancelled = true;
    };
  }, [companyId, ready, lists, storage, queryClient, sync]);

  const onChange = useCallback(
    async (
      list: AnyLiveList,
      table: RealtimeTable,
      change: BroadcastChange | null
    ) => {
      if (!carbon) return;
      // A reconnect, a bulk change, or a feeder table: compare and refetch.
      if (!change?.ids || table !== list.table || !list.fetchByIds) {
        await sync([list]);
        return;
      }
      const fetched =
        change.op === "DELETE"
          ? []
          : await list.fetchByIds(carbon, companyId, change.ids);
      if (active.current !== companyId) return;
      const rows = queryClient.setQueryData<{ id: string }[]>(
        liveListKey(companyId, list.name),
        (current) => applyChange(current ?? [], change, fetched, list.sort)
      );
      // ponytail: no checksum is stored for a patched list, so its next cold
      // load refetches it once. Storing the server's checksum here would hide a
      // missed broadcast for good; compute the hash client-side if that one
      // fetch ever matters.
      await persist(list, rows ?? [], null);
    },
    [carbon, companyId, queryClient, sync, persist]
  );

  if (!ready) return null;

  return (
    <>
      {lists.flatMap((list) =>
        [list.table, ...(list.also ?? [])].map((table) => (
          <Subscription
            key={`${list.name}:${table}`}
            companyId={companyId}
            table={table}
            onChange={(change) => {
              onChange(list, table, change).catch((error) =>
                logger.error("live list update failed", {
                  list: list.name,
                  error
                })
              );
            }}
          />
        ))
      )}
    </>
  );
}

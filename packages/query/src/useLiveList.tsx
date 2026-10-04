// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { RealtimeTable } from "@carbon/database/realtime-tables";
import { getLogger } from "@carbon/logger";
import { useCarbon } from "@carbon/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import {
  type Cursor,
  type LoggedChanges,
  oldestCursor,
  planSync,
  removeRows,
  upsertRows
} from "./liveList";
import type { BroadcastChange } from "./useRealtime";
import { useTableChanges } from "./useRealtime";

const logger = getLogger("query", "live-list");

type Carbon = SupabaseClient<Database>;

/**
 * A whole list the app keeps in memory and current: picker options, and labels
 * looked up by id.
 *
 * It is read from IndexedDB at once. The server is then asked which rows
 * changed since the stored copy was taken (`table_changes_since`), and only
 * those rows are read — the full list is fetched once per device, and again
 * only when the change log cannot answer (see `planSync`). While the tab is
 * open, broadcasts patch it row by row.
 */
export type LiveList<Row extends { id: string }> = {
  /** The list's name in the query key and IndexedDB. */
  name: string;
  /** The table whose row ids are this list's row ids. */
  table: RealtimeTable;
  fetchAll: (carbon: Carbon, companyId: string) => Promise<Row[]>;
  /** The rows with these ids, as they are now. A missing one leaves the list. */
  fetchByIds: (
    carbon: Carbon,
    companyId: string,
    ids: string[]
  ) => Promise<Row[]>;
  /**
   * Other tables that feed a list row (an item's supersession, its model's
   * thumbnail). `fetch` returns the list rows that those changed rows touch.
   */
  related?: {
    table: RealtimeTable;
    fetch: (carbon: Carbon, companyId: string, ids: string[]) => Promise<Row[]>;
  }[];
  sort: (a: Row, b: Row) => number;
};

// A list of some row type, handled generically.
type AnyLiveList = LiveList<any>;
type AnyRow = { id: string };

/** Where the lists are kept between sessions (localforage in both apps). */
export type LiveListStorage = {
  getItem: (key: string) => Promise<unknown>;
  setItem: (key: string, value: unknown) => Promise<unknown>;
};

type Stored = { rows: AnyRow[]; cursor: Cursor | null };

export const liveListKey = (companyId: string, name: string) => [
  "live",
  companyId,
  name
];

// Every key carries the company: an unkeyed copy once hydrated one company's
// pickers with another's rows after a company switch.
const storageKey = (companyId: string, name: string) => `${name}:${companyId}`;

// A copy written before lists had a cursor is a bare array (or carries a
// checksum instead): its rows are still good to show, with no cursor.
const readStored = (value: unknown): Stored | null => {
  if (Array.isArray(value)) return { rows: value, cursor: null };
  const stored = value as Partial<Stored> | null;
  return stored?.rows
    ? { rows: stored.rows, cursor: stored.cursor ?? null }
    : null;
};

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

/** Loads the lists and keeps them current. Render it once, in the shell. */
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
  // The company the callbacks below are working for. A read that finishes
  // after a company switch belongs to the old company and is dropped.
  const active = useRef(companyId);
  active.current = companyId;
  // Each list's cursor: where the change log is asked to start next time.
  const cursors = useRef(new Map<string, Cursor | null>());
  const ready = Boolean(carbon && accessToken);

  const rowsOf = useCallback(
    (list: AnyLiveList) =>
      queryClient.getQueryData<AnyRow[]>(liveListKey(companyId, list.name)),
    [queryClient, companyId]
  );

  /** Put rows in the cache and in IndexedDB, with the list's cursor. */
  const commit = useCallback(
    async (list: AnyLiveList, rows: AnyRow[]) => {
      if (active.current !== companyId) return;
      queryClient.setQueryData(liveListKey(companyId, list.name), rows);
      const stored: Stored = {
        rows,
        cursor: cursors.current.get(list.name) ?? null
      };
      await (await storage()).setItem(storageKey(companyId, list.name), stored);
    },
    [queryClient, storage, companyId]
  );

  /** The rows of `table` with these ids changed: bring the list up to date. */
  const applyIds = useCallback(
    async (list: AnyLiveList, table: string, ids: string[]) => {
      if (!carbon || ids.length === 0) return rowsOf(list) ?? [];
      const current = rowsOf(list) ?? [];
      if (table === list.table) {
        // Re-read replaces what came back and drops what did not (deleted, or
        // no longer visible to this user).
        const fetched = await list.fetchByIds(carbon, companyId, ids);
        return upsertRows(removeRows(current, ids), fetched, list.sort);
      }
      const feeder = list.related?.find((r) => r.table === table);
      if (!feeder) return current;
      return upsertRows(
        current,
        await feeder.fetch(carbon, companyId, ids),
        list.sort
      );
    },
    [carbon, companyId, rowsOf]
  );

  /** Ask the change log what changed since the lists' cursors, and apply it. */
  const sync = useCallback(
    async (targets: AnyLiveList[]) => {
      if (!carbon) return;
      // A list's cursor only counts if the list still has its rows.
      const cursorOf = (list: AnyLiveList) =>
        rowsOf(list) ? (cursors.current.get(list.name) ?? null) : null;
      const since = oldestCursor(targets.map(cursorOf));
      const { data, error } = await carbon.rpc("table_changes_since", {
        p_company_id: companyId,
        p_xid: since?.xid,
        p_epoch: since?.epoch,
        p_at: since?.at
      });
      if (error) throw error;
      if (active.current !== companyId) return;
      const log = data as unknown as LoggedChanges;
      const next: Cursor = { xid: log.xid, epoch: log.epoch, at: log.at };

      await Promise.all(
        targets.map(async (list) => {
          const tables = [
            list.table,
            ...(list.related ?? []).map((r) => r.table)
          ];
          const plan = planSync(
            log,
            tables,
            cursorOf(list)?.epoch === since?.epoch && since !== null
          );
          let rows: AnyRow[];
          if (plan === "all") {
            rows = await list.fetchAll(carbon, companyId);
          } else {
            rows = rowsOf(list) ?? [];
            for (const [table, ids] of plan) {
              queryClient.setQueryData(liveListKey(companyId, list.name), rows);
              rows = await applyIds(list, table, ids);
            }
          }
          cursors.current.set(list.name, next);
          await commit(list, rows);
        })
      );
    },
    [carbon, companyId, queryClient, rowsOf, applyIds, commit]
  );

  // Cold load: IndexedDB first so pickers have options at once, then the log.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const idb = await storage();
      await Promise.all(
        lists.map(async (list) => {
          const stored = readStored(
            await idb.getItem(storageKey(companyId, list.name))
          );
          if (!stored || cancelled || rowsOf(list)) return;
          cursors.current.set(list.name, stored.cursor);
          queryClient.setQueryData(
            liveListKey(companyId, list.name),
            stored.rows
          );
        })
      );
      if (cancelled || !ready) return;
      await sync(lists);
    })().catch((error) => logger.error("live list load failed", { error }));
    return () => {
      cancelled = true;
    };
  }, [companyId, ready, lists, storage, queryClient, rowsOf, sync]);

  const onChange = useCallback(
    async (
      list: AnyLiveList,
      table: RealtimeTable,
      change: BroadcastChange | null
    ) => {
      // A reconnect or a bulk change: the log knows exactly what was missed.
      if (!change?.ids) {
        await sync([list]);
        return;
      }
      const rows =
        change.op === "DELETE" && table === list.table
          ? removeRows(rowsOf(list) ?? [], change.ids)
          : await applyIds(list, table, change.ids);
      // The cursor stays where it was: the log will name these rows again on
      // the next load, and re-reading them is harmless.
      await commit(list, rows);
    },
    [sync, rowsOf, applyIds, commit]
  );

  if (!ready) return null;

  return (
    <>
      {lists.flatMap((list) =>
        [list.table, ...(list.related ?? []).map((r) => r.table)].map(
          (table) => (
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
          )
        )
      )}
    </>
  );
}

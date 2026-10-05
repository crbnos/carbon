// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { RealtimeTable } from "@carbon/database/realtime-tables";
import { getLogger } from "@carbon/logger";
import { useCarbon } from "@carbon/react";
import { chunkArray } from "@carbon/utils";
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

const IDS_PER_REQUEST = 100;

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
// The stored copy also carries the user: it is that user's view of the list
// (table RLS chose the rows), and the next person at this browser starts from
// the server rather than from someone else's rows.
const storedKey = (companyId: string, userId: string, name: string) =>
  `${storageKey(companyId, name)}:${userId}`;

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
  userId,
  lists,
  storage
}: {
  companyId: string;
  userId: string;
  lists: AnyLiveList[];
  storage: () => Promise<LiveListStorage>;
}) {
  const { carbon, accessToken } = useCarbon();
  const queryClient = useQueryClient();
  // The company the callbacks below are working for. A read that finishes
  // after a company switch belongs to the old company and is dropped.
  const active = useRef(companyId);
  active.current = companyId;
  // Each list's cursor, per company (a company switch keeps this mounted):
  // where the change log is asked to start next time.
  const cursors = useRef(new Map<string, Cursor | null>());
  const ready = Boolean(carbon && accessToken);
  // One update of a list at a time. A full fetch and a broadcast's re-read
  // overlap otherwise, and the fetch (the older read) lands last and undoes it.
  const queues = useRef(new Map<string, Promise<unknown>>());
  const inTurn = useCallback(
    <T,>(list: AnyLiveList, update: () => Promise<T>): Promise<T> => {
      const key = storageKey(companyId, list.name);
      const turn = (queues.current.get(key) ?? Promise.resolve()).then(
        update,
        update
      );
      queues.current.set(key, turn);
      return turn;
    },
    [companyId]
  );

  const rowsOf = useCallback(
    (list: AnyLiveList) =>
      queryClient.getQueryData<AnyRow[]>(liveListKey(companyId, list.name)),
    [queryClient, companyId]
  );

  /**
   * Change a list's rows in the cache, then store them with the list's cursor.
   * The change is a function of the rows as they are NOW: two re-reads that
   * finish in either order both land, where a value computed before the read
   * would overwrite the other's rows.
   */
  const commit = useCallback(
    async (
      list: AnyLiveList,
      change: (rows: AnyRow[]) => AnyRow[],
      // The cursor these rows are current as of. It moves only with the rows:
      // a change dropped here must be asked for again.
      cursor?: Cursor
    ) => {
      if (active.current !== companyId) return;
      const rows = queryClient.setQueryData<AnyRow[]>(
        liveListKey(companyId, list.name),
        (current) => change(current ?? [])
      );
      if (cursor) cursors.current.set(storageKey(companyId, list.name), cursor);
      const stored: Stored = {
        rows: rows ?? [],
        cursor: cursors.current.get(storageKey(companyId, list.name)) ?? null
      };
      // The stored copy only speeds up the next load.
      try {
        await (await storage()).setItem(
          storedKey(companyId, userId, list.name),
          stored
        );
      } catch (error) {
        logger.warn("live list not stored", { list: list.name, error });
      }
    },
    [queryClient, storage, companyId, userId]
  );

  /** The rows of `table` with these ids changed: how the list changes. */
  const readIds = useCallback(
    async (
      list: AnyLiveList,
      table: string,
      ids: string[]
    ): Promise<(rows: AnyRow[]) => AnyRow[]> => {
      const read =
        table === list.table
          ? list.fetchByIds
          : list.related?.find((r) => r.table === table)?.fetch;
      if (!carbon || !read || ids.length === 0) return (rows) => rows;
      // `.in()` goes in the URL: a few hundred ids exceed the gateway's limit.
      const fetched = (
        await Promise.all(
          chunkArray(ids, IDS_PER_REQUEST).map((chunk) =>
            read(carbon, companyId, chunk)
          )
        )
      ).flat();
      return (rows) =>
        upsertRows(
          // A row of the list's own table that did not come back is gone
          // (deleted, or no longer visible to this user).
          table === list.table ? removeRows(rows, ids) : rows,
          fetched,
          list.sort
        );
    },
    [carbon, companyId]
  );

  /** Ask the change log what changed since the lists' cursors, and apply it. */
  const sync = useCallback(
    async (targets: AnyLiveList[]) => {
      if (!carbon) return;
      // A list's cursor only counts if the list still has its rows.
      const cursorOf = (list: AnyLiveList) =>
        rowsOf(list)
          ? (cursors.current.get(storageKey(companyId, list.name)) ?? null)
          : null;
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
        targets.map((list) =>
          inTurn(list, async () => {
            const tables = [
              list.table,
              ...(list.related ?? []).map((r) => r.table)
            ];
            const plan = planSync(
              log,
              tables,
              cursorOf(list)?.epoch === since?.epoch && since !== null
            );
            let changes: ((rows: AnyRow[]) => AnyRow[])[];
            if (plan === "all") {
              const all = await list.fetchAll(carbon, companyId);
              changes = [() => all];
            } else {
              changes = await Promise.all(
                plan.map(([table, ids]) => readIds(list, table, ids))
              );
            }
            await commit(
              list,
              (rows) =>
                changes.reduce((current, change) => change(current), rows),
              next
            );
          })
        )
      );
    },
    [carbon, companyId, rowsOf, readIds, commit, inTurn]
  );

  // Cold load: IndexedDB first so pickers have options at once, then the log.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Without storage (blocked, or no driver) the lists come from the server.
      try {
        const idb = await storage();
        await Promise.all(
          lists.map(async (list) => {
            const stored = readStored(
              await idb.getItem(storedKey(companyId, userId, list.name))
            );
            if (!stored || cancelled || rowsOf(list)) return;
            cursors.current.set(
              storageKey(companyId, list.name),
              stored.cursor
            );
            queryClient.setQueryData(
              liveListKey(companyId, list.name),
              stored.rows
            );
          })
        );
      } catch (error) {
        logger.warn("stored live lists not read", { error });
      }
      if (cancelled || !ready) return;
      await sync(lists);
    })().catch((error) => logger.error("live list load failed", { error }));
    return () => {
      cancelled = true;
    };
  }, [companyId, userId, ready, lists, storage, queryClient, rowsOf, sync]);

  const resync = useRef<{
    lists: Set<AnyLiveList>;
    pending: Promise<void> | null;
  }>({ lists: new Set(), pending: null });

  const onChange = useCallback(
    async (
      list: AnyLiveList,
      table: RealtimeTable,
      change: BroadcastChange | null
    ) => {
      // A reconnect or a bulk change: the log knows exactly what was missed.
      // Every channel reconnects together, so the lists ask the log once.
      if (!change?.ids) {
        resync.current.lists.add(list);
        resync.current.pending ??= new Promise<void>((resolve) =>
          setTimeout(resolve, 50)
        ).then(() => {
          const targets = [...resync.current.lists];
          resync.current = { lists: new Set(), pending: null };
          return sync(targets);
        });
        await resync.current.pending;
        return;
      }
      const { ids } = change;
      // The cursor stays where it was: the log will name these rows again on
      // the next load, and re-reading them is harmless.
      await inTurn(list, async () =>
        commit(
          list,
          change.op === "DELETE" && table === list.table
            ? (rows) => removeRows(rows, ids)
            : await readIds(list, table, ids)
        )
      );
    },
    [sync, readIds, commit, inTurn]
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

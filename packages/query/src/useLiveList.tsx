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
  expiredStoredKeys,
  type LoggedChanges,
  oldestCursor,
  planSync,
  removeRows,
  staleStoredKeys,
  storedAtKey,
  storedListKey,
  storedListKeys,
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
  removeItem: (key: string) => Promise<unknown>;
  keys: () => Promise<string[]>;
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
const storedKey = storedListKey;

/** Remove a stored list and the write time kept beside it. */
// How often an open page checks its stored lists and asks the log again.
const BACKGROUND_CHECK_MS = 60 * 60 * 1000;

const forget = (idb: LiveListStorage, key: string) =>
  Promise.all([idb.removeItem(key), idb.removeItem(storedAtKey(key))]);
// What Postgres answers when `table_changes_since` refuses the caller.
const NOT_A_MEMBER = "42501";

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

// How long a reconnect waits for the rest of the lists' channels to rejoin.
const REJOIN_WAIT_MS = 3_000;

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
  companyIds,
  lists,
  storage
}: {
  companyId: string;
  userId: string;
  /**
   * Every company the user belongs to. Lists stored on this device for any
   * other company, or for another user, are removed when the page loads.
   */
  companyIds: string[];
  lists: AnyLiveList[];
  storage: () => Promise<LiveListStorage>;
}) {
  const { carbon, accessToken } = useCarbon();
  const queryClient = useQueryClient();
  // The company the callbacks below are working for. A read that finishes
  // after a company switch belongs to the old company and is dropped.
  const active = useRef(companyId);
  active.current = companyId;
  // Read when the page loads; a new array each render must not reload the lists.
  const memberOf = useRef(companyIds);
  memberOf.current = companyIds;
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
   * Change a list's rows in the cache and, when the change log was read, store
   * them with the cursor it handed back.
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
      // A broadcast's patch is not stored. It does not move the cursor, so the
      // next load asks the log from the same place and re-reads these rows
      // whether or not the stored copy had them; and storing means writing the
      // whole list (about 150 ms of blocked page for 150,000 items) per change.
      if (!cursor) return;
      cursors.current.set(storageKey(companyId, list.name), cursor);
      const stored: Stored = { rows: rows ?? [], cursor };
      // The stored copy only speeds up the next load.
      try {
        const idb = await storage();
        const key = storedKey(companyId, userId, list.name);
        await idb.setItem(key, stored);
        // An absolute instant, only ever compared with another one.
        await idb.setItem(storedAtKey(key), Date.now());
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
      if (error?.code === NOT_A_MEMBER) {
        // The user left this company while the page was open: nothing of its
        // lists stays in memory or on the device.
        logger.warn("live lists dropped: no longer a member", { companyId });
        // Memory first, and without storage: a blocked or failing IndexedDB
        // must not leave the company's rows on the page.
        for (const list of lists) {
          queryClient.setQueryData(liveListKey(companyId, list.name), []);
          cursors.current.delete(storageKey(companyId, list.name));
        }
        try {
          const idb = await storage();
          await Promise.all(
            lists.map((list) =>
              forget(idb, storedKey(companyId, userId, list.name))
            )
          );
        } catch (error) {
          logger.warn("stored live lists not removed", { companyId, error });
        }
        return;
      }
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
    [
      carbon,
      companyId,
      userId,
      lists,
      storage,
      queryClient,
      rowsOf,
      readIds,
      commit,
      inTurn
    ]
  );

  /** Remove the stored lists that are too old, another user's, or a company's the user has left. */
  const prune = useCallback(
    async (idb: LiveListStorage) => {
      const names = lists.map((list) => list.name);
      const keys = await idb.keys();
      const stale = staleStoredKeys(keys, {
        names,
        userId,
        companyIds: [companyId, ...memberOf.current]
      });
      const kept = storedListKeys(keys, names).filter(
        (key) => !stale.includes(key)
      );
      const expired = expiredStoredKeys(
        await Promise.all(
          kept.map(
            async (key) =>
              [key, await idb.getItem(storedAtKey(key))] as [string, unknown]
          )
        ),
        Date.now()
      );
      await Promise.all([...stale, ...expired].map((key) => forget(idb, key)));
    },
    [lists, userId, companyId]
  );

  // Cold load: IndexedDB first so pickers have options at once, then the log.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Without storage (blocked, or no driver) the lists come from the server.
      try {
        const idb = await storage();
        await prune(idb);
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
  }, [
    companyId,
    userId,
    ready,
    lists,
    storage,
    queryClient,
    rowsOf,
    sync,
    prune
  ]);

  // While the page stays open: a stored list still goes when it is a day old
  // or stops being this user's, and the log is asked again, which also notices
  // a user who has left the company. A hidden tab only tidies the device.
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      (async () => {
        // Tidying the device is best-effort; the sync below is what notices
        // a user who has left the company, and must run without it.
        try {
          await prune(await storage());
        } catch (error) {
          logger.warn("stored live lists not pruned", { error });
        }
        if (document.visibilityState === "visible") await sync(lists);
      })().catch((error) =>
        logger.warn("live list background check failed", { error })
      );
    }, BACKGROUND_CHECK_MS);
    return () => clearInterval(timer);
  }, [ready, lists, storage, sync, prune]);

  // Every (list, table) pair has its own topic, and so its own channel.
  const topicCount = lists.reduce(
    (count, list) => count + 1 + (list.related?.length ?? 0),
    0
  );
  const resync = useRef<{
    lists: Set<AnyLiveList>;
    rejoined: Set<string>;
    timer: ReturnType<typeof setTimeout> | null;
    run: () => void;
    pending: Promise<void>;
  } | null>(null);

  const onChange = useCallback(
    async (
      list: AnyLiveList,
      table: RealtimeTable,
      change: BroadcastChange | null
    ) => {
      // A reconnect or a bulk change: the log knows exactly what was missed.
      if (!change?.ids) {
        if (!resync.current) {
          const { promise, resolve: run } = Promise.withResolvers<void>();
          const pending = promise.then(() => {
            const batch = resync.current;
            resync.current = null;
            if (!batch) return;
            if (batch.timer) clearTimeout(batch.timer);
            return sync([...batch.lists]);
          });
          resync.current = {
            lists: new Set(),
            rejoined: new Set(),
            timer: null,
            run,
            pending
          };
        }
        const batch = resync.current;
        batch.lists.add(list);
        if (change) {
          batch.timer ??= setTimeout(batch.run, 50);
        } else {
          // The channels rejoin one after another, a round trip each. Asking
          // once, after the last of them, covers what all of them missed; a
          // channel that never rejoins does not hold the others up for long.
          batch.rejoined.add(`${list.name}:${table}`);
          if (batch.rejoined.size >= topicCount) batch.run();
          else batch.timer ??= setTimeout(batch.run, REJOIN_WAIT_MS);
        }
        await batch.pending;
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
    [sync, readIds, commit, inTurn, topicCount]
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

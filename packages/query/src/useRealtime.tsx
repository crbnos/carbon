// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  RealtimeTable,
  RouteRealtimeTable
} from "@carbon/database/realtime-tables";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore
} from "react";
import { useFetchers, useMatches, useRevalidator } from "react-router";
import { getClientCache } from "./cache";
import { invalidateLoaderEntries } from "./invalidation";
import { matchesFilter } from "./realtimeFilter";
import { useRealtimeChannel } from "./useRealtimeChannel";

/** What `broadcast_table_changes` sends: no row data, only which rows changed. */
export type BroadcastChange = {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  /** Null when more than 100 rows changed, or the table has no `id`: resync. */
  ids: string[] | null;
  /**
   * The records the rows belong to: each `<name>Id` column and its values.
   * Null with `ids`; a column with more than 20 values is left out.
   */
  parents?: Record<string, string[]> | null;
};

const DEFAULT_DEBOUNCE_MS = 300;
// A table that changes more often than its debounce would never reload.
const MAX_WAIT_MS = 5000;

/** The topic `broadcast_table_changes` sends a company's changes to a table on. */
export const companyTopic = (companyId: string, table: string) =>
  `company:${companyId}:${table}`;

/** Marks every cached loader entry stale (`cachedClientLoader`, `useLoaderQuery`). */
const invalidateLoaders = () => invalidateLoaderEntries(getClientCache());

// ─── One channel per topic ───────────────────────────────────────────────────
//
// The Realtime client hands back the SAME channel for a topic it already has, so
// two hooks that each opened `company:<id>:customer` would share one channel and
// the first to unmount would close it for the other. Instead every interested
// component registers a listener here, and `RouteRealtime` (rendered once, in
// the shell) owns exactly one channel per topic that has listeners.

/** `null` after a reconnect: nothing is replayed, so the listener catches up. */
type Listener = (change: BroadcastChange | null) => void;

const listeners = new Map<string, Set<Listener>>();
const watchers = new Set<() => void>();
const NO_TOPICS: string[] = [];
let topics: string[] = NO_TOPICS;

const publishTopics = () => {
  topics = [...listeners.keys()].sort();
  for (const notify of watchers) notify();
};

const dispatch = (topic: string, change: BroadcastChange | null) => {
  for (const listener of listeners.get(topic) ?? []) listener(change);
};

function listen(topic: string, listener: Listener) {
  const existing = listeners.get(topic);
  if (existing) {
    existing.add(listener);
  } else {
    listeners.set(topic, new Set([listener]));
    publishTopics();
  }
  return () => {
    const set = listeners.get(topic);
    set?.delete(listener);
    if (set?.size === 0) {
      listeners.delete(topic);
      publishTopics();
    }
  };
}

/**
 * Listen to a private broadcast topic. Any number of components may listen to
 * one topic; they share its channel. `onMessage(null)` means "reconnected".
 */
export function useTopic(topic: string, onMessage: Listener, enabled = true) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;
    return listen(topic, (change) => onMessageRef.current(change));
  }, [topic, enabled]);
}

function TopicChannel({ topic }: { topic: string }) {
  useRealtimeChannel({
    topic,
    private: true,
    dependencies: [topic],
    onSubscribed: (isReconnect) => {
      if (isReconnect) dispatch(topic, null);
    },
    setup(channel) {
      return channel.on("broadcast", { event: "*" }, ({ payload }) => {
        dispatch(topic, payload as BroadcastChange);
      });
    }
  });
  return null;
}

function TopicChannels() {
  const active = useSyncExternalStore(
    (notify) => {
      watchers.add(notify);
      return () => watchers.delete(notify);
    },
    () => topics,
    () => NO_TOPICS
  );
  return (
    <>
      {active.map((topic) => (
        <TopicChannel key={topic} topic={topic} />
      ))}
    </>
  );
}

// A route and a component on it may both follow one table, and one write often
// touches several tables a page follows. Their timers fire together; the page
// is reloaded once.
let revalidation: ReturnType<typeof setTimeout> | null = null;
const requestRevalidation = (revalidate: () => void) => {
  if (revalidation) clearTimeout(revalidation);
  revalidation = setTimeout(() => {
    revalidation = null;
    revalidate();
  }, 50);
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
      requestRevalidation(revalidator.revalidate);
    }
  }, [submitting, revalidator]);

  return useCallback(() => {
    if (submittingRef.current) {
      held.current = true;
      return;
    }
    requestRevalidation(revalidator.revalidate);
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
  useTopic(companyTopic(companyId, table), onChange, enabled);
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
  /**
   * `id=eq.<id>`, `id=in.(<ids>)`, or the same on a `<name>Id` column
   * (`jobId=eq.<id>`). A filter on any other column is ignored.
   */
  filter?: string;
  debounceMs?: number;
  enabled?: boolean;
}) {
  const revalidate = useRealtimeRevalidator();
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingSince = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    []
  );

  useTableChanges({
    companyId,
    table,
    enabled,
    onChange: (change) => {
      if (change && !matchesFilter(filter, change)) return;
      if (timeout.current) clearTimeout(timeout.current);
      waitingSince.current ??= performance.now();
      const waited = performance.now() - waitingSince.current;
      timeout.current = setTimeout(
        () => {
          waitingSince.current = null;
          invalidateLoaders();
          revalidate();
        },
        Math.max(0, Math.min(debounceMs, MAX_WAIT_MS - waited))
      );
    }
  });
}

function TableSubscription(props: {
  companyId: string;
  table: RealtimeTable;
  filter?: string;
}) {
  useRealtimeTable(props);
  return null;
}

/**
 * Keeps the matched routes live: each route names the tables it shows in
 * `handle.realtime`, and this subscribes to them for as long as it is matched.
 * An entry `{ table, column, param }` follows only the rows whose `column` is
 * the route's `param` (a job page: its own operations, not every job's), and
 * `{ table, filter }` builds the filter from the route's loader data.
 * It also owns every realtime channel of the page (see "One channel per topic"):
 * nothing is delivered to any listener unless this is mounted.
 * It also follows the company's reference lists, which are read through cached
 * `api+` loaders rather than a matched route. Render it once, in the shell.
 */
export function RouteRealtime({ companyId }: { companyId: string }) {
  const matches = useMatches();
  const tables = useMemo(() => {
    const followed = new Map<
      string,
      { table: RealtimeTable; filter?: string }
    >();
    for (const match of matches) {
      const entries =
        (match.handle as { realtime?: RouteRealtimeTable[] } | undefined)
          ?.realtime ?? [];
      for (const entry of entries) {
        if (typeof entry === "string") {
          followed.set(entry, { table: entry });
          continue;
        }
        let filter: string | undefined | false;
        if ("filter" in entry) {
          filter = entry.filter({
            params: match.params,
            data: match.loaderData ?? match.data
          });
        } else {
          const value = match.params[entry.param];
          filter = value ? `${entry.column}=eq.${value}` : undefined;
        }
        if (filter === false) continue;
        followed.set(`${entry.table}:${filter ?? ""}`, {
          table: entry.table,
          filter
        });
      }
    }
    return [...followed.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [matches]);

  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    []
  );
  useTopic(`company:${companyId}:reference`, (change) => {
    if (!change) {
      invalidateLoaders();
      return;
    }
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(invalidateLoaders, DEFAULT_DEBOUNCE_MS);
  });

  return (
    <>
      {tables.map(([key, { table, filter }]) => (
        <TableSubscription
          key={key}
          companyId={companyId}
          table={table}
          filter={filter}
        />
      ))}
      <TopicChannels />
    </>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import {
  useFetcher,
  useFormAction,
  useLocation,
  useNavigationType
} from "react-router";
import { path } from "~/utils/path";
import {
  getInfiniteRows,
  getPageUrl,
  getRefreshPageCount,
  getResetKey,
  getStoreKey,
  type InfinitePage,
  mergeRows,
  type PageResult,
  readPage,
  readRowId,
  saveInfiniteRows
} from "./infiniteRowsStore";
import { tick } from "./rowEdits";
import type { InfiniteOptions, InfiniteRows } from "./types";

export type { InfiniteRows } from "./types";

// The pages loaded after page 1, for one list query.
type Loaded<T> = {
  resetKey: string;
  /** The page 1 these pages were loaded after. Null: fetch them again. */
  baseRows: T[] | null;
  pages: InfinitePage<T>[];
  /** The tick when the load of these pages started (`InfiniteRows.syncedAt`). */
  syncedAt: number;
};

type PendingRequest = {
  id: number;
  cursor: string;
  dataAtStart: unknown;
  loading: boolean;
  settled: boolean;
  resolve: (result: PageResult<unknown>) => void;
};

type FailedTask = "append" | "refresh";

/**
 * Infinite scroll over a loader that pages with a cursor (`toPage`).
 *
 * Page 1 always comes from the loader, so a revalidation or a filter change
 * needs no extra request for it. Later pages come from `useFetcher` on the
 * list route (or `pageUrl`) with `?after=<cursor>`, one request at a time.
 *
 * Without `infinite`, the hook returns `initialRows` and fetches nothing.
 */
export function useInfiniteRows<T>({
  initialRows,
  infinite,
  getRowId
}: {
  initialRows: T[];
  infinite?: InfiniteOptions;
  getRowId?: (row: T) => string;
}): InfiniteRows<T> {
  const enabled = !!infinite;
  const fetcher = useFetcher();
  // The list route's own URL with the current search. Not `location.pathname`:
  // with a drawer open, that is the child route, whose loader has no rows.
  const formAction = useFormAction();
  const location = useLocation();
  const navigationType = useNavigationType();
  const companyId = useRouteData<{ company?: { id?: string } }>(
    path.to.authenticatedRoot
  )?.company?.id;

  const pageUrl = infinite?.pageUrl ?? formAction;
  const resetKey = getResetKey(
    location.search,
    infinite?.pageUrl,
    infinite?.ignoreParams
  );
  const storeKey = getStoreKey({
    companyId,
    dataKey: infinite?.dataKey ?? "",
    pageUrl,
    ignoreParams: infinite?.ignoreParams
  });
  const rowIdOf = getRowId ?? ((row: T) => readRowId(row, infinite?.idColumn));

  // A new page 1 is a load of the rows: edits made before it are in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page 1 takes a new tick
  const baseTick = useMemo(() => tick(), [initialRows]);

  const [restored] = useState(() =>
    enabled && navigationType === "POP"
      ? getInfiniteRows(companyId, storeKey)
      : undefined
  );
  const [initialLoaded] = useState<Loaded<T>>(() => ({
    resetKey,
    // Rows from memory may be stale: fetch them again (see the revalidation
    // effect below).
    baseRows: restored?.pages.length ? null : initialRows,
    pages: (restored?.pages ?? []) as InfinitePage<T>[],
    syncedAt: baseTick
  }));

  const loadedRef = useRef(initialLoaded);
  const [renderCount, render] = useReducer((count: number) => count + 1, 0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [failed, setFailedState] = useState<FailedTask | null>(null);
  const failedRef = useRef<FailedTask | null>(null);
  const setFailed = useCallback((task: FailedTask | null) => {
    failedRef.current = task;
    setFailedState(task);
  }, []);

  // The latest render's values, for async work that reads them after an await.
  const values = {
    infinite,
    initialRows,
    rowIdOf,
    resetKey,
    pageUrl,
    storeKey,
    companyId,
    load: fetcher.load,
    fetcherData: fetcher.data as unknown
  };
  const latest = useRef(values);
  latest.current = values;

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const requestIdRef = useRef(0);
  const requestRef = useRef<PendingRequest | null>(null);
  const taskRef = useRef<Promise<void>>(Promise.resolve());
  const busyRef = useRef(0);
  const refreshQueuedRef = useRef(false);
  const refreshesRef = useRef(0);
  const loadMoreQueuedRef = useRef(false);
  const loadMoreRef = useRef<() => void>(() => undefined);
  const scrollTopRef = useRef(restored?.scrollTop ?? 0);

  // Work that started before a reset or an unmount must not write.
  const isStale = useCallback(
    (generation: number) =>
      generation !== generationRef.current || !mountedRef.current,
    []
  );

  const currentPages = useCallback((): InfinitePage<T>[] => {
    const loaded = loadedRef.current;
    return loaded.resetKey === latest.current.resetKey ? loaded.pages : [];
  }, []);

  const currentNextCursor = useCallback((): string | null => {
    if (loadedRef.current.resetKey !== latest.current.resetKey) return null;
    const pages = loadedRef.current.pages;
    return pages.length > 0
      ? pages[pages.length - 1]!.nextCursor
      : (latest.current.infinite?.nextCursor ?? null);
  }, []);

  const currentRows = useCallback(
    (): T[] =>
      mergeRows(
        latest.current.initialRows,
        currentPages().flatMap((page) => page.rows),
        latest.current.rowIdOf
      ),
    [currentPages]
  );

  const save = useCallback(() => {
    const { infinite, companyId, storeKey, resetKey } = latest.current;
    if (!infinite || loadedRef.current.resetKey !== resetKey) return;
    saveInfiniteRows(companyId, storeKey, {
      pages: loadedRef.current.pages,
      scrollTop: scrollTopRef.current
    });
  }, []);

  const cancelPending = useCallback(() => {
    const request = requestRef.current;
    requestRef.current = null;
    request?.resolve({ status: "aborted" });
  }, []);

  // One request at a time: a new request ends the previous one as aborted.
  const fetchPage = useCallback(
    (cursor: string) =>
      new Promise<PageResult<T>>((resolve) => {
        cancelPending();
        requestIdRef.current += 1;
        const id = requestIdRef.current;
        requestRef.current = {
          id,
          cursor,
          dataAtStart: latest.current.fetcherData,
          loading: false,
          settled: false,
          resolve: resolve as PendingRequest["resolve"]
        };
        latest.current
          .load(getPageUrl(latest.current.pageUrl, cursor))
          .finally(() => {
            const request = requestRef.current;
            if (request?.id !== id) return;
            request.settled = true;
            render();
          });
      }),
    [cancelPending]
  );

  // Accept the fetcher's data only for the request this hook started. The
  // router also reloads mounted fetchers on revalidation; those results land
  // while no request is pending and are ignored.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderCount re-runs the check after a request settles
  useEffect(() => {
    const request = requestRef.current;
    if (!request) return;
    if (fetcher.state !== "idle") {
      request.loading = true;
      return;
    }
    if (!request.loading && !request.settled) return;
    requestRef.current = null;
    request.resolve(
      readPage(
        fetcher.data,
        request.dataAtStart,
        latest.current.infinite?.dataKey,
        request.cursor
      )
    );
  }, [fetcher.state, fetcher.data, renderCount]);

  // Work that fetches runs one task at a time, in order. A `loadMore` asked
  // for during a refresh runs when the queue is empty.
  const runTask = useCallback(
    (task: (generation: number) => Promise<unknown>): Promise<void> => {
      busyRef.current += 1;
      const run = taskRef.current
        .then(() => task(generationRef.current))
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          busyRef.current -= 1;
          if (busyRef.current === 0 && loadMoreQueuedRef.current) {
            loadMoreQueuedRef.current = false;
            loadMoreRef.current();
          }
        });
      taskRef.current = run;
      return run;
    },
    []
  );

  const appendNextPage = useCallback(
    async (generation: number): Promise<boolean> => {
      const cursor = currentNextCursor();
      if (!cursor) return true;

      setIsLoadingMore(true);
      const result = await fetchPage(cursor);
      setIsLoadingMore(false);
      if (isStale(generation)) return false;
      if (result.status !== "ok") {
        if (result.status === "error") setFailed("append");
        return false;
      }

      const loaded = loadedRef.current;
      loadedRef.current = {
        ...loaded,
        pages: [
          ...loaded.pages,
          { rows: result.rows, nextCursor: result.nextCursor }
        ]
      };
      save();
      render();
      return true;
    },
    [currentNextCursor, fetchPage, isStale, save, setFailed]
  );

  // Fetch the loaded pages again after a new page 1, with fresh cursors, and
  // swap them in at once. At most `MAX_REFRESH_PAGES` pages stay loaded; the
  // cursor then continues after the last one.
  const refresh = useCallback(
    async (generation: number) => {
      const startedAt = tick();
      const pagesToLoad = getRefreshPageCount(loadedRef.current.pages.length);
      let cursor = latest.current.infinite?.nextCursor ?? null;
      const pages: InfinitePage<T>[] = [];

      while (cursor && pages.length < pagesToLoad) {
        const result = await fetchPage(cursor);
        if (isStale(generation)) return;
        if (result.status !== "ok") {
          if (result.status === "error") setFailed("refresh");
          return;
        }
        pages.push({ rows: result.rows, nextCursor: result.nextCursor });
        cursor = result.nextCursor;
      }

      loadedRef.current = { ...loadedRef.current, pages, syncedAt: startedAt };
      if (failedRef.current === "refresh") setFailed(null);
      save();
      render();
    },
    [fetchPage, isStale, save, setFailed]
  );

  const scheduleRefresh = useCallback(() => {
    // Coalesce: one refresh waits at most, whatever the number of revalidations.
    if (refreshQueuedRef.current) return;
    refreshQueuedRef.current = true;
    refreshesRef.current += 1;
    void runTask(async (generation) => {
      refreshQueuedRef.current = false;
      try {
        await refresh(generation);
      } finally {
        refreshesRef.current -= 1;
      }
    });
  }, [refresh, runTask]);

  // Reset rule: a new filter, sort, search or view drops the loaded pages.
  useEffect(() => {
    if (loadedRef.current.resetKey === resetKey) return;
    generationRef.current += 1;
    cancelPending();
    loadMoreQueuedRef.current = false;
    loadedRef.current = {
      resetKey,
      baseRows: latest.current.initialRows,
      pages: [],
      syncedAt: tick()
    };
    setFailed(null);
    setIsLoadingMore(false);
    scrollTopRef.current = 0;
    render();
  }, [resetKey, cancelPending, setFailed]);

  // Revalidation rule: the same query with a new page 1 refreshes the later
  // pages too, so edits, new rows and deleted rows show up in place.
  useEffect(() => {
    if (!enabled) return;
    const loaded = loadedRef.current;
    if (loaded.resetKey !== resetKey || loaded.baseRows === initialRows) {
      return;
    }
    const hasPages = loaded.pages.length > 0;
    loadedRef.current = {
      ...loaded,
      baseRows: initialRows,
      syncedAt: hasPages ? loaded.syncedAt : baseTick
    };
    if (hasPages) scheduleRefresh();
  }, [enabled, initialRows, resetKey, baseTick, scheduleRefresh]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelPending();
      save();
    };
  }, [cancelPending, save]);

  const loadMore = useCallback(() => {
    if (!latest.current.infinite || failedRef.current) return;
    if (refreshesRef.current > 0) {
      loadMoreQueuedRef.current = true;
      return;
    }
    if (busyRef.current > 0 || !currentNextCursor()) return;
    void runTask(appendNextPage);
  }, [appendNextPage, currentNextCursor, runTask]);
  loadMoreRef.current = loadMore;

  const retry = useCallback(() => {
    const task = failedRef.current;
    if (!task) return;
    setFailed(null);
    if (task === "refresh") scheduleRefresh();
    else void runTask(appendNextPage);
  }, [appendNextPage, runTask, scheduleRefresh, setFailed]);

  const loadAll = useCallback(
    async (limit: number) => {
      if (latest.current.infinite) {
        setFailed(null);
        await runTask(async (generation) => {
          while (currentNextCursor() && currentRows().length < limit) {
            if (!(await appendNextPage(generation))) break;
          }
        });
      }
      return {
        rows: currentRows(),
        complete: currentNextCursor() === null,
        resetKey: latest.current.resetKey
      };
    },
    [appendNextPage, currentNextCursor, currentRows, runTask, setFailed]
  );

  const rememberScrollTop = useCallback((scrollTop: number) => {
    scrollTopRef.current = scrollTop;
  }, []);

  const loaded = loadedRef.current;
  const isCurrent = enabled && loaded.resetKey === resetKey;
  const laterPages = isCurrent ? loaded.pages : null;
  // The row id is read through a ref, so an inline getRowId does not rebuild the rows.
  const rows = useMemo(
    () =>
      laterPages?.length
        ? mergeRows(
            initialRows,
            laterPages.flatMap((page) => page.rows),
            latest.current.rowIdOf
          )
        : initialRows,
    [initialRows, laterPages]
  );
  const nextCursor = !enabled
    ? null
    : laterPages?.length
      ? laterPages[laterPages.length - 1]!.nextCursor
      : (infinite?.nextCursor ?? null);

  return {
    rows,
    hasMore: nextCursor !== null,
    isLoadingMore,
    loadError: failed !== null,
    loadMore,
    retry,
    loadAll,
    totalLoaded: rows.length,
    restoredScrollTop:
      restored && restored.scrollTop > 0 ? restored.scrollTop : null,
    rememberScrollTop,
    resetKey,
    syncedAt: laterPages?.length ? loaded.syncedAt : baseTick,
    options: infinite
  };
}

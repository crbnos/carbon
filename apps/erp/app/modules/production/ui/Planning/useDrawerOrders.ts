// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRevalidator } from "@carbon/query";
import { toast } from "@carbon/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawerPlannedOrder } from "~/modules/production/production.utils";
import type { PlanningAction } from "~/modules/production/types";

// What the production and purchasing order drawers, and their Planned Orders
// section, share around the orders they read: the edit overlay on a read,
// the read-only rows of actions whose order is not listed, the re-seed of the
// suggested orders, the cell save and the refetch after a plain fetch.

/**
 * Reads `query` again each time `key` changes: after a change the router
 * does not see (a plain fetch), since a router action already marks the read
 * stale. Not on mount, and not while `url` is null (the drawer is closed).
 */
export function useRefetchOnKey(
  query: { refetch: () => unknown },
  url: string | null,
  key: number
) {
  const { refetch } = query;
  const lastKey = useRef(key);
  useEffect(() => {
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (url) void refetch();
  }, [key, url, refetch]);
}

/**
 * A cell's saved edit, shown until the read that follows it lands. It is kept
 * against the answer it edited, never as a copy of the data, so a newer
 * answer replaces it. `editOf` names the edit a grid row holds (null for none)
 * and must keep its identity (declare it outside the component).
 *
 * `error` is the read's error as an `Error`, the same one while the read
 * fails.
 */
export function useAnswerOverlay<A, R, E extends object>(
  query: { data: A | undefined; error: unknown },
  editOf: (row: R) => readonly [id: string, edit: E] | null
) {
  const { data: answer, error } = query;
  const [edits, setEdits] = useState<{ of: A; byId: Map<string, E> } | null>(
    null
  );
  const readError = useMemo(
    () =>
      !error ? null : error instanceof Error ? error : new Error(String(error)),
    [error]
  );
  const editsById = answer && edits?.of === answer ? edits.byId : null;
  const keepEdits = useCallback(
    (rows: R[]) => {
      if (!answer) return;
      const byId = new Map<string, E>();
      for (const row of rows) {
        const entry = editOf(row);
        if (entry) byId.set(entry[0], entry[1]);
      }
      setEdits({ of: answer, byId });
    },
    [answer, editOf]
  );
  return { answer, error: readError, editsById, keepEdits };
}

/** The rows with their kept edits (`useAnswerOverlay`), each in place. */
export function withEdits<T extends object, E extends Partial<T>>(
  rows: T[],
  editsById: Map<string, E> | null,
  idOf: (row: T) => string
): T[] {
  if (!editsById) return rows;
  return rows.map((row) => {
    const edit = editsById.get(idOf(row));
    return edit ? { ...row, ...edit } : row;
  });
}

/**
 * The rows, plus a read-only row for each action whose order is not among
 * them (converted, deleted or released since MRP ran). A suggestion that
 * silently drops out of the drawer reads as "nothing to do".
 */
export function withOrphanActionRows<
  A extends { id: string },
  R extends { action: A | null }
>(rows: R[], actions: A[], toRow: (action: A) => R): R[] {
  const shown = new Set(
    rows.flatMap((row) => (row.action ? [row.action.id] : []))
  );
  const result = [...rows];
  for (const action of actions) {
    if (shown.has(action.id)) continue;
    shown.add(action.id);
    result.push(toRow(action));
  }
  return result;
}

/**
 * What a drawer does with its row's suggested orders: the version that closes
 * a cell editor left open when they are re-read, the re-seed after a change
 * that made them stale, the planned orders its Planned Orders section reads,
 * and the actions that sit on its open orders (one on a planned order sits on
 * that order's row in the Planned Orders grid instead).
 */
export function useDrawerSuggestions<R>(args: {
  row: R;
  actions: PlanningAction[];
  onSuggestionsStale: (row: R) => void;
  onPlannedOrdersLoaded: (row: R, orders: DrawerPlannedOrder[]) => void;
}) {
  const { row, actions, onSuggestionsStale, onPlannedOrdersLoaded } = args;
  const [suggestionsVersion, setSuggestionsVersion] = useState(0);
  const bumpSuggestionsVersion = useCallback(
    () => setSuggestionsVersion((version) => version + 1),
    []
  );
  const reseedSuggestions = useCallback(() => {
    onSuggestionsStale(row);
    bumpSuggestionsVersion();
  }, [onSuggestionsStale, row, bumpSuggestionsVersion]);
  const onPlannedOrdersRead = useCallback(
    (orders: DrawerPlannedOrder[]) => onPlannedOrdersLoaded(row, orders),
    [onPlannedOrdersLoaded, row]
  );
  const orderActions = useMemo(
    () => actions.filter((action) => !action.plannedOrderId),
    [actions]
  );
  return {
    suggestionsVersion,
    bumpSuggestionsVersion,
    reseedSuggestions,
    onPlannedOrdersRead,
    orderActions
  };
}

/** What a cell save's answer says. */
export type CellSaveOutcome =
  | { saved: true; warning?: string | null }
  | { saved: false; message?: string | null };

/**
 * One cell, one field, one request: the drawer's save of an open order's
 * cell. The route re-reads the record under the company and refuses one that
 * is committed, so a stale row cannot edit it. A save that went through
 * refetches the list it edited and revalidates the page: the post is a plain
 * fetch, which the router's invalidation does not see, and the grid row
 * behind the drawer would show the old value until the next navigation. A
 * warning (saved, but a follow-up step failed) is shown and the value kept.
 * Resolves `false` after reporting why, so the cell reverts.
 */
export function useSaveOrderCell<Row, Field extends string, Result>(args: {
  url: string;
  bodyOf: (
    row: Row,
    field: Field,
    value: number | string
  ) => Record<string, unknown>;
  outcomeOf: (ok: boolean, result: Result | null) => CellSaveOutcome;
  /** Shown when the answer gives no reason, and when the request fails. */
  failureMessage: string;
  /** Shows a refusal; an error toast by default. */
  reportFailure?: (message: string, result: Result | null) => void;
  refetch: () => unknown;
}) {
  const { revalidate } = useRevalidator();
  // The latest, so the editors (built once) save with the current values.
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });
  return useCallback(
    async (row: Row, field: Field, value: number | string) => {
      const { url, bodyOf, outcomeOf, failureMessage, reportFailure, refetch } =
        latest.current;
      try {
        const response = await fetch(url, {
          method: "post",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyOf(row, field, value))
        });
        const result = (await response
          .json()
          .catch(() => null)) as Result | null;
        const outcome = outcomeOf(response.ok, result);
        if (outcome.saved) {
          if (outcome.warning) toast.error(outcome.warning);
          void refetch();
          void revalidate();
          return true;
        }
        const message = outcome.message ?? failureMessage;
        if (reportFailure) reportFailure(message, result);
        else toast.error(message);
        return false;
      } catch {
        toast.error(failureMessage);
        return false;
      }
    },
    [revalidate]
  );
}

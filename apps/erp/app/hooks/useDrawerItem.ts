// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * Selection state for a drawer that shows one record picked from a list.
 *
 * Rendering the drawer as `{item && <Drawer />}` and clearing `item` to close
 * it removes the drawer in the same render, so its closing animation never
 * plays. Here the item outlives the close: `isOpen` drives the drawer, `item`
 * keeps its content on screen while it slides out, and `key` changes on every
 * open so each open still starts from a fresh drawer (local state, fetchers),
 * exactly as it did when closing unmounted it.
 */
export function useDrawerItem<T>() {
  const [item, setItem] = useState<T | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [key, setKey] = useState(0);

  const open = useCallback((next: T) => {
    setItem(next);
    setIsOpen(true);
    setKey((current) => current + 1);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  return { item, setItem, isOpen, key, open, close };
}

/**
 * `useDrawerItem` with the open record's id in the address (`?<param>=<id>`),
 * so a link to the page opens the same drawer.
 *
 * Opening and closing from the page update the drawer at once and the address
 * alongside it: the address is a navigation, and waiting for its loader would
 * make every click on a row lag. The address only drives the drawer when it
 * moves on its own — a pasted link, Back, Forward. An id that is not in `rows`
 * (deleted, another location) is dropped from the address, and the page shows
 * no drawer.
 */
export function useLinkedDrawerItem<T extends { id: string }>({
  param,
  rows
}: {
  param: string;
  /** Where a linked id is looked up. */
  rows: T[];
}) {
  const drawer = useDrawerItem<T>();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedId = searchParams.get(param);

  const setLinkedId = useCallback(
    (id: string | null, replace = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set(param, id);
          else next.delete(param);
          return next;
        },
        { replace, preventScrollReset: true }
      );
    },
    [param, setSearchParams]
  );

  const { open: openDrawer, close: closeDrawer } = drawer;

  const open = useCallback(
    (item: T) => {
      openDrawer(item);
      setLinkedId(item.id);
    },
    [openDrawer, setLinkedId]
  );

  const close = useCallback(() => {
    closeDrawer();
    setLinkedId(null);
  }, [closeDrawer, setLinkedId]);

  // Read by the effect below without re-running it: it must act on a change
  // of the address only. Re-running on the drawer's own state would close a
  // drawer opened a moment ago whose navigation has not landed yet.
  const latest = useRef({ drawer, rows });
  latest.current = { drawer, rows };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the address is the only trigger
  useEffect(() => {
    const { drawer: current, rows: currentRows } = latest.current;
    if (!linkedId) {
      if (current.isOpen) current.close();
      return;
    }
    if (current.isOpen && current.item?.id === linkedId) return;
    const row = currentRows.find((r) => r.id === linkedId);
    if (row) current.open(row);
    else setLinkedId(null, true);
  }, [linkedId]);

  return { ...drawer, open, close };
}

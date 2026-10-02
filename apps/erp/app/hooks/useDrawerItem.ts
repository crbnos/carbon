// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useState } from "react";

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

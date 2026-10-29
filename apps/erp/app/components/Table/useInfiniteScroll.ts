// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { clamp } from "@carbon/utils";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { PREFETCH_DISTANCE } from "./infiniteRowsStore";
import type { InfiniteRows } from "./types";

/**
 * The nearest ancestor that scrolls vertically. With `withOverflow`, only one
 * whose content already runs past its edge counts.
 */
export function findScrollParent(
  element: Element,
  { withOverflow = false }: { withOverflow?: boolean } = {}
): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    if (!withOverflow || node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** A scroll offset the element can actually reach. */
export function clampScrollTop(
  scrollTop: number,
  element: { scrollHeight: number; clientHeight: number }
): number {
  return clamp(
    scrollTop,
    0,
    Math.max(0, element.scrollHeight - element.clientHeight)
  );
}

type ScrollRoot = RefObject<HTMLElement | null> | HTMLElement | null | "auto";

function resolveRoot(root: ScrollRoot, sentinel: Element | null) {
  if (root === "auto") return sentinel ? findScrollParent(sentinel) : null;
  if (root && "current" in root) return root.current;
  return root;
}

/**
 * Infinite scroll for one list: an element at the end of the rows (the
 * sentinel) that loads the next page when it comes within 600px of the
 * scroll element's view. The sentinel stays in range while a short list
 * loads, so the list keeps loading until it fills the view.
 *
 * It also remembers the scroll offset for Back, puts it back once the
 * restored rows render, and scrolls to the top when the list's `resetKey`
 * changes (a new filter, sort or search).
 *
 * `root` is the scroll element, a ref to it, or "auto" (the nearest
 * scrolling ancestor of the sentinel). Returns the sentinel's ref.
 */
export function useInfiniteScroll(
  rows: InfiniteRows<unknown> | undefined,
  { root, enabled = true }: { root: ScrollRoot; enabled?: boolean }
) {
  const [sentinel, setSentinel] = useState<Element | null>(null);
  const [inView, setInView] = useState(false);
  const isOn = enabled && !!rows?.options;

  useEffect(() => {
    const element = resolveRoot(root, sentinel);
    if (!isOn || !sentinel || typeof IntersectionObserver === "undefined") {
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(!!entry?.isIntersecting),
      { root: element, rootMargin: `0px 0px ${PREFETCH_DISTANCE}px 0px` }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isOn, root, sentinel]);

  const hasMore = rows?.hasMore ?? false;
  const isLoadingMore = rows?.isLoadingMore ?? false;
  const loadError = rows?.loadError ?? false;
  const loadMore = rows?.loadMore;
  // biome-ignore lint/correctness/useExhaustiveDependencies: totalLoaded re-checks after each page renders
  useEffect(() => {
    if (inView && hasMore && !isLoadingMore && !loadError) loadMore?.();
  }, [inView, hasMore, isLoadingMore, loadError, loadMore, rows?.totalLoaded]);

  // The scroll offset, for Back.
  const rememberScrollTop = rows?.rememberScrollTop;
  useEffect(() => {
    const element = resolveRoot(root, sentinel);
    if (!isOn || !element || !rememberScrollTop) return;
    const onScroll = () => rememberScrollTop(element.scrollTop);
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [isOn, root, sentinel, rememberScrollTop]);

  // Back: put the offset back once the restored rows render. Fewer rows may
  // come back than were saved, so the offset stops at the end.
  const restoredScrollTop = rows?.restoredScrollTop ?? null;
  const hasRows = (rows?.totalLoaded ?? 0) > 0;
  const restoredRef = useRef(false);
  useEffect(() => {
    const element = resolveRoot(root, sentinel);
    if (restoredRef.current || restoredScrollTop === null || !element) return;
    if (!hasRows) return;
    restoredRef.current = true;
    element.scrollTop = clampScrollTop(restoredScrollTop, element);
  }, [root, sentinel, hasRows, restoredScrollTop]);

  // A new list starts at the top. A table that is not infinite keeps its
  // scroll: its reset key follows every search param, not only its own.
  const resetKey = rows?.resetKey;
  const resetKeyRef = useRef(resetKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list changes only
  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    if (!isOn) return;
    resolveRoot(root, sentinel)?.scrollTo({ top: 0 });
  }, [resetKey]);

  return setSentinel;
}

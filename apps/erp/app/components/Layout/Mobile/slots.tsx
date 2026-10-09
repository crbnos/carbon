// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useViewport } from "@carbon/react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

/**
 * A place in the shell that pages render into. A portal keeps the filler's
 * React context (forms, menus, route data). Phones only: on desktop `Fill`
 * renders nothing and the caller keeps its in-place copy.
 *
 * The slot owns its DOM element and `Target` only shows it, so filled content
 * never remounts when the place it shows in comes and goes (the ⋯ sheet
 * closing must not unmount a dialog an action opened).
 */
export function createPortalSlot() {
  let element: HTMLDivElement | null = null;
  const getElement = () => {
    element ??= document.createElement("div");
    return element;
  };
  const useCount = create<{ count: number; add: (delta: 1 | -1) => void }>()(
    (set) => ({
      count: 0,
      add: (delta) => set((s) => ({ count: Math.max(0, s.count + delta) }))
    })
  );

  /** `className` styles the slot's element; the host is `display: contents`. */
  function Target({ className }: { className?: string }) {
    const host = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const el = getElement();
      el.className = className ?? "";
      host.current?.appendChild(el);
      return () => el.remove();
    }, [className]);
    return <div ref={host} className="contents" />;
  }

  function Fill({ children }: { children: ReactNode }) {
    const { isPhone } = useViewport();
    // After hydration only: the server renders no portals.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const add = useCount((s) => s.add);
    useEffect(() => {
      if (!isPhone) return;
      add(1);
      return () => add(-1);
    }, [isPhone, add]);
    return isPhone && mounted ? createPortal(children, getElement()) : null;
  }

  const useFilled = () => useCount((s) => s.count > 0);

  return { Target, Fill, useFilled };
}

/**
 * Data a page hands the shell. The newest provider wins; unmounting removes
 * only its own entry. Callers memoize `value`: a new object re-provides it.
 */
export function createValueSlot<T>() {
  const useStore = create<{
    entries: { id: string; value: T }[];
    put: (id: string, value: T) => void;
    remove: (id: string) => void;
  }>()((set) => ({
    entries: [],
    put: (id, value) =>
      set((s) => ({
        entries: [...s.entries.filter((e) => e.id !== id), { id, value }]
      })),
    remove: (id) =>
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
  }));

  function useProvide(value: T | null) {
    const id = useId();
    const put = useStore((s) => s.put);
    const remove = useStore((s) => s.remove);
    useEffect(() => {
      if (value === null) return;
      put(id, value);
      return () => remove(id);
    }, [id, value, put, remove]);
  }

  const useValue = () => useStore((s) => s.entries.at(-1)?.value ?? null);

  return { useProvide, useValue };
}

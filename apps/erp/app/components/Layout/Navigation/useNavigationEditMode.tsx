// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useAllModules } from "~/hooks";
import { useUIStore } from "~/stores/ui";
import type { Authenticated, NavItem } from "~/types";
import { submoduleLayout } from "~/utils/submodule-visibility";

export type DraftModule = Authenticated<NavItem> & {
  key: string;
  position: number;
  hidden: boolean;
  hiddenSubmodules: string[];
  submoduleOrder: string[];
};

function isSameList(a: string[], b: string[]) {
  const other = new Set(b);
  return a.length === b.length && a.every((value) => other.has(value));
}

function isSameOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function useNavigationEditMode() {
  const allModules = useAllModules();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DraftModule[]>([]);

  // The rail reads `modulePreferences` from the app-shell loader
  // (`x+/_layout.tsx`), whose `shouldRevalidate` skips same-pathname GETs — so a
  // bare `revalidator.revalidate()` after save never re-ran it and the rail
  // reverted until a hard refresh. A fetcher POST presents as `formMethod:
  // "POST"`, which defeats that skip, so the shell reloads and the rail updates.
  const isSaving = fetcher.state !== "idle";

  const originalRef = useMemo(() => {
    return allModules.map((m, i) => ({
      ...m,
      position: m.position ?? i + 1,
      hidden: m.hidden ?? false
    }));
  }, [allModules]);

  const enterEditMode = useCallback(() => {
    setDraft(originalRef.map((m) => ({ ...m })));
    setIsEditing(true);
  }, [originalRef]);

  const cancelEditMode = useCallback(() => {
    setDraft([]);
    setIsEditing(false);
  }, []);

  const visibleDraft = useMemo(() => draft.filter((m) => !m.hidden), [draft]);

  const hiddenDraft = useMemo(() => draft.filter((m) => m.hidden), [draft]);

  const isDirty = useMemo(() => {
    if (draft.length === 0) return false;
    return draft.some((d) => {
      const orig = originalRef.find((o) => o.key === d.key);
      if (!orig) return true;
      return (
        d.position !== orig.position ||
        d.hidden !== orig.hidden ||
        !isSameList(d.hiddenSubmodules, orig.hiddenSubmodules) ||
        !isSameOrder(d.submoduleOrder, orig.submoduleOrder)
      );
    });
  }, [draft, originalRef]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setDraft((prev) => {
      const visible = prev.filter((m) => !m.hidden);
      const hidden = prev.filter((m) => m.hidden);

      const oldIndex = visible.findIndex((m) => m.key === active.id);
      const newIndex = visible.findIndex((m) => m.key === over.id);

      if (oldIndex === -1 || newIndex === -1) return prev;

      const reordered = arrayMove(visible, oldIndex, newIndex);

      const repositioned = reordered.map((m, i) => ({
        ...m,
        position: i + 1
      }));

      return [...repositioned, ...hidden];
    });
  }, []);

  const toggleHidden = useCallback((key: string) => {
    setDraft((prev) => {
      const updated = prev.map((m) =>
        m.key === key ? { ...m, hidden: !m.hidden } : m
      );
      const visible = updated.filter((m) => !m.hidden);
      const hidden = updated.filter((m) => m.hidden);
      return [...visible.map((m, i) => ({ ...m, position: i + 1 })), ...hidden];
    });
  }, []);

  const setSubmodulesHidden = useCallback(
    (moduleKey: string, keys: string[], hidden: boolean) => {
      setDraft((prev) =>
        prev.map((m) => {
          if (m.key !== moduleKey) return m;
          const others = m.hiddenSubmodules.filter((k) => !keys.includes(k));
          return {
            ...m,
            hiddenSubmodules: hidden ? [...others, ...keys] : others
          };
        })
      );
    },
    []
  );

  const setSubmoduleOrder = useCallback((moduleKey: string, keys: string[]) => {
    setDraft((prev) =>
      prev.map((m) =>
        m.key === moduleKey ? { ...m, submoduleOrder: keys } : m
      )
    );
  }, []);

  // The module sidebar is outside the rail, and it previews the unsaved layout.
  const setDraftSubmoduleLayout = useUIStore(
    (state) => state.setDraftSubmoduleLayout
  );
  useEffect(() => {
    setDraftSubmoduleLayout(isEditing ? submoduleLayout(draft) : null);
  }, [isEditing, draft, setDraftSubmoduleLayout]);

  const save = useCallback(() => {
    fetcher.submit(
      {
        preferences: draft.map((m) => ({
          module: m.key,
          position: m.position,
          hidden: m.hidden,
          hiddenSubmodules: m.hiddenSubmodules,
          submoduleOrder: m.submoduleOrder
        }))
      },
      {
        method: "post",
        action: "/api/module-preferences",
        encType: "application/json"
      }
    );
  }, [draft, fetcher]);

  // Leave edit mode only once the save has actually landed (state returned to
  // idle after being in-flight) and succeeded — so a failed save keeps the
  // draft open to retry, and re-entering edit mode later never trips this off a
  // stale `fetcher.data`.
  const wasSaving = useRef(false);
  useEffect(() => {
    if (fetcher.state !== "idle") {
      wasSaving.current = true;
      return;
    }
    if (wasSaving.current) {
      wasSaving.current = false;
      if (fetcher.data?.success) {
        setIsEditing(false);
        setDraft([]);
      }
    }
  }, [fetcher.state, fetcher.data]);

  return {
    isEditing,
    isSaving,
    isDirty,
    visibleDraft,
    hiddenDraft,
    enterEditMode,
    cancelEditMode,
    handleDragEnd,
    toggleHidden,
    setSubmodulesHidden,
    setSubmoduleOrder,
    save
  };
}

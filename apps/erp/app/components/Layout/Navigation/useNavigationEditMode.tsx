import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useAllModules } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";

export type DraftModule = Authenticated<NavItem> & {
  key: string;
  position: number;
  hidden: boolean;
};

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
      return d.position !== orig.position || d.hidden !== orig.hidden;
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

  const save = useCallback(() => {
    fetcher.submit(
      {
        preferences: draft.map((m) => ({
          module: m.key,
          position: m.position,
          hidden: m.hidden
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
    save
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { ReorderableLine } from "./types";

type Options<T extends ReorderableLine> = {
  actionPath: string;
  lines: T[];
  /** How to read the sort position off a line. Defaults to `line.sortOrder`. */
  getSortOrder?: (line: T) => number;
};

/**
 * Edit-mode state for drag-to-reorder line lists.
 *
 * Owns the draft order while the user reorders, debounceless save via a
 * react-router fetcher, Esc to cancel, and a `submittedRef` guard so a
 * leftover `fetcher.data.success` from a prior save doesn't auto-close a
 * fresh re-entry to edit mode.
 */
export function useLineOrderEditMode<T extends ReorderableLine>({
  actionPath,
  lines,
  getSortOrder = defaultGetSortOrder as (line: T) => number
}: Options<T>) {
  const fetcher = useFetcher<{ success?: boolean }>();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<T[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const isSaving = fetcher.state !== "idle";

  const original = useMemo(
    () => [...lines].sort((a, b) => getSortOrder(a) - getSortOrder(b)),
    [lines, getSortOrder]
  );

  const isDirty = useMemo(() => {
    if (draft.length !== original.length) return false;
    return draft.some((d, i) => d.id !== original[i]?.id);
  }, [draft, original]);

  const enterEditMode = useCallback(() => {
    setDraft(original.map((l) => ({ ...l })));
    setIsEditing(true);
  }, [original]);

  const cancelEditMode = useCallback(() => {
    setDraft([]);
    setActiveId(null);
    setIsEditing(false);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setDraft((prev) => {
      const oldIndex = prev.findIndex((l) => l.id === active.id);
      const newIndex = prev.findIndex((l) => l.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const save = useCallback(() => {
    if (!isDirty) return;
    const updates: Record<string, number> = {};
    draft.forEach((line, index) => {
      if (line.id) updates[line.id] = index + 1;
    });
    const formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    submittedRef.current = true;
    fetcher.submit(formData, { method: "post", action: actionPath });
  }, [actionPath, draft, fetcher, isDirty]);

  // Close edit mode once OUR save resolves. The ref makes sure we ignore
  // fetcher.data left over from a previous submission when re-entering edit mode.
  useEffect(() => {
    if (
      submittedRef.current &&
      fetcher.state === "idle" &&
      fetcher.data?.success
    ) {
      submittedRef.current = false;
      setDraft([]);
      setActiveId(null);
      setIsEditing(false);
    }
  }, [fetcher.data, fetcher.state]);

  // Esc cancels edit mode.
  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelEditMode();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isEditing, cancelEditMode]);

  const activeLine = useMemo(
    () => (activeId ? (draft.find((l) => l.id === activeId) ?? null) : null),
    [activeId, draft]
  );

  return {
    isEditing,
    isSaving,
    isDirty,
    draft,
    activeLine,
    enterEditMode,
    cancelEditMode,
    handleDragStart,
    handleDragEnd,
    save
  };
}

function defaultGetSortOrder(line: { sortOrder?: number | null }): number {
  return line.sortOrder ?? 0;
}

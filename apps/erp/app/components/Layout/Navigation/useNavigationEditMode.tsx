import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useMemo, useState } from "react";
import { useRevalidator } from "react-router";
import { useAllModules } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";

export type DraftModule = Authenticated<NavItem> & {
  key: string;
  position: number;
  hidden: boolean;
};

export function useNavigationEditMode() {
  const allModules = useAllModules();
  const revalidator = useRevalidator();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DraftModule[]>([]);
  const [isSaving, setIsSaving] = useState(false);

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

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/module-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: draft.map((m) => ({
            module: m.key,
            position: m.position,
            hidden: m.hidden
          }))
        })
      });

      if (!response.ok) {
        throw new Error("Failed to save preferences");
      }

      setIsEditing(false);
      setDraft([]);
      revalidator.revalidate();
    } finally {
      setIsSaving(false);
    }
  }, [draft, revalidator]);

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

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { clampSpacing, SPACING } from "./constants";
import type { LineagePayload } from "./utils";

export type LayoutDirection = "TB" | "LR";
export type ViewMode = "graph" | "table";

type TraceabilityState = {
  rootId: string | null;
  selectedIds: string[];
  focusedIndex: number;
  isolate: boolean;
  expansions: Map<string, LineagePayload>;
  expandable: Set<string>;
  exhausted: Set<string>;
  excludedIds: Set<string>;

  // persisted preferences
  direction: LayoutDirection;
  view: ViewMode;
  spacing: number;

  // actions
  reset: (rootId: string) => void;
  setSelectedIds: (ids: string[]) => void;
  setSelectedSingle: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  setFocusedIndex: (i: number) => void;
  setIsolate: (next: boolean) => void;
  addExpansion: (originId: string, payload: LineagePayload) => void;
  removeExpansion: (originId: string) => void;
  resetExpansions: () => void;
  markExpandable: (id: string) => void;
  markExhausted: (id: string) => void;
  toggleExcluded: (id: string) => void;
  clearExcluded: () => void;
  setDirection: (next: LayoutDirection) => void;
  setView: (next: ViewMode) => void;
  setSpacing: (next: number) => void;
};

export const useTraceabilityStore = create<TraceabilityState>()(
  persist(
    (set) => ({
      rootId: null,
      selectedIds: [],
      focusedIndex: 0,
      isolate: false,
      expansions: new Map(),
      expandable: new Set(),
      exhausted: new Set(),
      excludedIds: new Set(),
      direction: "TB",
      view: "graph",
      spacing: SPACING.default,

      reset: (rootId) =>
        set({
          rootId,
          selectedIds: [],
          focusedIndex: 0,
          isolate: false,
          expansions: new Map(),
          expandable: new Set(),
          exhausted: new Set(),
          excludedIds: new Set()
        }),

      setSelectedIds: (ids) =>
        set((s) => ({
          selectedIds: ids,
          focusedIndex:
            ids.length === 0 ? 0 : Math.min(s.focusedIndex, ids.length - 1)
        })),

      setSelectedSingle: (id) =>
        set({
          selectedIds: id ? [id] : [],
          focusedIndex: 0
        }),

      toggleSelected: (id) =>
        set((s) => {
          const next = s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id];
          return {
            selectedIds: next,
            focusedIndex:
              next.length === 0 ? 0 : Math.min(s.focusedIndex, next.length - 1)
          };
        }),

      setFocusedIndex: (i) => set({ focusedIndex: i }),

      setIsolate: (next) => set({ isolate: next }),

      addExpansion: (originId, payload) =>
        set((s) => {
          const next = new Map(s.expansions);
          next.set(originId, payload);
          return { expansions: next };
        }),

      removeExpansion: (originId) =>
        set((s) => {
          if (!s.expansions.has(originId)) return {};
          const next = new Map(s.expansions);
          next.delete(originId);
          return { expansions: next };
        }),

      resetExpansions: () => set({ expansions: new Map() }),

      markExpandable: (id) =>
        set((s) => {
          if (s.expandable.has(id)) return {};
          const next = new Set(s.expandable);
          next.add(id);
          return { expandable: next };
        }),

      markExhausted: (id) =>
        set((s) => {
          if (s.exhausted.has(id)) return {};
          const next = new Set(s.exhausted);
          next.add(id);
          return { exhausted: next };
        }),

      toggleExcluded: (id) =>
        set((s) => {
          const next = new Set(s.excludedIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { excludedIds: next };
        }),

      clearExcluded: () => set({ excludedIds: new Set() }),

      setDirection: (next) => set({ direction: next }),
      setView: (next) => set({ view: next }),
      setSpacing: (next) => set({ spacing: clampSpacing(next) })
    }),
    {
      name: "traceability:prefs:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        direction: s.direction,
        view: s.view,
        spacing: s.spacing
      })
    }
  )
);

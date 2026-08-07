import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EntityCluster } from "./cluster";
import { clampSpacing, SPACING } from "./constants";
import type { LineagePayload } from "./utils";

export type LayoutDirection = "TB" | "LR";
export type ViewMode = "graph" | "table";

type TraceabilityState = {
  rootId: string | null;
  isolate: boolean;
  expansions: Map<string, LineagePayload>;
  expandable: Set<string>;
  exhausted: Set<string>;
  excludedIds: Set<string>;
  additionalRootIds: Set<string>;

  /**
   * Serial clusters from the latest layout. The graph computes them (in the
   * worker, off the expansion-merged payload) but the sidebar is its SIBLING in
   * the route, not its child — so they travel through here rather than props.
   */
  clusters: EntityCluster[];
  memberToCluster: Record<string, string>;
  /** Member the sidebar should scroll to and highlight, set by search. */
  highlightMemberId: string | null;

  // persisted preferences
  direction: LayoutDirection;
  view: ViewMode;
  spacing: number;

  // actions
  reset: (rootId: string) => void;
  setIsolate: (next: boolean) => void;
  toggleAdditionalRoot: (id: string) => void;
  clearAdditionalRoots: () => void;
  addExpansion: (originId: string, payload: LineagePayload) => void;
  removeExpansion: (originId: string) => void;
  resetExpansions: () => void;
  markExpandable: (id: string) => void;
  markExhausted: (id: string) => void;
  toggleExcluded: (id: string) => void;
  clearExcluded: () => void;
  setClusters: (
    clusters: EntityCluster[],
    memberToCluster: Record<string, string>
  ) => void;
  setHighlightMember: (id: string | null) => void;
  setDirection: (next: LayoutDirection) => void;
  setView: (next: ViewMode) => void;
  setSpacing: (next: number) => void;
};

export const useTraceabilityStore = create<TraceabilityState>()(
  persist(
    (set) => ({
      rootId: null,
      isolate: false,
      expansions: new Map(),
      expandable: new Set(),
      exhausted: new Set(),
      excludedIds: new Set(),
      additionalRootIds: new Set(),
      clusters: [],
      memberToCluster: {},
      highlightMemberId: null,
      direction: "TB",
      view: "graph",
      spacing: SPACING.default,

      reset: (rootId) =>
        set({
          rootId,
          isolate: false,
          expansions: new Map(),
          expandable: new Set(),
          exhausted: new Set(),
          excludedIds: new Set(),
          additionalRootIds: new Set(),
          clusters: [],
          memberToCluster: {},
          highlightMemberId: null
        }),

      setIsolate: (next) => set({ isolate: next }),

      toggleAdditionalRoot: (id) =>
        set((s) => {
          const next = new Set(s.additionalRootIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { additionalRootIds: next };
        }),

      clearAdditionalRoots: () =>
        set((s) =>
          s.additionalRootIds.size === 0 ? {} : { additionalRootIds: new Set() }
        ),

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

      // Keep the same Set when there's nothing to clear. Every plain node click
      // calls this, and a fresh empty Set is a new identity — enough to re-run
      // the async selection pathfinder and repaint the graph for nothing.
      clearExcluded: () =>
        set((s) =>
          s.excludedIds.size === 0 ? {} : { excludedIds: new Set() }
        ),

      setClusters: (clusters, memberToCluster) =>
        set((s) =>
          s.clusters === clusters ? {} : { clusters, memberToCluster }
        ),

      setHighlightMember: (id) =>
        set((s) =>
          s.highlightMemberId === id ? {} : { highlightMemberId: id }
        ),

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

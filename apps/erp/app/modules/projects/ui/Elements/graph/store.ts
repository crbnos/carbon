// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GraphDirection = "LR" | "TB";

type ProjectGraphState = {
  /** Elements whose subtree is hidden. */
  collapsed: string[];
  direction: GraphDirection;
  toggleCollapsed: (id: string) => void;
  setDirection: (direction: GraphDirection) => void;
};

const stores = new Map<string, UseBoundStore<StoreApi<ProjectGraphState>>>();

/**
 * The Tree layout's state for one project: the collapsed elements and the
 * direction, kept in local storage under `project-graph:<projectId>`.
 */
export function getProjectGraphStore(projectId: string) {
  let store = stores.get(projectId);
  if (!store) {
    store = create<ProjectGraphState>()(
      persist(
        (set) => ({
          collapsed: [],
          direction: "LR",
          toggleCollapsed: (id) =>
            set((state) => ({
              collapsed: state.collapsed.includes(id)
                ? state.collapsed.filter((c) => c !== id)
                : [...state.collapsed, id]
            })),
          setDirection: (direction) => set({ direction })
        }),
        {
          name: `project-graph:${projectId}`,
          partialize: (state) => ({
            collapsed: state.collapsed,
            direction: state.direction
          })
        }
      )
    );
    stores.set(projectId, store);
  }
  return store;
}

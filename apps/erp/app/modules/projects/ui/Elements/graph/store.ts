// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type ProjectGraphState = {
  /** Elements whose subtree is hidden. */
  collapsed: string[];
  toggleCollapsed: (id: string) => void;
};

const stores = new Map<string, UseBoundStore<StoreApi<ProjectGraphState>>>();

/**
 * The Tree layout's state for one project: the collapsed elements, kept in
 * local storage under `project-graph:<projectId>`.
 */
export function getProjectGraphStore(projectId: string) {
  let store = stores.get(projectId);
  if (!store) {
    store = create<ProjectGraphState>()(
      persist(
        (set) => ({
          collapsed: [],
          toggleCollapsed: (id) =>
            set((state) => ({
              collapsed: state.collapsed.includes(id)
                ? state.collapsed.filter((c) => c !== id)
                : [...state.collapsed, id]
            }))
        }),
        {
          name: `project-graph:${projectId}`,
          partialize: (state) => ({ collapsed: state.collapsed })
        }
      )
    );
    stores.set(projectId, store);
  }
  return store;
}

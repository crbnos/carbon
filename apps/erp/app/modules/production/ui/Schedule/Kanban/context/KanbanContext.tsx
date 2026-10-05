// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import type { DisplaySettings } from "../types";

interface KanbanContextType {
  displaySettings: DisplaySettings;
  selectedGroup: string | null;
  setSelectedGroup: (jobId: string | null) => void;
  tags: { name: string }[];
  columnIds?: string[];
}

const KanbanContext = createContext<KanbanContextType | null>(null);

interface KanbanProviderProps {
  children: ReactNode;
  displaySettings: DisplaySettings;
  selectedGroup: string | null;
  setSelectedGroup: (jobId: string | null) => void;
  tags: { name: string }[];
  columnIds?: string[];
}

export function KanbanProvider({
  children,
  displaySettings,
  selectedGroup,
  setSelectedGroup,
  tags,
  columnIds
}: KanbanProviderProps) {
  // The board passes its display settings as a fresh object on every render;
  // every card reads this context, so an unstable value re-renders them all.
  const settingsKey = JSON.stringify(displaySettings);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by value
  const stableSettings = useMemo(() => displaySettings, [settingsKey]);
  const value = useMemo(
    () => ({
      displaySettings: stableSettings,
      selectedGroup,
      setSelectedGroup,
      tags,
      columnIds
    }),
    [stableSettings, selectedGroup, setSelectedGroup, tags, columnIds]
  );

  return (
    <KanbanContext.Provider value={value}>{children}</KanbanContext.Provider>
  );
}

export function useKanban() {
  const context = useContext(KanbanContext);
  if (!context) {
    throw new Error("useKanban must be used within a KanbanProvider");
  }
  return context;
}

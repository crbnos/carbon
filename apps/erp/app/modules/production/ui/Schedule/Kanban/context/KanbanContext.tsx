// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
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
  return (
    <KanbanContext.Provider
      value={{
        displaySettings,
        selectedGroup,
        setSelectedGroup,
        tags,
        columnIds
      }}
    >
      {children}
    </KanbanContext.Provider>
  );
}

export function useKanban() {
  const context = useContext(KanbanContext);
  if (!context) {
    throw new Error("useKanban must be used within a KanbanProvider");
  }
  return context;
}

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { DisplaySettings } from "../types";

/** Tap-to-move for a card (phones): its target columns and the drop's move. */
export type KanbanMoveTo = {
  targetsFor: (itemId: string) => { id: string; title: string }[];
  onMove: (itemId: string, columnId: string) => void;
};

interface KanbanContextType {
  displaySettings: DisplaySettings;
  selectedGroup: string | null;
  setSelectedGroup: (jobId: string | null) => void;
  tags: { name: string }[];
  columnIds?: string[];
  moveTo?: KanbanMoveTo;
}

const KanbanContext = createContext<KanbanContextType | null>(null);

interface KanbanProviderProps {
  children: ReactNode;
  displaySettings: DisplaySettings;
  selectedGroup: string | null;
  setSelectedGroup: (jobId: string | null) => void;
  tags: { name: string }[];
  columnIds?: string[];
  moveTo?: KanbanMoveTo;
}

export function KanbanProvider({
  children,
  displaySettings,
  selectedGroup,
  setSelectedGroup,
  tags,
  columnIds,
  moveTo
}: KanbanProviderProps) {
  return (
    <KanbanContext.Provider
      value={{
        displaySettings,
        selectedGroup,
        setSelectedGroup,
        tags,
        columnIds,
        moveTo
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

import { createContext, useContext, type ReactNode } from "react";
import type { DisplaySettings } from "../types";

interface KanbanContextType {
  displaySettings: DisplaySettings;
  selectedGroup: string | null;
  setSelectedGroup: (jobId: string | null) => void;
  tags: { name: string }[];
}

const KanbanContext = createContext<KanbanContextType | null>(null);

interface KanbanProviderProps {
  children: ReactNode;
  displaySettings: DisplaySettings;
  selectedGroup: string | null;
  setSelectedGroup: (jobId: string | null) => void;
  tags: { name: string }[];
}

export function KanbanProvider({
  children,
  displaySettings,
  selectedGroup,
  setSelectedGroup,
  tags,
}: KanbanProviderProps) {
  return (
    <KanbanContext.Provider
      value={{
        displaySettings,
        selectedGroup,
        setSelectedGroup,
        tags,
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

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { replaceEqualDeep } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useRef } from "react";
import type { DisplaySettings } from "../types";
import { useScheduleToday } from "../useScheduleToday";

interface KanbanContextType {
  displaySettings: DisplaySettings;
  selectedGroup: string | null;
  setSelectedGroup: (jobId: string | null) => void;
  tags: { name: string }[];
  columnIds?: string[];
  /** Today on the board's calendar; see `useScheduleToday`. */
  scheduleToday: string;
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
  // Every card reads this context, so its value must change only when its
  // contents do. The board passes the display settings as a fresh object on
  // every render, and a reload hands over a new `tags` array.
  const stableSettings = useStable(displaySettings);
  const stableTags = useStable(tags);
  const stableColumnIds = useStable(columnIds);
  // Read once for the board. In each card it subscribed the card to the
  // router: every fetcher and revalidation state change re-rendered them all.
  const scheduleToday = useScheduleToday();
  const value = useMemo(
    () => ({
      displaySettings: stableSettings,
      selectedGroup,
      setSelectedGroup,
      tags: stableTags,
      columnIds: stableColumnIds,
      scheduleToday
    }),
    [
      stableSettings,
      selectedGroup,
      setSelectedGroup,
      stableTags,
      stableColumnIds,
      scheduleToday
    ]
  );

  return (
    <KanbanContext.Provider value={value}>{children}</KanbanContext.Provider>
  );
}

/** The previous value for as long as the new one is deeply equal to it. */
function useStable<T>(value: T): T {
  const ref = useRef(value);
  ref.current = replaceEqualDeep(ref.current, value);
  return ref.current;
}

export function useKanban() {
  const context = useContext(KanbanContext);
  if (!context) {
    throw new Error("useKanban must be used within a KanbanProvider");
  }
  return context;
}

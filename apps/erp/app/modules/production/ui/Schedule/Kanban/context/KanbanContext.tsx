// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { replaceEqualDeep } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useRef } from "react";
import type { DisplaySettings } from "../types";
import { useScheduleToday } from "../useScheduleToday";

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
  // Every card reads this context, so its value must change only when its
  // contents do. The board passes the display settings as a fresh object on
  // every render, and a reload hands over a new `tags` array.
  const stableSettings = useStable(displaySettings);
  const stableTags = useStable(tags);
  const stableColumnIds = useStable(columnIds);
  // Read once for the board. In each card it subscribed the card to the
  // router: every fetcher and revalidation state change re-rendered them all.
  const scheduleToday = useScheduleToday();
  // The board builds `moveTo` on every render; cards call it lazily (when the
  // menu opens or a target is picked), so read the latest one through a ref.
  const moveToRef = useRef(moveTo);
  moveToRef.current = moveTo;
  const hasMoveTo = !!moveTo;
  const stableMoveTo = useMemo<KanbanMoveTo | undefined>(
    () =>
      hasMoveTo
        ? {
            targetsFor: (itemId) => moveToRef.current?.targetsFor(itemId) ?? [],
            onMove: (itemId, columnId) =>
              moveToRef.current?.onMove(itemId, columnId)
          }
        : undefined,
    [hasMoveTo]
  );
  const value = useMemo(
    () => ({
      displaySettings: stableSettings,
      selectedGroup,
      setSelectedGroup,
      tags: stableTags,
      columnIds: stableColumnIds,
      moveTo: stableMoveTo,
      scheduleToday
    }),
    [
      stableSettings,
      selectedGroup,
      setSelectedGroup,
      stableTags,
      stableColumnIds,
      stableMoveTo,
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

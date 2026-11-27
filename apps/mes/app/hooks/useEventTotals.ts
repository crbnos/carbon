// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useInterval } from "@carbon/react";
import { getLocalTimeZone, now } from "@internationalized/date";
import { useState } from "react";
import {
  type EventTotals,
  getEventTotals,
  type TimedEvent
} from "~/utils/eventTime";

type WorkType = "Setup" | "Labor" | "Machine";

// Live per-work-type totals (only `employeeId`'s when given); ticks while an event is open, and `frozen` holds the last value.
export function useEventTotals(
  events: TimedEvent[],
  frozen = false,
  employeeId?: string
): EventTotals {
  const [timeNow, setTimeNow] = useState(() => now(getLocalTimeZone()));
  const running = events.some((e) => !e.endTime);
  useInterval(
    () => setTimeNow(now(getLocalTimeZone())),
    running && !frozen ? 1000 : null
  );
  return getEventTotals(events, timeNow, employeeId);
}

// The timer button: one work type's time logged by this operator plus their running time.
export function useWorkTypeElapsed({
  events,
  workType,
  openEvent,
  employeeId,
  frozen = false
}: {
  events: TimedEvent[];
  workType: WorkType;
  openEvent: { id: string; startTime: string } | null;
  employeeId: string;
  frozen?: boolean;
}) {
  // A just-started event can reach `openEvent` before it reaches `events`.
  const timed =
    openEvent && !events.some((e) => e.id === openEvent.id)
      ? [
          ...events,
          {
            id: openEvent.id,
            type: workType,
            startTime: openEvent.startTime,
            endTime: null,
            duration: null,
            employeeId
          }
        ]
      : events;
  const totals = useEventTotals(timed, frozen, employeeId);
  return totals[workType.toLowerCase() as keyof EventTotals];
}

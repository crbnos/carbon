import { useRouteData } from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { path } from "~/utils/path";

/**
 * Today's `YYYY-MM-DD` on the schedule board's location calendar — the same
 * timezone the dates board resolves in its loader. Falls back to the viewer's
 * local calendar when the card renders outside that route (e.g. the
 * operations board). Compare against date-only columns with plain string
 * comparison — never `new Date(dueDate) < new Date()`, which reads a date as
 * midnight UTC and flags jobs due today as overdue for viewers behind UTC.
 */
export function useScheduleToday(): string {
  const data = useRouteData<{ timezone?: string }>(path.to.scheduleDates);
  return today(data?.timezone ?? getLocalTimeZone()).toString();
}

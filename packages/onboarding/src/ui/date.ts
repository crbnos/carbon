import { type CalendarDate, parseDate } from "@internationalized/date";

// Stored field values are `YYYY-MM-DD`; the Carbon DatePicker speaks CalendarDate.
// Returns undefined for empty/malformed input so the picker shows no selection.
export function toCalendarDate(
  value: string | undefined
): CalendarDate | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  try {
    return parseDate(value);
  } catch {
    return undefined;
  }
}

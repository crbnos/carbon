import { parseDate } from "@internationalized/date";
import {
  getDueDateForColumn,
  isDateColumnId,
  isDateColumnSentinel
} from "../../../production.models";

export { getDueDateForColumn, isDateColumnId, isDateColumnSentinel };

export function getPendingDueDate(
  persistenceColumnId: string | null | undefined
): string | null | undefined {
  if (!persistenceColumnId) return undefined;
  return getDueDateForColumn(persistenceColumnId);
}

export function getDateOnly(value?: string | null): string | null {
  return value?.split("T")[0] ?? null;
}

type DueDateUpdateItem = {
  id: string;
  columnId: string;
  priority: number;
};

/** Build the inline due-date request from the current board context. */
export function getInlineDueDateUpdateFields(
  item: DueDateUpdateItem,
  locationId: string,
  nextDueDate: string | null,
  columnIds: readonly string[]
) {
  const columnId = nextDueDate
    ? nextDueDate
    : getEmptyDueDateColumnId(columnIds, item.columnId);
  const optimisticColumnId = nextDueDate
    ? getOptimisticColumnId(nextDueDate, columnIds)
    : columnId;

  return {
    id: item.id,
    locationId,
    columnId,
    optimisticColumnId,
    priority: item.priority
  };
}

/**
 * Map a persisted due date to the visible Dates board column. Week columns
 * represent exact dates; month columns represent seven-day buckets.
 */
export function getOptimisticColumnId(
  dueDate: string,
  columnIds: readonly string[]
): string {
  if (columnIds.includes(dueDate)) return dueDate;

  if (columnIds.includes("next-week")) return "next-week";

  if (columnIds.includes("next-month")) {
    let selectedDate: ReturnType<typeof parseDate>;
    try {
      selectedDate = parseDate(dueDate);
    } catch {
      return "next-month";
    }

    const dateColumns = columnIds
      .filter(isDateColumnId)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    for (const columnId of dateColumns) {
      const weekStart = parseDate(columnId);
      const weekEnd = weekStart.add({ days: 6 });

      if (
        selectedDate.compare(weekStart) >= 0 &&
        selectedDate.compare(weekEnd) <= 0
      ) {
        return columnId;
      }
    }

    return "next-month";
  }

  return dueDate;
}

/** Pick the canonical null-producing sentinel when an inline date is cleared. */
export function getEmptyDueDateColumnId(
  columnIds: readonly string[],
  fallbackColumnId: string
): string {
  if (columnIds.includes("next-week")) return "next-week";
  if (columnIds.includes("next-month")) return "next-month";
  return fallbackColumnId;
}

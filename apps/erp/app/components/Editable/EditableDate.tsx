// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DatePicker } from "@carbon/react";
import type { CalendarDate } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { FocusEvent } from "react";
import { useRef } from "react";
import type { EditableTableCellComponentProps } from "~/components/Editable";

/** A `YYYY-MM-DD` cell value as a picker date; anything else is empty. */
function toCalendarDate(value: unknown): CalendarDate | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return null;
  }
  try {
    return parseDate(value.slice(0, 10));
  } catch {
    return null;
  }
}

/**
 * An inline-editable date cell — EditableNumber's contract for a calendar
 * date. The value is a `YYYY-MM-DD` string and the mutation receives one.
 *
 * Typing a date changes the value one segment at a time, and every
 * intermediate value is a real date, so the cell commits ONCE — when focus
 * leaves it (the Table blurs the editor before moving on Tab / Enter) or the
 * calendar closes — never on each change. `minValue` / `maxValue` bound the
 * picker per row. `clearable` lets an emptied cell commit `""`.
 */
const EditableDate = <T extends object>(
  mutation: (
    accessorKey: string,
    newValue: string,
    row: T
  ) => Promise<PostgrestSingleResponse<unknown>>,
  options?: {
    clearable?: boolean;
    /** The accessible name of the picker (the column's header). */
    label?: string;
    bounds?: (row: T) => { minValue?: string; maxValue?: string };
  }
) => {
  const EditableDateEditor = ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate
  }: EditableTableCellComponentProps<T>) => {
    const original = toCalendarDate(value)?.toString() ?? null;
    const latest = useRef<string | null>(original);
    const committed = useRef(false);
    const bounds = options?.bounds?.(row);

    const commit = () => {
      if (committed.current) return;
      const next = latest.current;
      if (next === original) return;
      if (next === null && !options?.clearable) return;
      committed.current = true;

      onUpdate({ [accessorKey]: next });
      mutation(accessorKey, next ?? "", row)
        .then(({ error }) => {
          if (error) {
            onError();
            onUpdate({ [accessorKey]: value });
          }
        })
        .catch(() => {
          onError();
          onUpdate({ [accessorKey]: value });
        });
    };

    // Focus moving into the calendar popover (portaled outside the cell) is
    // still editing; anywhere else ends it.
    const onBlur = (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as HTMLElement | null;
      if (next && event.currentTarget.contains(next)) return;
      if (next?.closest("[data-radix-popper-content-wrapper]")) return;
      commit();
    };

    return (
      <div className="w-full" onBlur={onBlur}>
        <DatePicker
          autoFocus
          size="sm"
          aria-label={options?.label}
          defaultValue={toCalendarDate(value)}
          minValue={toCalendarDate(bounds?.minValue) ?? undefined}
          maxValue={toCalendarDate(bounds?.maxValue) ?? undefined}
          closeOnSelect
          onChange={(date) => {
            latest.current = date ? date.toString() : null;
          }}
          onOpenChange={(isOpen) => {
            if (!isOpen) commit();
          }}
        />
      </div>
    );
  };

  return EditableDateEditor;
};

export default EditableDate;

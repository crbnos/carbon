// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DatePicker } from "@carbon/react";
import type { CalendarDate } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { useRef } from "react";
import type { EditableTableCellComponentProps } from "~/components/Editable";

/**
 * A calendar-date cell for `Grid` / inline-editing `Table`: the sibling of
 * `EditableNumber`, same contract. The value is an ISO `YYYY-MM-DD` string and
 * stays one — the date commits optimistically and runs `mutation`; a failed
 * mutation reverts the cell and marks it.
 *
 * Like `EditableNumber`, the cell commits when focus LEAVES it, and also when
 * the calendar closes (a picked day closes it). It used to commit on every
 * change of the field: once the field held a full date, each key press was a
 * change, so typing a year saved 0002, 0020 and 0202 first — each one a
 * request, and each job save a schedule refresh.
 *
 * An empty date is only committed when `clearable` is set: most date cells
 * (a due date, a required date) are not optional, and react-aria reports a
 * half-typed date as `null` too.
 */
/** A `YYYY-MM-DD` value as a picker date; anything else is empty. */
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
    /** Per-row bounds, as `YYYY-MM-DD`. */
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
    const { t } = useLingui();
    // a timestamp column would carry a time part; a calendar date is its head
    const current = toCalendarDate(value)?.toString() ?? null;
    const bounds = options?.bounds?.(row);

    // The field's latest value; `committed` is what the cell last saved, so
    // the blur that follows a closed calendar does not save the day twice.
    const latest = useRef<string | null>(current);
    const committed = useRef<string | null>(current);

    const commit = () => {
      const next = latest.current;
      if (next === committed.current) return;
      if (next === null && !options?.clearable) return;
      committed.current = next;

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

    return (
      // The selected cell already draws the ring. The picker's own border and
      // focus halo on top of it read as a doubled, blurry edge, so the field
      // group goes edgeless here — as EditableNumber's input does.
      <div
        className="[&_[role=group]]:rounded-none [&_[role=group]]:border-transparent [&_[role=group]]:shadow-none [&_[role=group]:focus-within]:border-transparent [&_[role=group]:focus-within]:ring-0"
        // Focus moving between the date segments and the calendar button stays
        // inside; the calendar itself is portaled, so opening it commits what
        // was typed so far (a half-typed date is null and is not saved).
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            commit();
          }
        }}
      >
        <DatePicker
          aria-label={options?.label ?? t`Date`}
          size="sm"
          autoFocus
          closeOnSelect
          defaultValue={current ? parseDate(current) : null}
          minValue={toCalendarDate(bounds?.minValue) ?? undefined}
          maxValue={toCalendarDate(bounds?.maxValue) ?? undefined}
          onChange={(next) => {
            latest.current = next ? next.toString() : null;
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

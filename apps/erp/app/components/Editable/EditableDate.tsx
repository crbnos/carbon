// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DatePicker } from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { EditableTableCellComponentProps } from "~/components/Editable";

/**
 * A calendar-date cell for `Grid` / inline-editing `Table`: the sibling of
 * `EditableNumber`, same contract. The value is an ISO `YYYY-MM-DD` string and
 * stays one — picking or typing a full date commits it optimistically and runs
 * `mutation`; a failed mutation reverts the cell and marks it.
 *
 * An empty date is only committed when `clearable` is set: most date cells
 * (a due date, a required date) are not optional, and react-aria reports a
 * half-typed date as `null` too.
 */
const EditableDate = <T extends object>(
  mutation: (
    accessorKey: string,
    newValue: string,
    row: T
  ) => Promise<PostgrestSingleResponse<unknown>>,
  options?: { clearable?: boolean }
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
    const current =
      typeof value === "string" && value.length >= 10
        ? value.slice(0, 10)
        : null;

    const commit = (next: string | null) => {
      if (next === current) return;
      if (next === null && !options?.clearable) return;

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
      <div className="[&_[role=group]]:rounded-none [&_[role=group]]:border-transparent [&_[role=group]]:shadow-none [&_[role=group]:focus-within]:border-transparent [&_[role=group]:focus-within]:ring-0">
        <DatePicker
          aria-label={t`Date`}
          size="sm"
          autoFocus
          closeOnSelect
          value={current ? parseDate(current) : null}
          onChange={(next) => commit(next ? next.toString() : null)}
        />
      </div>
    );
  };

  return EditableDateEditor;
};

export default EditableDate;

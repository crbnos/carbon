/* eslint-disable react/display-name */

import { DateTimePicker } from "@carbon/react";
import type { DateValue } from "@internationalized/date";
import { getLocalTimeZone, parseAbsolute } from "@internationalized/date";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { EditableTableCellComponentProps } from "~/components/Editable";

const EditableDateTime =
  <T extends object>(
    mutation: (
      accessorKey: string,
      newValue: string,
      row: T
    ) => Promise<PostgrestSingleResponse<unknown>>
  ) =>
  ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate,
  }: EditableTableCellComponentProps<T>) => {
    const defaultValue = (
      typeof value === "string"
        ? parseAbsolute(value, getLocalTimeZone())
        : value
    ) as DateValue | null | undefined;

    const updateDate = async (newValue: DateValue) => {
      // this is the optimistic update on the FE
      onUpdate({ [accessorKey]: newValue.toString() });

      // this is the actual update on the BE
      mutation(accessorKey, newValue.toString(), row)
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
      <DateTimePicker
        className="w-full rounded-none outline-none border-none focus-visible:ring-0"
        defaultValue={defaultValue}
        onChange={updateDate}
        autoFocus
        withButton={false}
      />
    );
  };

export default EditableDateTime;

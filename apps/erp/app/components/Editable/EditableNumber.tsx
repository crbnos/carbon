import type { NumberFieldProps } from "@carbon/react";
import { NumberField, NumberInput } from "@carbon/react";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { EditableTableCellComponentProps } from "~/components/Editable";

const EditableNumber =
  <T extends object>(
    mutation: (
      accessorKey: string,
      newValue: string,
      row: T
    ) => Promise<PostgrestSingleResponse<unknown>>,
    numberFieldProps?: NumberFieldProps,
    // `clearable` lets an empty input persist as a cleared value (sent as "") so
    // a nullable column can be reset. Off by default so non-nullable columns keep
    // ignoring empty input.
    options?: { clearable?: boolean }
  ) =>
  ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate
  }: EditableTableCellComponentProps<T>) => {
    return (
      <NumberField
        {...numberFieldProps}
        value={value as number}
        onChange={(numberValue) => {
          const isEmpty = !Number.isFinite(numberValue);
          if (isEmpty) {
            // Ignore empty unless clearable, and skip the no-op re-clear of an
            // already-empty cell.
            if (!options?.clearable || value === null || value === undefined)
              return;
          } else if (numberValue === value) {
            return;
          }

          onUpdate({ [accessorKey]: isEmpty ? null : numberValue });

          // @ts-ignore - mutation receives the raw cell value ("" clears)
          mutation(accessorKey, isEmpty ? "" : numberValue, row)
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
        }}
      >
        <NumberInput
          size="sm"
          className="w-full rounded-none outline-none border-none shadow-none focus-visible:ring-0"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
        />
      </NumberField>
    );
  };

export default EditableNumber;

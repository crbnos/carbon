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
    numberFieldProps?: NumberFieldProps
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
          if (!Number.isFinite(numberValue) || numberValue === value) return;

          onUpdate({ [accessorKey]: numberValue });

          // @ts-ignore
          mutation(accessorKey, numberValue, row)
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

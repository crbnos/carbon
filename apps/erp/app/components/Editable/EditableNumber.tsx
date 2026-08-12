import type { NumberFieldProps } from "@carbon/react";
import { NumberField, NumberInput } from "@carbon/react";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { useRef } from "react";
import type { EditableTableCellComponentProps } from "~/components/Editable";

const EditableNumber = <T extends object>(
  mutation: (
    accessorKey: string,
    newValue: string,
    row: T
  ) => Promise<PostgrestSingleResponse<unknown>>,
  numberFieldProps?: NumberFieldProps | ((row: T) => NumberFieldProps),
  options?: { clearable?: boolean }
) => {
  const EditableNumberEditor = ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate
  }: EditableTableCellComponentProps<T>) => {
    const resolvedProps =
      typeof numberFieldProps === "function"
        ? numberFieldProps(row)
        : numberFieldProps;

    const numericValue =
      value === null || value === undefined || value === ""
        ? undefined
        : Number(value);

    const latestValue = useRef<number | undefined>(numericValue);

    const clamp = (n: number) => {
      const { minValue, maxValue } = resolvedProps ?? {};
      let v = n;
      if (typeof maxValue === "number") v = Math.min(v, maxValue);
      if (typeof minValue === "number") v = Math.max(v, minValue);
      return v;
    };

    const commit = (raw: number | undefined) => {
      const isEmpty = raw === undefined || !Number.isFinite(raw);
      const next = isEmpty ? null : clamp(raw as number);
      if (next === (numericValue ?? null)) return;
      if (
        isEmpty &&
        (!options?.clearable || value === null || value === undefined)
      )
        return;

      onUpdate({ [accessorKey]: next });

      // @ts-ignore
      mutation(accessorKey, isEmpty ? "" : next, row)
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
      <NumberField
        {...resolvedProps}
        defaultValue={numericValue}
        onChange={(next) => {
          latestValue.current = Number.isNaN(next) ? undefined : next;
          resolvedProps?.onChange?.(next);
        }}
      >
        <NumberInput
          size="sm"
          className="w-full rounded-none outline-none border-none shadow-none focus-visible:ring-0"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => commit(latestValue.current)}
        />
      </NumberField>
    );
  };

  return EditableNumberEditor;
};

export default EditableNumber;

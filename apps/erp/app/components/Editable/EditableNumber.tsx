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
    // Static props, or a function of the row for per-row limits (e.g. a serial
    // line's `maxValue: 1`).
    numberFieldProps?: NumberFieldProps | ((row: T) => NumberFieldProps),
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
    const resolvedProps =
      typeof numberFieldProps === "function"
        ? numberFieldProps(row)
        : numberFieldProps;

    // Postgres NUMERIC columns arrive as strings over the wire — coerce for the
    // NumberField's initial (uncontrolled) value.
    const numericValue =
      value === null || value === undefined || value === ""
        ? undefined
        : Number(value);

    const clamp = (n: number) => {
      const { minValue, maxValue } = resolvedProps ?? {};
      let v = n;
      if (typeof maxValue === "number") v = Math.min(v, maxValue);
      if (typeof minValue === "number") v = Math.max(v, minValue);
      return v;
    };

    // Push an edit into the table's state model + persist it.
    const commit = (raw: number | undefined) => {
      const isEmpty = raw === undefined || !Number.isFinite(raw);
      const next = isEmpty ? null : clamp(raw as number);
      // Nothing changed (or an ignorable empty on a non-clearable/empty cell).
      if (next === (numericValue ?? null)) return;
      if (
        isEmpty &&
        (!options?.clearable || value === null || value === undefined)
      )
        return;

      onUpdate({ [accessorKey]: next });

      // @ts-ignore - mutation receives the raw cell value ("" clears)
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
      // UNCONTROLLED (`defaultValue`, not `value`): the editing input only mounts
      // for the selected cell and the surrounding page re-renders often, which
      // would reset a controlled value mid-edit. react-aria's `onChange` commits
      // on blur/Enter — but moving to another cell UNMOUNTS this input, and the
      // unmount races that commit so it never fires. The DOM `onBlur` on the raw
      // input fires synchronously before the unmount, so it is the reliable path
      // that syncs the edit into the table's state model.
      <NumberField {...resolvedProps} defaultValue={numericValue}>
        <NumberInput
          size="sm"
          className="w-full rounded-none outline-none border-none shadow-none focus-visible:ring-0"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const text = (e.currentTarget.value ?? "").trim();
            // Empty or unparseable → no value (commit guards against a stray 0).
            const parsed = text === "" ? Number.NaN : Number(text);
            commit(Number.isNaN(parsed) ? undefined : parsed);
          }}
        />
      </NumberField>
    );
  };

export default EditableNumber;

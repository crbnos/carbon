/* eslint-disable react/display-name */
import { Combobox } from "@carbon/react";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { EditableTableCellComponentProps } from "~/components/Editable";

const EditableList =
  <T extends object>(
    mutation: (
      accessorKey: string,
      newValue: string,
      row: T
    ) => Promise<PostgrestSingleResponse<unknown>>,
    options: { label: string; value: string }[]
  ) =>
  ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate,
  }: EditableTableCellComponentProps<T>) => {
    const onChange = async (newValue: string) => {
      // this is the optimistic update on the FE
      onUpdate({ [accessorKey]: newValue });

      // the is the actual update on the BE
      mutation(accessorKey, newValue, row)
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
      <Combobox
        autoFocus
        className="rounded-none"
        value={options.find((option) => option.value === value)?.value}
        options={options}
        onChange={onChange}
        size="sm"
      />
    );
  };

export default EditableList;

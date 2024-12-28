/* eslint-disable react/display-name */
import { Input } from "@carbon/react";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { FocusEvent, KeyboardEvent } from "react";
import type { EditableTableCellComponentProps } from "~/components/Editable";

const EditableText =
  <T extends object>(
    mutation: (
      accessorKey: string,
      newValue: string,
      row: T
    ) => Promise<PostgrestSingleResponse<null>>
  ) =>
  ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate,
  }: EditableTableCellComponentProps<T>) => {
    const updateText = async (newValue: string) => {
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

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      // only run the update if they click enter
      if (event.key === "Enter" || event.key === "Tab") {
        if (event.currentTarget.value !== value) {
          updateText(event.currentTarget.value);
        }
      }
    };

    // run update if focus is lost
    const onBlur = (event: FocusEvent<HTMLInputElement>) => {
      if (event.currentTarget.value !== value) {
        updateText(event.currentTarget.value);
      }
    };

    // eslint-disable-next-line jsx-a11y/no-autofocus
    return (
      <Input
        autoFocus
        defaultValue={value as string}
        className="border-0 rounded-none w-full"
        size="sm"
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
    );
  };

export default EditableText;

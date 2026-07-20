import { Input } from "@carbon/react";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { FocusEvent } from "react";
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
    onUpdate
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

    // Blur is the single commit path: the containers (Table/Grid) blur the
    // input before navigating on Tab/Enter, and click-away blurs natively. A
    // keydown commit on top of this would double-fire the mutation.
    const onBlur = (event: FocusEvent<HTMLInputElement>) => {
      if (event.currentTarget.value !== value) {
        updateText(event.currentTarget.value);
      }
    };

    return (
      <Input
        autoFocus
        defaultValue={value as string}
        className="border-0 rounded-none w-full shadow-none"
        size="sm"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={onBlur}
      />
    );
  };

export default EditableText;

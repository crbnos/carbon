import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getItemPostingGroupsList } from "~/modules/items";
import ItemPostingGroupForm from "~/modules/items/ui/ItemPostingGroups/ItemPostingGroupForm";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type ItemPostingGroupSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
};

const ItemPostingGroupPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const itemGroup = options.find((o) => o.value === value);
  return itemGroup?.label ?? null;
};

const ItemPostingGroup = (props: ItemPostingGroupSelectProps) => {
  const newItemPostingGroupModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useItemPostingGroups();

  const emptyMessage = useEmptyState("itemPostingGroup", {
    onCreate: () => newItemPostingGroupModal.onOpen()
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={
          options.map((o) => ({
            value: o.value,
            label: <Enumerable value={o.label} />
          })) ?? []
        }
        emptyMessage={emptyMessage}
        {...props}
        inline={props.inline ? ItemPostingGroupPreview : undefined}
        label={props?.label ?? "Posting Group"}
        onCreateOption={(option) => {
          newItemPostingGroupModal.onOpen();
          setCreated(option);
        }}
      />
      {newItemPostingGroupModal.isOpen && (
        <ItemPostingGroupForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemPostingGroupModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created
          }}
        />
      )}
    </>
  );
};

ItemPostingGroup.displayName = "ItemPostingGroup";

export default ItemPostingGroup;

export const useItemPostingGroups = () => {
  const itemGroupFetcher =
    useFetcher<Awaited<ReturnType<typeof getItemPostingGroupsList>>>();

  useMount(() => {
    itemGroupFetcher.load(path.to.api.itemPostingGroups);
  });

  const options = useMemo(
    () =>
      itemGroupFetcher.data?.data
        ? itemGroupFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name
          }))
        : [],
    [itemGroupFetcher.data]
  );

  return options;
};

import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import type { getItemPostingGroupsList } from "~/modules/items";
import { ItemPostingGroupForm } from "~/modules/items";
import { path } from "~/utils/path";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type ItemPostingGroupSelectProps = Omit<ComboboxProps, "options">;

const ItemPostingGroup = (props: ItemPostingGroupSelectProps) => {
  const newItemPostingGroupModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useItemPostingGroups();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
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
            name: created,
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
            label: c.name,
          }))
        : [],
    [itemGroupFetcher.data]
  );

  return options;
};

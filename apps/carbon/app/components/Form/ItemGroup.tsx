import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import type { getItemGroupsList } from "~/modules/parts";
import { ItemGroupForm } from "~/modules/parts";
import { path } from "~/utils/path";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type ItemGroupSelectProps = Omit<ComboboxProps, "options">;

const ItemGroup = (props: ItemGroupSelectProps) => {
  const newItemGroupModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useItemGroups();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Item Group"}
        onCreateOption={(option) => {
          newItemGroupModal.onOpen();
          setCreated(option);
        }}
      />
      {newItemGroupModal.isOpen && (
        <ItemGroupForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemGroupModal.onClose();
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

ItemGroup.displayName = "ItemGroup";

export default ItemGroup;

export const useItemGroups = () => {
  const itemGroupFetcher =
    useFetcher<Awaited<ReturnType<typeof getItemGroupsList>>>();

  useMount(() => {
    itemGroupFetcher.load(path.to.api.itemGroups);
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

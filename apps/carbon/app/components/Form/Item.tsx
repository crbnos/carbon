import type { Database } from "@carbon/database";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { PartForm, ToolForm } from "~/modules/items";
import { useItems } from "~/stores";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type ItemSelectProps = Omit<ComboboxProps, "options" | "type"> & {
  type: Database["public"]["Enums"]["itemType"];
};

const Item = ({ type, ...props }: ItemSelectProps) => {
  const [items] = useItems();
  const newItemsModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(
    () =>
      items
        .filter((item) => item.type === type)
        .map((item) => ({
          value: item.id,
          label: item.readableId,
          helper: item.name,
        })) ?? [],
    [items, type]
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Item"}
        onCreateOption={(option) => {
          newItemsModal.onOpen();
          setCreated(option);
        }}
      />
      {type === "Part" && newItemsModal.isOpen && (
        <PartForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            name: created,
            description: "",
            itemInventoryType: "Inventory",
            replenishmentSystem: "Buy and Make",
            unitOfMeasureCode: "EA",
            blocked: false,
            active: true,
          }}
        />
      )}
      {type === "Tool" && newItemsModal.isOpen && (
        <ToolForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            name: created,
            description: "",
            itemInventoryType: "Inventory",
            unitOfMeasureCode: "EA",
            blocked: false,
            active: true,
          }}
        />
      )}
    </>
  );
};

Item.displayName = "Item";

export default Item;

import type { Database } from "@carbon/database";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import {
  ConsumableForm,
  FixtureForm,
  MaterialForm,
  PartForm,
  ToolForm,
} from "~/modules/items";
import { useItems } from "~/stores";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type ItemSelectProps = Omit<ComboboxProps, "options" | "type"> & {
  type: Database["public"]["Enums"]["itemType"];
  disabledItems?: string[];
  includeInactive?: boolean;
  replenishmentSystem?: string;
};

const Item = ({ type, ...props }: ItemSelectProps) => {
  const [items] = useItems();
  const newItemsModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(() => {
    const results =
      (props?.replenishmentSystem || props?.includeInactive !== true
        ? items.filter(
            (item) =>
              item.type === type &&
              item.replenishmentSystem === props.replenishmentSystem &&
              (item.active === true || props?.includeInactive === true)
          )
        : items
      )
        .filter((item) => item.type === type)
        .map((item) => ({
          value: item.id,
          label: item.readableId,
          helper: item.name,
        })) ?? [];
    if (props.disabledItems) {
      return results.filter(
        (item) => !props.disabledItems?.includes(item.value)
      );
    }

    return results;
  }, [
    items,
    props?.includeInactive,
    props.disabledItems,
    props.replenishmentSystem,
    type,
  ]);

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
            itemTrackingType: "Inventory",
            replenishmentSystem: "Make",
            unitOfMeasureCode: "EA",
            defaultMethodType: "Make",
            active: props?.includeInactive === undefined,
          }}
        />
      )}
      {type === "Consumable" && newItemsModal.isOpen && (
        <ConsumableForm
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
            itemTrackingType: "Non-Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            defaultMethodType: "Buy",
            active: props?.includeInactive === undefined,
          }}
        />
      )}
      {type === "Fixture" && newItemsModal.isOpen && (
        <FixtureForm
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
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Make",
            defaultMethodType: "Buy",
            active: props?.includeInactive === undefined,
          }}
        />
      )}
      {type === "Material" && newItemsModal.isOpen && (
        <MaterialForm
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
            materialFormId: "",
            materialSubstanceId: "",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            defaultMethodType: "Buy",
            active: props?.includeInactive === undefined,
          }}
        />
      )}
      {/* TODO: Add service */}
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
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            defaultMethodType: "Buy",
            active: props?.includeInactive === undefined,
          }}
        />
      )}
    </>
  );
};

Item.displayName = "Item";

export default Item;

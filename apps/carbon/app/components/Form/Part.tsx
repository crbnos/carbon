import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { PartForm, type ItemReplenishmentSystem } from "~/modules/items";
import { useParts } from "~/stores";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type PartSelectProps = Omit<ComboboxProps, "options"> & {
  partReplenishmentSystem?: ItemReplenishmentSystem;
};

const Part = ({ partReplenishmentSystem, ...props }: PartSelectProps) => {
  const parts = useParts();
  const newPartsModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(
    () =>
      parts.map((part) => ({
        value: part.id,
        label: part.id,
        helper: part.name,
      })) ?? [],
    [parts]
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Part"}
        onCreateOption={(option) => {
          newPartsModal.onOpen();
          setCreated(option);
        }}
      />
      {newPartsModal.isOpen && (
        <PartForm
          type="modal"
          onClose={() => {
            setCreated("");
            newPartsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            name: created,
            description: "",
            itemInventoryType: "Inventory" as "Inventory",
            replenishmentSystem: partReplenishmentSystem ?? "Buy and Make",
            unitOfMeasureCode: "EA",
            pullFromInventory: false,
            active: true,
          }}
        />
      )}
    </>
  );
};

Part.displayName = "Part";

export default Part;

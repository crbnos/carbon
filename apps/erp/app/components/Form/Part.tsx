import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import type { ItemReplenishmentSystem } from "~/modules/items";
import PartForm from "~/modules/items/ui/Parts/PartForm";
import { useParts } from "~/stores";

type PartSelectProps = Omit<ComboboxProps, "options"> & {
  itemReplenishmentSystem?: ItemReplenishmentSystem;
};

const Part = ({ itemReplenishmentSystem, ...props }: PartSelectProps) => {
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
            revision: "0",
            name: created,
            description: "",
            itemTrackingType: "Inventory" as "Inventory",
            replenishmentSystem: itemReplenishmentSystem ?? "Buy and Make",
            defaultMethodType: "Buy",
            unitOfMeasureCode: "EA",
            unitCost: 0,
            lotSize: 0,
            active: true,
          }}
        />
      )}
    </>
  );
};

Part.displayName = "Part";

export default Part;

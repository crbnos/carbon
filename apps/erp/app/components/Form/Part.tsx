// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
import type { ItemReplenishmentSystem } from "~/modules/items/types";
import PartForm from "~/modules/items/ui/Parts/PartForm";
import { useParts } from "~/stores";
import { ItemLifecycleBadge } from "../ItemLifecycleBadge";
import { useEmptyState } from "./emptyStates";

type PartSelectProps = Omit<ComboboxProps, "options"> & {
  itemReplenishmentSystem?: ItemReplenishmentSystem;
};

const Part = ({ itemReplenishmentSystem, ...props }: PartSelectProps) => {
  const parts = useParts();
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(
    () =>
      parts.map((part) => ({
        value: part.id,
        label: part.supersessionMode ? (
          <span className="flex items-center gap-1.5">
            {part.id}
            <ItemLifecycleBadge mode={part.supersessionMode} />
          </span>
        ) : (
          part.id
        ),
        helper: part.name
      })) ?? [],
    [parts]
  );

  const emptyMessage = useEmptyState("part", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Part"}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <PartForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            id: "",
            revision: "0",
            name: create.item,
            description: "",
            itemTrackingType: "Inventory" as "Inventory",
            replenishmentSystem: itemReplenishmentSystem ?? "Buy and Make",
            defaultMethodType: "Pull from Inventory",
            unitOfMeasureCode: "EA",
            unitCost: 0,
            lotSize: 0,
            shelfLifeCalculateFromBom: false
          }}
        />
      )}
    </>
  );
};

Part.displayName = "Part";

export default Part;

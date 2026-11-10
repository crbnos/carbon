// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
import SupplierForm from "~/modules/purchasing/ui/Supplier/SupplierForm";
import { useSuppliers } from "~/stores";
import SupplierAvatar from "../SupplierAvatar";
import { useEmptyState } from "./emptyStates";

type SupplierSelectProps = Omit<CreatableMultiSelectProps, "options"> & {
  processId?: string;
};

const Suppliers = (props: SupplierSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [suppliers] = useSuppliers();
  const options = useMemo(() => {
    return (
      suppliers.map((c) => ({
        value: c.id,
        label: <SupplierAvatar supplierId={c.id} />,
        keywords: c.name
      })) ?? []
    );
  }, [suppliers]);

  const emptyMessage = useEmptyState("supplier", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Work Center"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <SupplierForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item
          }}
        />
      )}
    </>
  );
};

Suppliers.displayName = "Supplier";

export default Suppliers;

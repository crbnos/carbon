// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useRef } from "react";
import { useDrawerItem } from "~/hooks";
import { CustomerTypeForm } from "~/modules/sales/ui/CustomerTypes";
import { useCustomerTypes } from "./CustomerType";
import { useEmptyState } from "./emptyStates";

type CustomerTypesSelectProps = Omit<CreatableMultiSelectProps, "options">;

const CustomerTypes = (props: CustomerTypesSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useCustomerTypes();

  const emptyMessage = useEmptyState("customerType", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options ?? []}
        {...props}
        label={props?.label ?? "Customer Types"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <CustomerTypeForm
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

CustomerTypes.displayName = "CustomerTypes";

export default CustomerTypes;

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem, usePermissions } from "~/hooks";
import type { getShippingMethodsList } from "~/modules/inventory/inventory.service";
import ShippingMethodForm from "~/modules/inventory/ui/ShippingMethods/ShippingMethodForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type ShippingMethodSelectProps = Omit<ComboboxProps, "options">;

const ShippingMethod = (props: ShippingMethodSelectProps) => {
  const options = useShippingMethod();
  const permissions = usePermissions();

  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const emptyMessage = useEmptyState("shippingMethod", {
    onCreate: () => create.open("")
  });

  return permissions.can("create", "inventory") ? (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Shipping Method"}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <ShippingMethodForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item,
            carrier: "" as "FedEx"
          }}
        />
      )}
    </>
  ) : (
    <Combobox
      options={options}
      emptyMessage={emptyMessage}
      {...props}
      label={props?.label ?? "Shipping Method"}
    />
  );
};

ShippingMethod.displayName = "ShippingMethod";

export default ShippingMethod;

export const useShippingMethod = () => {
  const shippingMethodFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getShippingMethodsList>>
  >(path.to.api.shippingMethods);

  const options = useMemo(() => {
    return (shippingMethodFetcher.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [shippingMethodFetcher.data?.data]);

  return options;
};

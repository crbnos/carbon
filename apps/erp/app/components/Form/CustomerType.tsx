// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useDrawerItem } from "~/hooks";
import type { getCustomerTypesList } from "~/modules/sales/sales.service";
import { CustomerTypeForm } from "~/modules/sales/ui/CustomerTypes";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type CustomerTypeSelectProps = Omit<ComboboxProps, "options"> & {
  exclude?: string[];
};

const CustomerType = (props: CustomerTypeSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useCustomerTypes();

  const emptyMessage = useEmptyState("customerType", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={(props.exclude?.length
          ? options.filter((o) => !props.exclude!.includes(o.value))
          : options
        ).map((o) => ({
          value: o.value,
          label: <Enumerable value={o.label} />
        }))}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "CustomerType"}
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

CustomerType.displayName = "CustomerType";

export default CustomerType;

export const useCustomerTypes = (enabled = true) => {
  const customerTypeFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getCustomerTypesList>>
  >(enabled ? path.to.api.customerTypes : null);

  const options = useMemo(() => {
    const dataSource = customerTypeFetcher.data?.data ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [customerTypeFetcher.data?.data]);

  return options;
};

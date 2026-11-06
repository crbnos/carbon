// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useMemo, useRef } from "react";
import { useDrawerItem, useUser } from "~/hooks";
import CustomerForm from "~/modules/sales/ui/Customer/CustomerForm";
import { useCustomers } from "~/stores";
import CustomerAvatar from "../CustomerAvatar";
import { useEmptyState } from "./emptyStates";

type CustomerSelectProps = Omit<CreatableMultiSelectProps, "options">;

const Customers = (props: CustomerSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [customers] = useCustomers();
  const { company } = useUser();

  const options = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: <CustomerAvatar customerId={c.id} />,
        keywords: c.name
      })) ?? [],
    [customers]
  );

  const emptyMessage = useEmptyState("customer", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Customers"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <CustomerForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item,
            currencyCode: company.baseCurrencyCode,
            taxPercent: 0
          }}
        />
      )}
    </>
  );
};

Customers.displayName = "Customers";

export default Customers;

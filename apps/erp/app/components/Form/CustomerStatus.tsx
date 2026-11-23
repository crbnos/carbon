// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { asColor } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useDrawerItem, useRouteData } from "~/hooks";
import type { getCustomerStatusesList } from "~/modules/sales/sales.service";
import type { CustomerStatus as CustomerStatusStatus } from "~/modules/sales/types";
import CustomerStatusForm from "~/modules/sales/ui/CustomerStatuses/CustomerStatusForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type CustomerStatusSelectProps = Omit<ComboboxProps, "options">;

const CustomerStatus = (props: CustomerStatusSelectProps) => {
  const { t } = useLingui();
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useCustomerStatuses();

  const emptyMessage = useEmptyState("customerStatus", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={
          options.map((o) => ({
            value: o.value,
            label: <Enumerable value={o.label} color={o.color} />
          })) ?? []
        }
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? t`Customer Status`}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <CustomerStatusForm
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

CustomerStatus.displayName = "CustomerStatus";

export default CustomerStatus;

export const useCustomerStatuses = (enabled = true) => {
  const sharedCustomerData = useRouteData<{
    customerStatuses: CustomerStatusStatus[];
  }>(path.to.customerRoot);

  const hasCustomerData = sharedCustomerData?.customerStatuses;

  const customerStatusFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getCustomerStatusesList>>
  >(enabled && !hasCustomerData ? path.to.api.customerStatuses : null);

  const options = useMemo(() => {
    const dataSource =
      (hasCustomerData
        ? sharedCustomerData.customerStatuses
        : customerStatusFetcher.data?.data) ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name,
      color: asColor(c.color)
    }));
  }, [
    customerStatusFetcher.data?.data,
    hasCustomerData,
    sharedCustomerData?.customerStatuses
  ]);

  return options;
};

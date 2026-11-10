// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useDrawerItem } from "~/hooks";
import type { getSupplierTypesList } from "~/modules/purchasing/purchasing.service";
import SupplierTypeForm from "~/modules/purchasing/ui/SupplierTypes/SupplierTypeForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type SupplierTypeSelectProps = Omit<ComboboxProps, "options">;

const SupplierType = (props: SupplierTypeSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useSupplierTypes();

  const emptyMessage = useEmptyState("supplierType", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={
          options.map((o) => ({
            value: o.value,
            label: <Enumerable value={o.label} />
          })) ?? []
        }
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "SupplierType"}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <SupplierTypeForm
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

SupplierType.displayName = "SupplierType";

export default SupplierType;

export const useSupplierTypes = () => {
  const supplierTypeFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getSupplierTypesList>>
  >(path.to.api.supplierTypes);

  const options = useMemo(() => {
    const dataSource = supplierTypeFetcher.data?.data ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [supplierTypeFetcher.data?.data]);

  return options;
};

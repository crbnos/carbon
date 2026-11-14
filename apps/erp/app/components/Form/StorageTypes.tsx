// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
import type { getStorageTypesList } from "~/modules/inventory/inventory.service";
import StorageTypeForm from "~/modules/inventory/ui/StorageTypes/StorageTypeForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type StorageTypesSelectProps = Omit<CreatableMultiSelectProps, "options">;

const StorageTypes = (props: StorageTypesSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useStorageTypes();

  const emptyMessage = useEmptyState("storageType", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Storage Types"}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <StorageTypeForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{ name: create.item, nonNettable: false }}
        />
      )}
    </>
  );
};

export const useStorageTypes = () => {
  const storageTypes = useLoaderQuery<
    Awaited<ReturnType<typeof getStorageTypesList>>
  >(path.to.api.storageTypes);

  const options = useMemo(() => {
    return (storageTypes.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [storageTypes.data?.data]);

  return options;
};

export default StorageTypes;

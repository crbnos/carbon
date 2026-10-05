// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import type { getStorageTypesList } from "~/modules/inventory";
import StorageTypeForm from "~/modules/inventory/ui/StorageTypes/StorageTypeForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type StorageTypesSelectProps = Omit<CreatableMultiSelectProps, "options">;

const StorageTypes = (props: StorageTypesSelectProps) => {
  const newTypeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useStorageTypes();

  const emptyMessage = useEmptyState("storageType", {
    onCreate: () => newTypeModal.onOpen()
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
          newTypeModal.onOpen();
          setCreated(option);
        }}
      />
      {newTypeModal.isOpen && (
        <StorageTypeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newTypeModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{ name: created }}
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

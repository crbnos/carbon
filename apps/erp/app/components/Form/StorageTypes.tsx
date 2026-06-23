import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
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
  const storageTypes =
    useFetcher<Awaited<ReturnType<typeof getStorageTypesList>>>();

  useMount(() => {
    storageTypes.load(path.to.api.storageTypes);
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    storageTypes.load(path.to.api.storageTypes);
  }, []);

  const options = useMemo(() => {
    return (storageTypes.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [storageTypes.data?.data]);

  return options;
};

export default StorageTypes;

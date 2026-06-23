import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import type { getSupplierTypesList } from "~/modules/purchasing";
import SupplierTypeForm from "~/modules/purchasing/ui/SupplierTypes/SupplierTypeForm";

import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type SupplierTypeSelectProps = Omit<ComboboxProps, "options">;

const SupplierType = (props: SupplierTypeSelectProps) => {
  const newSupplierTypeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useSupplierTypes();

  const emptyMessage = useEmptyState("supplierType", {
    onCreate: () => newSupplierTypeModal.onOpen()
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
          newSupplierTypeModal.onOpen();
          setCreated(option);
        }}
      />
      {newSupplierTypeModal.isOpen && (
        <SupplierTypeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newSupplierTypeModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created
          }}
        />
      )}
    </>
  );
};

SupplierType.displayName = "SupplierType";

export default SupplierType;

export const useSupplierTypes = () => {
  const supplierTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierTypesList>>>();

  useMount(() => {
    supplierTypeFetcher.load(path.to.api.supplierTypes);
  });

  const options = useMemo(() => {
    const dataSource = supplierTypeFetcher.data?.data ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [supplierTypeFetcher.data?.data]);

  return options;
};

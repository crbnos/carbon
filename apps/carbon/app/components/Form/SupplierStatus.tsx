import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { useRouteData } from "~/hooks";
import type {
  SupplierStatus as SupplierStatusStatus,
  getSupplierStatusesList,
} from "~/modules/purchasing";
import { SupplierStatusForm } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierStatusSelectProps = Omit<ComboboxProps, "options">;

const SupplierStatus = (props: SupplierStatusSelectProps) => {
  const newSupplierStatusModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useSupplierStatuses();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "SupplierStatus"}
        onCreateOption={(option) => {
          newSupplierStatusModal.onOpen();
          setCreated(option);
        }}
      />
      {newSupplierStatusModal.isOpen && (
        <SupplierStatusForm
          type="modal"
          onClose={() => {
            setCreated("");
            newSupplierStatusModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
          }}
        />
      )}
    </>
  );
};

SupplierStatus.displayName = "SupplierStatus";

export default SupplierStatus;

export const useSupplierStatuses = () => {
  const supplierStatusFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierStatusesList>>>();

  const sharedSupplierData = useRouteData<{
    supplierStatuses: SupplierStatusStatus[];
  }>(path.to.supplierRoot);

  const hasSupplierData = sharedSupplierData?.supplierStatuses;

  useMount(() => {
    if (!hasSupplierData)
      supplierStatusFetcher.load(path.to.api.supplierStatuses);
  });

  const options = useMemo(() => {
    const dataSource =
      (hasSupplierData
        ? sharedSupplierData.supplierStatuses
        : supplierStatusFetcher.data?.data) ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [
    supplierStatusFetcher.data?.data,
    hasSupplierData,
    sharedSupplierData?.supplierStatuses,
  ]);

  return options;
};

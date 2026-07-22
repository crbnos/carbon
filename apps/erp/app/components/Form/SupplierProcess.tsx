import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import type { getSupplierProcessesByProcess } from "~/modules/purchasing";
import { SupplierProcessForm } from "~/modules/purchasing/ui/Supplier";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { cachedApiQuery, supplierProcessesQuery } from "~/utils/react-query";
import { useEmptyState } from "./emptyStates";

type SupplierProcessRow = NonNullable<
  Awaited<ReturnType<typeof getSupplierProcessesByProcess>>["data"]
>[number];

type SupplierProcessSelectProps = Omit<ComboboxProps, "options"> & {
  processId?: string;
};

const SupplierProcess = ({
  processId,
  ...props
}: SupplierProcessSelectProps) => {
  const newSupplierProcessModal = useDisclosure();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [suppliers] = useSuppliers();
  const options = useSupplierProcesses({
    processId
  }).map((supplierProcess) => {
    const supplier = suppliers.find(
      (supplier) => supplier.id === supplierProcess.supplierId
    );
    return {
      label: supplier?.name ?? "Unknown Supplier",
      value: supplierProcess.id!
    };
  });

  const emptyMessage = useEmptyState(
    "supplierProcess",
    processId ? { onCreate: () => newSupplierProcessModal.onOpen() } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        // @ts-ignore
        label={props?.label ?? "Work Center"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          newSupplierProcessModal.onOpen();
        }}
      />
      {newSupplierProcessModal.isOpen && processId && (
        <SupplierProcessForm
          type="modal"
          onClose={() => {
            newSupplierProcessModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            processId,
            supplierId: "",
            minimumCost: 0,
            leadTime: 0
          }}
        />
      )}
    </>
  );
};

SupplierProcess.displayName = "SupplierProcess";

export default SupplierProcess;

export const useSupplierProcesses = (args: { processId?: string }) => {
  const { processId } = args;
  const [supplierProcesses, setSupplierProcesses] = useState<
    SupplierProcessRow[]
  >([]);

  // Read through the shared client cache (window.clientCache) rather than a
  // fetcher, so create/edit/delete clientActions that invalidate the
  // supplierProcesses query key force a fresh fetch on the next mount instead
  // of leaving a stale, deleted entry in the dropdown.
  useEffect(() => {
    if (!processId) {
      setSupplierProcesses([]);
      return;
    }

    let active = true;
    cachedApiQuery<Awaited<ReturnType<typeof getSupplierProcessesByProcess>>>(
      supplierProcessesQuery(processId),
      path.to.api.supplierProcesses(processId)
    )
      .then((result) => {
        if (active) setSupplierProcesses(result.data ?? []);
      })
      .catch(() => {
        if (active) setSupplierProcesses([]);
      });

    return () => {
      active = false;
    };
  }, [processId]);

  return supplierProcesses;
};

export const SupplierProcessPreview = ({
  processId,
  supplierProcessId
}: {
  processId: string;
  supplierProcessId?: string;
}) => {
  const [suppliers] = useSuppliers();
  const supplierProcess = useSupplierProcesses({ processId: processId });

  if (!supplierProcessId) return null;
  const supplierId = supplierProcess.find(
    (supplierProcess) => supplierProcess.id === supplierProcessId
  )?.supplierId;
  if (!supplierId) return null;

  const supplier = suppliers.find((supplier) => supplier.id === supplierId);

  return (
    <span className="text-xs text-muted-foreground">{supplier?.name}</span>
  );
};

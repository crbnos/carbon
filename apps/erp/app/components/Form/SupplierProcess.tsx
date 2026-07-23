import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox, FieldEmptyState } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import type { getSupplierProcessesByProcess } from "~/modules/purchasing";
import { SupplierProcessForm } from "~/modules/purchasing/ui/Supplier";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { supplierProcessesQuery } from "~/utils/react-query";
import { useEmptyState } from "./emptyStates";

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

  const { t } = useLingui();
  const supplierProcessEmptyMessage = useEmptyState("supplierProcess", {
    onCreate: () => newSupplierProcessModal.onOpen()
  });
  const emptyMessage = processId ? (
    supplierProcessEmptyMessage
  ) : (
    <FieldEmptyState
      title={t`No process selected`}
      description={t`Select a process first to choose its supplier.`}
    />
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

  // Read through the shared window.clientCache QueryClient (the same key the
  // mutation clientActions invalidate) so that deleting/creating a supplier
  // process reactively refetches this dropdown — no page refresh, no stale
  // rows retained the way a bare useFetcher did. An empty processId would build
  // a URL with an empty segment that matches no route, so the query is disabled
  // until we have one.
  const { data } = useQuery({
    queryKey: supplierProcessesQuery(processId ?? "").queryKey,
    queryFn: async () => {
      const response = await fetch(path.to.api.supplierProcesses(processId!));
      if (!response.ok) {
        throw new Error(
          `Failed to load supplier processes (${response.status})`
        );
      }
      return (await response.json()) as Awaited<
        ReturnType<typeof getSupplierProcessesByProcess>
      >;
    },
    enabled: Boolean(processId),
    staleTime: supplierProcessesQuery(processId ?? "").staleTime
  });

  const supplierProcesses = useMemo(() => data?.data ?? [], [data]);

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

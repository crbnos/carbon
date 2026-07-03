import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { formatAddress } from "@carbon/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  getSupplierLocations,
  SupplierLocation as SupplierLocationType
} from "~/modules/purchasing";
import { SupplierLocationForm } from "~/modules/purchasing/ui/Supplier";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type SupplierLocationSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "onChange" | "inline"
> & {
  supplier?: string;
  inline?: boolean;
  onChange?: (supplier: SupplierLocationType | null) => void;
};

const SupplierLocationPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const location = options.find((o) => o.value === value);
  if (!location) return null;
  return <span>{location.label}</span>;
};

const SupplierLocation = ({
  onChange: propsOnChange,
  inline,
  supplier,
  ...props
}: SupplierLocationSelectProps) => {
  const newLocationModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const supplierLocationsFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierLocations>>>();
  const [suppliers] = useSuppliers();
  const supplierName =
    suppliers.find((s) => s.id === supplier)?.name ?? "Main Location";

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (supplier) {
      supplierLocationsFetcher.load(path.to.api.supplierLocations(supplier));
    }
  }, [supplier]);

  const options = useMemo(
    () =>
      supplierLocationsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: `${formatAddress(
          c.address?.addressLine1,
          c.address?.addressLine2,
          c.address?.city,
          c.address?.stateProvince
        )} (${c.name})`
      })) ?? [],

    [supplierLocationsFetcher.data]
  );

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const location =
      supplierLocationsFetcher.data?.data?.find(
        (location) => location.id === newValue?.value
      ) ?? null;

    propsOnChange?.(location as SupplierLocationType | null);
  };

  const emptyMessage = useEmptyState(
    "supplierLocation",
    supplier ? { onCreate: () => newLocationModal.onOpen() } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={inline ? SupplierLocationPreview : undefined}
        label={props?.label ?? "Supplier Location"}
        emptyMessage={emptyMessage}
        onChange={onChange}
        onCreateOption={(option) => {
          newLocationModal.onOpen();
          setCreated(option);
        }}
      />
      {newLocationModal.isOpen && (
        <SupplierLocationForm
          supplierId={supplier!}
          type="modal"
          onClose={() => {
            setCreated("");
            newLocationModal.onClose();
            // Reload the per-supplier fetcher so a just-created location appears.
            if (supplier) {
              supplierLocationsFetcher.load(
                path.to.api.supplierLocations(supplier)
              );
            }
            triggerRef.current?.click();
          }}
          initialValues={{
            name: supplierName,
            addressLine1: created || "",
            addressLine2: "",
            city: "",
            stateProvince: "",
            postalCode: "",
            countryCode: ""
          }}
        />
      )}
    </>
  );
};

export default SupplierLocation;

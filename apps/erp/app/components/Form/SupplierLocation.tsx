import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { formatAddress } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef } from "react";
import {
  type SupplierLocation as SupplierLocationType,
  type getSupplierLocations,
} from "~/modules/purchasing";
import { SupplierLocationForm } from "~/modules/purchasing/ui/Supplier";
import { path } from "~/utils/path";

type SupplierLocationSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  supplier?: string;
  inline?: boolean;
  onChange?: (supplier: SupplierLocationType | null) => void;
};

const SupplierLocationPreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  const location = options.find((o) => o.value === value);
  if (!location) return null;
  return <span>{location.label}</span>;
};

const SupplierLocation = (props: SupplierLocationSelectProps) => {
  const newLocationModal = useDisclosure();
  // const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const supplierLocationsFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierLocations>>>();

  useEffect(() => {
    if (props?.supplier) {
      supplierLocationsFetcher.load(
        path.to.api.supplierLocations(props.supplier)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.supplier]);

  const options = useMemo(
    () =>
      supplierLocationsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: `${formatAddress(
          c.address?.addressLine1,
          c.address?.addressLine2,
          c.address?.city,
          c.address?.stateProvince
        )} (${c.name})`,
      })) ?? [],

    [supplierLocationsFetcher.data]
  );

  const onChange = (newValue: { label: string; value: string } | null) => {
    const location =
      supplierLocationsFetcher.data?.data?.find(
        (location) => location.id === newValue?.value
      ) ?? null;

    props.onChange?.(location as SupplierLocationType | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props?.inline ? SupplierLocationPreview : undefined}
        label={props?.label ?? "Supplier Location"}
        onChange={onChange}
        onCreateOption={(option) => {
          newLocationModal.onOpen();
          // setCreated(option);
        }}
      />
      {newLocationModal.isOpen && (
        <SupplierLocationForm
          supplierId={props.supplier!}
          type="modal"
          onClose={() => {
            // setCreated("");
            newLocationModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{ name: "" }}
        />
      )}
    </>
  );
};

export default SupplierLocation;

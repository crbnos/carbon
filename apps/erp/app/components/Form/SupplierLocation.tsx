import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { formatAddress } from "@carbon/utils";
import { useEffect, useMemo, useRef } from "react";
import { useFetcher } from "react-router";
import type {
  getSupplierLocations,
  SupplierLocation as SupplierLocationType
} from "~/modules/purchasing";
import { SupplierLocationForm } from "~/modules/purchasing/ui/Supplier";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

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
  options: { value: string; label: string | JSX.Element }[]
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (props?.supplier) {
      supplierLocationsFetcher.load(
        path.to.api.supplierLocations(props.supplier)
      );
    }
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

    props.onChange?.(location as SupplierLocationType | null);
  };

  const emptyMessage = useEmptyState(
    "supplierLocation",
    props.supplier ? { onCreate: () => newLocationModal.onOpen() } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props?.inline ? SupplierLocationPreview : undefined}
        label={props?.label ?? "Supplier Location"}
        emptyMessage={emptyMessage}
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

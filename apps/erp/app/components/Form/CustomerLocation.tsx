import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { formatAddress } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  CustomerLocation as CustomerLocationType,
  getCustomerLocations
} from "~/modules/sales";
import CustomerLocationForm from "~/modules/sales/ui/Customer/CustomerLocationForm";
import { path } from "~/utils/path";

type CustomerLocationSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  customer?: string;
  inline?: boolean;
  onChange?: (customer: CustomerLocationType | null) => void;
};

const CustomerLocationPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const location = options.find((o) => o.value === value);
  if (!location) return null;
  return <span>{location.label}</span>;
};

const CustomerLocation = (props: CustomerLocationSelectProps) => {
  const { t } = useLingui();
  const customerLocationsFetcher =
    useFetcher<Awaited<ReturnType<typeof getCustomerLocations>>>();

  const newLocationModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (props?.customer) {
      customerLocationsFetcher.load(
        path.to.api.customerLocations(props.customer)
      );
    }
  }, [props.customer]);

  const options = useMemo(
    () =>
      customerLocationsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: `${formatAddress(
          c.address?.addressLine1,
          c.address?.addressLine2,
          c.address?.city,
          c.address?.stateProvince
        )} (${c.name})`
      })) ?? [],

    [customerLocationsFetcher.data]
  );

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const location =
      customerLocationsFetcher.data?.data?.find(
        (location) => location.id === newValue?.value
      ) ?? null;

    props.onChange?.(location as CustomerLocationType | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props?.inline ? CustomerLocationPreview : undefined}
        label={props?.label ?? t`Customer Location`}
        placeholder={props?.placeholder ?? t`Select`}
        onChange={onChange}
        onCreateOption={(option) => {
          newLocationModal.onOpen();
          setCreated(option);
        }}
      />
      {newLocationModal.isOpen && (
        <CustomerLocationForm
          customerId={props.customer!}
          type="modal"
          onClose={() => {
            setCreated("");
            newLocationModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{ name: created }}
        />
      )}
    </>
  );
};

export default CustomerLocation;

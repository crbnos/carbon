import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CustomerLocation as CustomerLocationType,
  type getCustomerLocations,
} from "~/modules/sales";
import { path } from "~/utils/path";

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { formatAddress } from "@carbon/utils";
import CustomerLocationForm from "~/modules/sales/ui/Customer/CustomerLocationForm";

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
  options: { value: string; label: string }[]
) => {
  const location = options.find((o) => o.value === value);
  if (!location) return null;
  return <span>{location.label}</span>;
};

const CustomerLocation = (props: CustomerLocationSelectProps) => {
  const customerLocationsFetcher =
    useFetcher<Awaited<ReturnType<typeof getCustomerLocations>>>();

  const newLocationModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (props?.customer) {
      customerLocationsFetcher.load(
        path.to.api.customerLocations(props.customer)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        )} (${c.name})`,
      })) ?? [],

    [customerLocationsFetcher.data]
  );

  const onChange = (newValue: { label: string; value: string } | null) => {
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
        label={props?.label ?? "Customer Location"}
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

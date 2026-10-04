// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useDisclosure } from "@carbon/react";
import { formatAddress } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import type {
  CustomerLocation as CustomerLocationType,
  getCustomerLocations
} from "~/modules/sales";
import CustomerLocationForm from "~/modules/sales/ui/Customer/CustomerLocationForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

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

const CustomerLocation = ({
  customer,
  ...props
}: CustomerLocationSelectProps) => {
  const { t } = useLingui();
  const customerLocationsFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getCustomerLocations>>
  >(customer ? path.to.api.customerLocations(customer) : null);

  const newLocationModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const emptyMessage = useEmptyState(
    "customerLocation",
    customer ? { onCreate: () => newLocationModal.onOpen() } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props?.inline ? CustomerLocationPreview : undefined}
        label={props?.label ?? t`Customer Location`}
        placeholder={props?.placeholder ?? t`Select`}
        emptyMessage={emptyMessage}
        onChange={onChange}
        onCreateOption={(option) => {
          newLocationModal.onOpen();
          setCreated(option);
        }}
      />
      {newLocationModal.isOpen && (
        <CustomerLocationForm
          customerId={customer!}
          type="modal"
          onClose={() => {
            setCreated("");
            newLocationModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            addressLine1: "",
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

export default CustomerLocation;

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { formatAddress } from "@carbon/utils";
import { useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
import type { getSupplierLocations } from "~/modules/purchasing/purchasing.service";
import type { SupplierLocation as SupplierLocationType } from "~/modules/purchasing/types";
import SupplierLocationForm from "~/modules/purchasing/ui/Supplier/SupplierLocationForm";
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
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const supplierLocationsFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getSupplierLocations>>
  >(supplier ? path.to.api.supplierLocations(supplier) : null);
  const [suppliers] = useSuppliers();
  const supplierName =
    suppliers.find((s) => s.id === supplier)?.name ?? "Main Location";

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
    supplier ? { onCreate: () => create.open("") } : undefined
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
          create.open(option);
        }}
      />
      {create.item !== null && (
        <SupplierLocationForm
          key={create.key}
          open={create.isOpen}
          supplierId={supplier!}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: supplierName,
            addressLine1: create.item || "",
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

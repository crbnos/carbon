// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useMemo, useRef } from "react";
import { useDrawerItem, useSupplierApprovalRequired, useUser } from "~/hooks";
import SupplierForm from "~/modules/purchasing/ui/Supplier/SupplierForm";
import { useSuppliers } from "~/stores";
import SupplierAvatar from "../SupplierAvatar";
import { useEmptyState } from "./emptyStates";

type SupplierSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
  allowedSuppliers?: string[];
  onlyApproved?: boolean;
  /** When creating a new supplier, pre-fill this currency instead of the company base currency */
  defaultCurrencyCode?: string;
};

const SupplierPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  return <SupplierAvatar supplierId={value} />;
};

const Supplier = ({
  allowedSuppliers,
  onlyApproved,
  defaultCurrencyCode,
  ...props
}: SupplierSelectProps) => {
  const supplierApprovalRequired = useSupplierApprovalRequired();
  const [suppliers] = useSuppliers();
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(
    () =>
      suppliers
        .filter((s) => !allowedSuppliers || allowedSuppliers.includes(s.id))
        .filter((s) => !onlyApproved || s.supplierStatus === "Active")
        .map((c) => ({
          value: c.id,
          label: <SupplierAvatar supplierId={c.id} />,
          keywords: c.name
        })) ?? [],
    [suppliers, allowedSuppliers, onlyApproved]
  );

  const { company } = useUser();

  const emptyMessage = useEmptyState("supplier", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Supplier"}
        inline={props?.inline ? SupplierPreview : undefined}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <SupplierForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item,
            currencyCode: defaultCurrencyCode ?? company.baseCurrencyCode,
            supplierStatus: supplierApprovalRequired ? "Pending" : undefined
          }}
        />
      )}
    </>
  );
};

Supplier.displayName = "Supplier";

export default Supplier;

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useSupplierApprovalRequired, useUser } from "~/hooks";
import { SupplierForm } from "~/modules/purchasing/ui/Supplier";
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
  const newSuppliersModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(
    () =>
      suppliers
        .filter((s) => !allowedSuppliers || allowedSuppliers.includes(s.id))
        .filter((s) => !onlyApproved || s.supplierStatus === "Active")
        .map((c) => ({
          value: c.id,
          label: c.name
        })) ?? [],
    [suppliers, allowedSuppliers, onlyApproved]
  );

  const { company } = useUser();

  const emptyMessage = useEmptyState("supplier", {
    onCreate: () => newSuppliersModal.onOpen()
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
          newSuppliersModal.onOpen();
          setCreated(option);
        }}
      />
      {newSuppliersModal.isOpen && (
        <SupplierForm
          type="modal"
          onClose={() => {
            setCreated("");
            newSuppliersModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
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

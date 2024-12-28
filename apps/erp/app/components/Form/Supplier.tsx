import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useUser } from "~/hooks";
import { SupplierForm } from "~/modules/purchasing/ui/Supplier";
import { useSuppliers } from "~/stores";
import SupplierAvatar from "../SupplierAvatar";

type SupplierSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
  allowedSuppliers?: string[];
};

const SupplierPreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  return <SupplierAvatar supplierId={value} />;
};

const Supplier = ({ allowedSuppliers, ...props }: SupplierSelectProps) => {
  const [suppliers] = useSuppliers();
  const newSuppliersModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(
    () =>
      suppliers
        .filter((s) => !allowedSuppliers || allowedSuppliers.includes(s.id))
        .map((c) => ({
          value: c.id,
          label: c.name,
        })) ?? [],
    [suppliers, allowedSuppliers]
  );

  const { company } = useUser();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
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
            currencyCode: company.baseCurrencyCode,
          }}
        />
      )}
    </>
  );
};

Supplier.displayName = "Supplier";

export default Supplier;

import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { SupplierForm } from "~/modules/purchasing";
import { useSuppliers } from "~/stores";

type SupplierSelectProps = Omit<ComboboxProps, "options"> & {
  allowedSuppliers?: string[];
};

const Supplier = ({ allowedSuppliers, ...props }: SupplierSelectProps) => {
  const [suppliers] = useSuppliers();
  const newSuppliersModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(() => {
    const result =
      suppliers.map((c) => ({
        value: c.id,
        label: c.name,
      })) ?? [];
    if (allowedSuppliers) {
      return result.filter((c) => allowedSuppliers.includes(c.value));
    }
    return result;
  }, [suppliers, allowedSuppliers]);

  return allowedSuppliers ? (
    <Combobox options={options} {...props} label={props?.label ?? "Supplier"} />
  ) : (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Supplier"}
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
          }}
        />
      )}
    </>
  );
};

Supplier.displayName = "Supplier";

export default Supplier;

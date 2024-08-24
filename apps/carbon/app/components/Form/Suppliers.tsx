import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { SupplierForm } from "~/modules/purchasing";
import { useSuppliers } from "~/stores";
import type { CreatableMultiSelectProps } from "./CreatableMultiSelect";
import CreatableMultiSelect from "./CreatableMultiSelect";

type SupplierSelectProps = Omit<CreatableMultiSelectProps, "options"> & {
  processId?: string;
};

const Suppliers = (props: SupplierSelectProps) => {
  const newSupplierModal = useDisclosure();

  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [suppliers] = useSuppliers();
  const options = useMemo(() => {
    return (
      suppliers.map((c) => ({
        value: c.id,
        label: c.name,
      })) ?? []
    );
  }, [suppliers]);

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Work Center"}
        onCreateOption={(option) => {
          newSupplierModal.onOpen();
          setCreated(option);
        }}
      />
      {newSupplierModal.isOpen && (
        <SupplierForm
          type="modal"
          onClose={() => {
            setCreated("");
            newSupplierModal.onClose();
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

Suppliers.displayName = "Supplier";

export default Suppliers;

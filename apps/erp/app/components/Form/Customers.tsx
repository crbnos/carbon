import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useUser } from "~/hooks";
import CustomerForm from "~/modules/sales/ui/Customer/CustomerForm";
import { useCustomers } from "~/stores";
import { useEmptyState } from "./emptyStates";

type CustomerSelectProps = Omit<CreatableMultiSelectProps, "options">;

const Customers = (props: CustomerSelectProps) => {
  const newCustomerModal = useDisclosure();

  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [customers] = useCustomers();
  const { company } = useUser();

  const options = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: c.name
      })) ?? [],
    [customers]
  );

  const emptyMessage = useEmptyState("customer", {
    onCreate: () => newCustomerModal.onOpen()
  });

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Customers"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          newCustomerModal.onOpen();
          setCreated(option);
        }}
      />
      {newCustomerModal.isOpen && (
        <CustomerForm
          type="modal"
          onClose={() => {
            setCreated("");
            newCustomerModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            currencyCode: company.baseCurrencyCode,
            taxPercent: 0
          }}
        />
      )}
    </>
  );
};

Customers.displayName = "Customers";

export default Customers;

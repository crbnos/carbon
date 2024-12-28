import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useUser } from "~/hooks";
import CustomerForm from "~/modules/sales/ui/Customer/CustomerForm";
import { useCustomers } from "~/stores";
import CustomerAvatar from "../CustomerAvatar";

type CustomerSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
};

const CustomerPreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  return <CustomerAvatar customerId={value} />;
};

const Customer = (props: CustomerSelectProps) => {
  const [customers] = useCustomers();
  const newCustomersModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: c.name,
      })) ?? [],
    [customers]
  );

  const { company } = useUser();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Customer"}
        inline={props?.inline ? CustomerPreview : undefined}
        onCreateOption={(option) => {
          newCustomersModal.onOpen();
          setCreated(option);
        }}
      />
      {newCustomersModal.isOpen && (
        <CustomerForm
          type="modal"
          onClose={() => {
            setCreated("");
            newCustomersModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            currencyCode: company.baseCurrencyCode,
            taxPercent: 0,
          }}
        />
      )}
    </>
  );
};

Customer.displayName = "Customer";

export default Customer;

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import { useUser } from "~/hooks";
import CustomerForm from "~/modules/sales/ui/Customer/CustomerForm";
import { useCustomers } from "~/stores";
import CustomerAvatar from "../CustomerAvatar";
import { useEmptyState } from "./emptyStates";

type CustomerSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
  exclude?: string[];
};

const CustomerPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  return <CustomerAvatar customerId={value} />;
};

const Customer = (props: CustomerSelectProps) => {
  const { t } = useLingui();
  const [customers] = useCustomers();
  const newCustomersModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(() => {
    const all = customers.map((c) => ({ value: c.id, label: c.name }));
    return props.exclude?.length
      ? all.filter((o) => !props.exclude!.includes(o.value))
      : all;
  }, [customers, props.exclude]);

  const { company } = useUser();

  const emptyMessage = useEmptyState("customer", {
    onCreate: () => newCustomersModal.onOpen()
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? t`Customer`}
        placeholder={props?.placeholder ?? t`Select`}
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
            taxPercent: 0
          }}
        />
      )}
    </>
  );
};

Customer.displayName = "Customer";

export default Customer;

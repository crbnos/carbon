import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CustomerContact as CustomerContactType,
  getCustomerContacts,
} from "~/modules/sales";
import { path } from "~/utils/path";

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { CustomerContactForm } from "~/modules/sales";

type CustomerContactSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange"
> & {
  customer?: string;
  onChange?: (customer: CustomerContactType["contact"] | null) => void;
};

const CustomerContact = (props: CustomerContactSelectProps) => {
  const customerContactsFetcher =
    useFetcher<Awaited<ReturnType<typeof getCustomerContacts>>>();

  const newContactModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [firstName, ...lastName] = created.split(" ");

  useEffect(() => {
    if (props?.customer) {
      customerContactsFetcher.load(
        path.to.api.customerContacts(props.customer)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.customer]);

  const options = useMemo(
    () =>
      customerContactsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: `${c.contact?.firstName} ${c.contact?.lastName}`,
      })) ?? [],

    [customerContactsFetcher.data]
  );

  const onChange = (newValue: { label: string; value: string } | null) => {
    const contact =
      customerContactsFetcher.data?.data?.find(
        (contact) => contact.id === newValue?.value
      ) ?? null;

    props.onChange?.(contact?.contact ?? null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Customer Contact"}
        onChange={onChange}
        onCreateOption={(option) => {
          newContactModal.onOpen();
          setCreated(option);
        }}
      />
      {newContactModal.isOpen && (
        <CustomerContactForm
          customerId={props.customer!}
          type="modal"
          onClose={() => {
            setCreated("");
            newContactModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            email: "",
            firstName: firstName,
            lastName: lastName.join(" "),
          }}
        />
      )}
    </>
  );
};

export default CustomerContact;

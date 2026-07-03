import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { Avatar, HStack, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  CustomerContact as CustomerContactType,
  getCustomerContacts
} from "~/modules/sales";
import CustomerContactForm from "~/modules/sales/ui/Customer/CustomerContactForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type CustomerContactSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  customer?: string;
  onChange?: (
    customer: { id: string; contact: CustomerContactType["contact"] } | null
  ) => void;
  inline?: boolean;
};

const CustomerContactPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const contact = options.find((o) => o.value === value);
  if (!contact) return null;
  return (
    <HStack>
      <Avatar
        size="xs"
        name={typeof contact.label === "string" ? contact.label : undefined}
      />
      <span>{contact.label}</span>
    </HStack>
  );
};

const CustomerContact = ({
  customer,
  ...props
}: CustomerContactSelectProps) => {
  const { t } = useLingui();
  const newContactModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [firstName, ...lastName] = created.split(" ");

  const { options, data, reload } = useCustomerContacts(customer);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const contact =
      data?.data?.find((contact) => contact.id === newValue?.value) ?? null;

    props.onChange?.(contact ?? null);
  };

  const emptyMessage = useEmptyState(
    "customerContact",
    customer ? { onCreate: () => newContactModal.onOpen() } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        placeholder={props?.placeholder ?? t`Select Contact`}
        inline={props.inline ? CustomerContactPreview : undefined}
        label={props?.label ?? t`Customer Contact`}
        emptyMessage={emptyMessage}
        onChange={onChange}
        onCreateOption={(option) => {
          newContactModal.onOpen();
          setCreated(option);
        }}
      />
      {newContactModal.isOpen && (
        <CustomerContactForm
          customerId={customer!}
          type="modal"
          onClose={() => {
            setCreated("");
            newContactModal.onClose();
            // The options come from a per-customer fetcher that only loads once;
            // reload it so a just-created contact shows up in the list.
            reload();
            triggerRef.current?.click();
          }}
          initialValues={{
            email: "",
            firstName: firstName || "",
            lastName: lastName.join(" ") || "",
            mobilePhone: ""
          }}
        />
      )}
    </>
  );
};

export default CustomerContact;

function useCustomerContacts(customerId?: string) {
  const customerContactsFetcher =
    useFetcher<Awaited<ReturnType<typeof getCustomerContacts>>>();

  const reload = useCallback(() => {
    if (customerId) {
      customerContactsFetcher.load(path.to.api.customerContacts(customerId));
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  }, [customerId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    reload();
  }, [customerId]);

  const options = useMemo(
    () =>
      customerContactsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.contact?.fullName ?? c.contact?.email ?? "Unknown"
      })) ?? [],

    [customerContactsFetcher.data]
  );

  return { options, data: customerContactsFetcher.data, reload };
}

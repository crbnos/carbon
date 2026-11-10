// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox, useControlField } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { Avatar, HStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef } from "react";
import { useCompanySettings, useDrawerItem } from "~/hooks";
import type { getCustomerContacts } from "~/modules/sales/sales.service";
import type { CustomerContact as CustomerContactType } from "~/modules/sales/types";
import CustomerContactForm from "~/modules/sales/ui/Customer/CustomerContactForm";
import { isEmailableContact } from "~/modules/settings/party-contact";
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
  /** Show a warning when the selected contact has no email. */
  warnIfNoEmail?: boolean;
  /** Called when the "selected contact has no email" state changes. */
  onMissingEmailChange?: (missing: boolean) => void;
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
        decorative
      />
      <span>{contact.label}</span>
    </HStack>
  );
};

const CustomerContact = ({
  customer,
  warnIfNoEmail,
  onMissingEmailChange,
  ...props
}: CustomerContactSelectProps) => {
  const { t } = useLingui();
  const companySettings = useCompanySettings();
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [firstName, ...lastName] = (create.item ?? "").split(" ");

  const { options, data, reload } = useCustomerContacts(customer);

  const [value] = useControlField<string | undefined>(props.name);
  const selected = data?.data?.find((c) => c.id === value);
  const missingEmail =
    !!warnIfNoEmail &&
    !!selected &&
    !isEmailableContact(selected.contact ?? {});

  // A ref, so a parent passing an inline callback does not re-run the effect.
  const onMissingEmailChangeRef = useRef(onMissingEmailChange);
  onMissingEmailChangeRef.current = onMissingEmailChange;
  useEffect(() => {
    onMissingEmailChangeRef.current?.(missingEmail);
  }, [missingEmail]);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const contact =
      data?.data?.find((contact) => contact.id === newValue?.value) ?? null;

    props.onChange?.(contact ?? null);
  };

  const emptyMessage = useEmptyState(
    "customerContact",
    customer ? { onCreate: () => create.open("") } : undefined
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
          create.open(option);
        }}
      />
      {missingEmail && (
        <p className="text-sm text-destructive">
          {t`This contact has no email address.`}
        </p>
      )}
      {create.item !== null && (
        <CustomerContactForm
          key={create.key}
          open={create.isOpen}
          customerId={customer!}
          type="modal"
          requireEmail={!!companySettings?.requireCustomerContactEmail}
          onClose={() => {
            create.close();
            // The options come from a per-customer fetcher that only loads once;
            // reload it so a just-created contact shows up in the list.
            reload();
            create.afterClose(() => triggerRef.current?.click());
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
  const customerContactsFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getCustomerContacts>>
  >(customerId ? path.to.api.customerContacts(customerId) : null);
  const reload = customerContactsFetcher.refetch;

  const options = useMemo(
    () =>
      customerContactsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.contact?.fullName || c.contact?.email || "Unknown"
      })) ?? [],

    [customerContactsFetcher.data]
  );

  return { options, data: customerContactsFetcher.data, reload };
}

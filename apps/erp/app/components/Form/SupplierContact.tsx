// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox, useControlField } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { Avatar, HStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef } from "react";
import { useCompanySettings, useDrawerItem } from "~/hooks";
import type { getSupplierContacts } from "~/modules/purchasing/purchasing.service";
import type { SupplierContact as SupplierContactType } from "~/modules/purchasing/types";
import SupplierContactForm from "~/modules/purchasing/ui/Supplier/SupplierContactForm";
import { isEmailableContact } from "~/modules/settings/party-contact";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type SupplierContactSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "onChange" | "inline"
> & {
  supplier?: string;
  onChange?: (
    supplier: { id: string; contact: SupplierContactType["contact"] } | null
  ) => void;
  inline?: boolean;
  /** Show a warning when the selected contact has no email. */
  warnIfNoEmail?: boolean;
  /** Called when the "selected contact has no email" state changes. */
  onMissingEmailChange?: (missing: boolean) => void;
};

const SupplierContactPreview = (
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

const SupplierContact = ({
  onChange: propsOnChange,
  inline,
  supplier,
  warnIfNoEmail,
  onMissingEmailChange,
  ...props
}: SupplierContactSelectProps) => {
  const { t } = useLingui();
  const companySettings = useCompanySettings();
  const supplierContactsFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getSupplierContacts>>
  >(supplier ? path.to.api.supplierContacts(supplier) : null);

  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [namePart, ...titleParts] = (create.item ?? "").split(" - ");
  const initialTitle = titleParts.join(" - ").trim();
  const nameTokens = namePart.trim().split(" ");
  const initialFirstName = nameTokens[0] || "";
  const initialLastName = nameTokens.slice(1).join(" ");

  const options = useMemo(
    () =>
      supplierContactsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.contact?.fullName || c.contact?.email || "Unknown"
      })) ?? [],

    [supplierContactsFetcher.data]
  );

  const [value] = useControlField<string | undefined>(props.name);
  const selected = supplierContactsFetcher.data?.data?.find(
    (c) => c.id === value
  );
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
      supplierContactsFetcher.data?.data?.find(
        (contact) => contact.id === newValue?.value
      ) ?? null;

    propsOnChange?.(contact ?? null);
  };

  const emptyMessage = useEmptyState(
    "supplierContact",
    supplier ? { onCreate: () => create.open("") } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        placeholder={t`Select Contact`}
        inline={inline ? SupplierContactPreview : undefined}
        label={props?.label ?? t`Supplier Contact`}
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
        <SupplierContactForm
          key={create.key}
          open={create.isOpen}
          supplierId={supplier!}
          type="modal"
          requireEmail={!!companySettings?.requireSupplierContactEmail}
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            email: "",
            firstName: initialFirstName,
            lastName: initialLastName,
            title: initialTitle,
            mobilePhone: ""
          }}
        />
      )}
    </>
  );
};

export default SupplierContact;

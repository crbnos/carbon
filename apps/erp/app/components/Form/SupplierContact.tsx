// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { Avatar, HStack, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import type {
  getSupplierContacts,
  SupplierContact as SupplierContactType
} from "~/modules/purchasing";
import { SupplierContactForm } from "~/modules/purchasing/ui/Supplier";
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
      />
      <span>{contact.label}</span>
    </HStack>
  );
};

const SupplierContact = ({
  onChange: propsOnChange,
  inline,
  supplier,
  ...props
}: SupplierContactSelectProps) => {
  const { t } = useLingui();
  const supplierContactsFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getSupplierContacts>>
  >(supplier ? path.to.api.supplierContacts(supplier) : null);

  const newContactModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [namePart, ...titleParts] = created.split(" - ");
  const initialTitle = titleParts.join(" - ").trim();
  const nameTokens = namePart.trim().split(" ");
  const initialFirstName = nameTokens[0] || "";
  const initialLastName = nameTokens.slice(1).join(" ");

  const options = useMemo(
    () =>
      supplierContactsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.contact?.fullName ?? c.contact?.email ?? "Unknown"
      })) ?? [],

    [supplierContactsFetcher.data]
  );

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
    supplier ? { onCreate: () => newContactModal.onOpen() } : undefined
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
          newContactModal.onOpen();
          setCreated(option);
        }}
      />
      {newContactModal.isOpen && (
        <SupplierContactForm
          supplierId={supplier!}
          type="modal"
          onClose={() => {
            setCreated("");
            newContactModal.onClose();
            triggerRef.current?.click();
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

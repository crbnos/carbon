import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  SupplierContact as SupplierContactType,
  getSupplierContacts,
} from "~/modules/purchasing";
import { path } from "~/utils/path";

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { Avatar, HStack, useDisclosure } from "@carbon/react";
import { SupplierContactForm } from "~/modules/purchasing/ui/Supplier";

type SupplierContactSelectProps = Omit<
  ComboboxProps,
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
  options: { value: string; label: string }[]
) => {
  const contact = options.find((o) => o.value === value);
  if (!contact) return null;
  return (
    <HStack>
      <Avatar size="xs" name={contact.label} />
      <span>{contact.label}</span>
    </HStack>
  );
};

const SupplierContact = (props: SupplierContactSelectProps) => {
  const supplierContactsFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierContacts>>>();

  const newContactModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [firstName, ...lastName] = created.split(" ");

  useEffect(() => {
    if (props?.supplier) {
      supplierContactsFetcher.load(
        path.to.api.supplierContacts(props.supplier)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.supplier]);

  const options = useMemo(
    () =>
      supplierContactsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.contact?.fullName ?? c.contact?.email ?? "Unknown",
      })) ?? [],

    [supplierContactsFetcher.data]
  );

  const onChange = (newValue: { label: string; value: string } | null) => {
    const contact =
      supplierContactsFetcher.data?.data?.find(
        (contact) => contact.id === newValue?.value
      ) ?? null;

    props.onChange?.(contact ?? null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props.inline ? SupplierContactPreview : undefined}
        label={props?.label ?? "Supplier Contact"}
        onChange={onChange}
        onCreateOption={(option) => {
          newContactModal.onOpen();
          setCreated(option);
        }}
      />
      {newContactModal.isOpen && (
        <SupplierContactForm
          supplierId={props.supplier!}
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

export default SupplierContact;

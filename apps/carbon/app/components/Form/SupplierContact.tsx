import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  SupplierContact as SupplierContactType,
  getSupplierContacts,
} from "~/modules/purchasing";
import { path } from "~/utils/path";

import { SupplierContactForm } from "~/modules/purchasing";

type SupplierContactSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange"
> & {
  supplier?: string;
  onChange?: (supplier: SupplierContactType["contact"] | null) => void;
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
        label: `${c.contact?.firstName} ${c.contact?.lastName}`,
      })) ?? [],

    [supplierContactsFetcher.data]
  );

  const onChange = (newValue: { label: string; value: string } | null) => {
    const contact =
      supplierContactsFetcher.data?.data?.find(
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

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { Avatar, HStack, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
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
  const supplierContactsFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierContacts>>>();

  const newContactModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [namePart, ...titleParts] = created.split(" - ");
  const initialTitle = titleParts.join(" - ").trim();
  const nameTokens = namePart.trim().split(" ");
  const initialFirstName = nameTokens[0] || "";
  const initialLastName = nameTokens.slice(1).join(" ");

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (supplier) {
      supplierContactsFetcher.load(path.to.api.supplierContacts(supplier));
    }
  }, [supplier]);

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
            // Reload the per-supplier fetcher so a just-created contact appears.
            if (supplier) {
              supplierContactsFetcher.load(
                path.to.api.supplierContacts(supplier)
              );
            }
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

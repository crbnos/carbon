import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { usePermissions } from "~/hooks";
import type { getPaymentTermsList } from "~/modules/accounting";
import PaymentTermForm from "~/modules/accounting/ui/PaymentTerms/PaymentTermForm";
import { path } from "~/utils/path";

type PaymentTermSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

const PaymentTermPreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  const paymentTerm = options.find((o) => o.value === value);
  if (!paymentTerm) return null;
  return <span>{paymentTerm.label}</span>;
};

const PaymentTerm = (props: PaymentTermSelectProps) => {
  const options = usePaymentTerm();
  const permissions = usePermissions();

  const newPaymentTermModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  return permissions.can("create", "accounting") ? (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props.inline ? PaymentTermPreview : undefined}
        label={props?.label ?? "Payment Term"}
        onCreateOption={(option) => {
          newPaymentTermModal.onOpen();
          setCreated(option);
        }}
      />
      {newPaymentTermModal.isOpen && (
        <PaymentTermForm
          type="modal"
          onClose={() => {
            setCreated("");
            newPaymentTermModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            calculationMethod: "Net" as const,
            daysDue: 0,
            discountPercentage: 0,
            daysDiscount: 0,
          }}
        />
      )}
    </>
  ) : (
    <Combobox
      options={options}
      {...props}
      inline={props.inline ? PaymentTermPreview : undefined}
      label={props?.label ?? "Payment Term"}
    />
  );
};

PaymentTerm.displayName = "PaymentTerm";

export default PaymentTerm;

export const usePaymentTerm = () => {
  const paymentTermFetcher =
    useFetcher<Awaited<ReturnType<typeof getPaymentTermsList>>>();

  useMount(() => {
    paymentTermFetcher.load(path.to.api.paymentTerms);
  });

  const options = useMemo(() => {
    return (paymentTermFetcher.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [paymentTermFetcher.data?.data]);

  return options;
};

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { usePermissions } from "~/hooks";
import type { getPaymentTermsList } from "~/modules/accounting";
import PaymentTermForm from "~/modules/accounting/ui/PaymentTerms/PaymentTermForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type PaymentTermSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

const PaymentTermPreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode }[]
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

  const emptyMessage = useEmptyState("paymentTerm", {
    onCreate: () => newPaymentTermModal.onOpen()
  });

  return permissions.can("create", "accounting") ? (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
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
            daysDiscount: 0
          }}
        />
      )}
    </>
  ) : (
    <Combobox
      options={options}
      emptyMessage={emptyMessage}
      {...props}
      inline={props.inline ? PaymentTermPreview : undefined}
      label={props?.label ?? "Payment Term"}
    />
  );
};

PaymentTerm.displayName = "PaymentTerm";

export default PaymentTerm;

export const usePaymentTerm = () => {
  const paymentTermFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getPaymentTermsList>>
  >(path.to.api.paymentTerms);

  const options = useMemo(() => {
    return (paymentTermFetcher.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [paymentTermFetcher.data?.data]);

  return options;
};

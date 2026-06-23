import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { useRouteData } from "~/hooks";
import type {
  CustomerStatus as CustomerStatusStatus,
  getCustomerStatusesList
} from "~/modules/sales";
import CustomerStatusForm from "~/modules/sales/ui/CustomerStatuses/CustomerStatusForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type CustomerStatusSelectProps = Omit<ComboboxProps, "options">;

const CustomerStatus = (props: CustomerStatusSelectProps) => {
  const { i18n, t } = useLingui();
  const newCustomerStatusModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useCustomerStatuses();

  const emptyMessage = useEmptyState("customerStatus", {
    onCreate: () => newCustomerStatusModal.onOpen()
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={
          options.map((o) => ({
            value: o.value,
            label: <Enumerable value={i18n._(o.label)} />
          })) ?? []
        }
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? t`Customer Status`}
        onCreateOption={(option) => {
          newCustomerStatusModal.onOpen();
          setCreated(option);
        }}
      />
      {newCustomerStatusModal.isOpen && (
        <CustomerStatusForm
          type="modal"
          onClose={() => {
            setCreated("");
            newCustomerStatusModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created
          }}
        />
      )}
    </>
  );
};

CustomerStatus.displayName = "CustomerStatus";

export default CustomerStatus;

export const useCustomerStatuses = () => {
  const customerStatusFetcher =
    useFetcher<Awaited<ReturnType<typeof getCustomerStatusesList>>>();

  const sharedCustomerData = useRouteData<{
    customerStatuses: CustomerStatusStatus[];
  }>(path.to.customerRoot);

  const hasCustomerData = sharedCustomerData?.customerStatuses;

  useMount(() => {
    if (!hasCustomerData)
      customerStatusFetcher.load(path.to.api.customerStatuses);
  });

  const options = useMemo(() => {
    const dataSource =
      (hasCustomerData
        ? sharedCustomerData.customerStatuses
        : customerStatusFetcher.data?.data) ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [
    customerStatusFetcher.data?.data,
    hasCustomerData,
    sharedCustomerData?.customerStatuses
  ]);

  return options;
};

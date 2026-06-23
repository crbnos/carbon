import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import type { getCustomerTypesList } from "~/modules/sales";
import { CustomerTypeForm } from "~/modules/sales/ui/CustomerTypes";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type CustomerTypeSelectProps = Omit<ComboboxProps, "options"> & {
  exclude?: string[];
};

const CustomerType = (props: CustomerTypeSelectProps) => {
  const newCustomerTypeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useCustomerTypes();

  const emptyMessage = useEmptyState("customerType", {
    onCreate: () => newCustomerTypeModal.onOpen()
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={(props.exclude?.length
          ? options.filter((o) => !props.exclude!.includes(o.value))
          : options
        ).map((o) => ({
          value: o.value,
          label: <Enumerable value={o.label} />
        }))}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "CustomerType"}
        onCreateOption={(option) => {
          newCustomerTypeModal.onOpen();
          setCreated(option);
        }}
      />
      {newCustomerTypeModal.isOpen && (
        <CustomerTypeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newCustomerTypeModal.onClose();
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

CustomerType.displayName = "CustomerType";

export default CustomerType;

export const useCustomerTypes = () => {
  const customerTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getCustomerTypesList>>>();

  useMount(() => {
    customerTypeFetcher.load(path.to.api.customerTypes);
  });

  const options = useMemo(() => {
    const dataSource = customerTypeFetcher.data?.data ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [customerTypeFetcher.data?.data]);

  return options;
};

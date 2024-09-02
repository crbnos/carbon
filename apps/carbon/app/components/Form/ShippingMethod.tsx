import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { usePermissions } from "~/hooks";
import type { getShippingMethodsList } from "~/modules/inventory";
import { ShippingMethodForm } from "~/modules/inventory";
import { path } from "~/utils/path";

type ShippingMethodSelectProps = Omit<ComboboxProps, "options">;

const ShippingMethod = (props: ShippingMethodSelectProps) => {
  const options = useShippingMethod();
  const permissions = usePermissions();

  const newShippingMethodModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  return permissions.can("create", "inventory") ? (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Shipping Method"}
        onCreateOption={(option) => {
          newShippingMethodModal.onOpen();
          setCreated(option);
        }}
      />
      {newShippingMethodModal.isOpen && (
        <ShippingMethodForm
          type="modal"
          onClose={() => {
            setCreated("");
            newShippingMethodModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            carrier: "" as "FedEx",
          }}
        />
      )}
    </>
  ) : (
    <Combobox
      options={options}
      {...props}
      label={props?.label ?? "Shipping Method"}
    />
  );
};

ShippingMethod.displayName = "ShippingMethod";

export default ShippingMethod;

export const useShippingMethod = () => {
  const shippingMethodFetcher =
    useFetcher<Awaited<ReturnType<typeof getShippingMethodsList>>>();

  useMount(() => {
    shippingMethodFetcher.load(path.to.api.shippingMethods);
  });

  const options = useMemo(() => {
    return (shippingMethodFetcher.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [shippingMethodFetcher.data?.data]);

  return options;
};

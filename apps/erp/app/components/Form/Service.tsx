import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMemo } from "react";
import type { ServiceType } from "~/modules/items";
import { useServices } from "~/stores";
import { useEmptyState } from "./emptyStates";

type ServiceSelectProps = Omit<ComboboxProps, "options"> & {
  serviceType?: ServiceType;
};

const Service = ({ serviceType, ...props }: ServiceSelectProps) => {
  const services = useServices();
  const options = useMemo(
    () =>
      services.map((service) => ({
        value: service.id,
        label: service.id,
        helper: service.name
      })) ?? [],
    [services]
  );

  const emptyMessage = useEmptyState("service");

  return (
    <Combobox
      options={options}
      emptyMessage={emptyMessage}
      {...props}
      label={props?.label ?? "Service"}
    />
  );
};

Service.displayName = "Service";

export default Service;

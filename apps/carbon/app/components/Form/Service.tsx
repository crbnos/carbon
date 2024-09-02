import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMemo } from "react";
import type { ServiceType } from "~/modules/items";
import { useServices } from "~/stores";

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
        helper: service.name,
      })) ?? [],
    [services]
  );

  return (
    <Combobox options={options} {...props} label={props?.label ?? "Service"} />
  );
};

Service.displayName = "Service";

export default Service;

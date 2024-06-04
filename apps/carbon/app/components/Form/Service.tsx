import { useMemo } from "react";
import type { ServiceType } from "~/modules/parts";
import { useServices } from "~/stores";
import type { ComboboxProps } from "./Combobox";
import Combobox from "./Combobox";

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

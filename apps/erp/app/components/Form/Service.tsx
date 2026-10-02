// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMemo } from "react";
import { useServices } from "~/stores";
import { useEmptyState } from "./emptyStates";

type ServiceSelectProps = Omit<ComboboxProps, "options">;

const Service = (props: ServiceSelectProps) => {
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

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import type { getLocationEmployees } from "~/modules/production";
import { path } from "~/utils/path";
import Avatar from "../Avatar";
import { useEmptyState } from "./emptyStates";

type LocationEmployeeSelectProps = Omit<ComboboxProps, "options"> & {
  locationId?: string;
};

const LocationEmployee = ({
  locationId,
  ...props
}: LocationEmployeeSelectProps) => {
  const { t } = useLingui();
  const { options, locationEmployeeFetcher } = useLocationEmployees(locationId);

  const emptyMessage = useEmptyState("employee");

  return (
    <Combobox
      options={options}
      emptyMessage={emptyMessage}
      isLoading={locationEmployeeFetcher.state === "loading"}
      {...props}
      label={props?.label ?? t`Employee`}
      placeholder={props?.placeholder ?? t`Select Employee`}
    />
  );
};

LocationEmployee.displayName = "LocationEmployee";

export default LocationEmployee;

export const useLocationEmployees = (locationId?: string) => {
  const locationEmployeeFetcher =
    useFetcher<Awaited<ReturnType<typeof getLocationEmployees>>>();

  useEffect(() => {
    if (locationId) {
      locationEmployeeFetcher.load(path.to.api.locationEmployees(locationId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const options = useMemo(
    () =>
      (locationEmployeeFetcher.data?.data ?? []).flatMap((employee) =>
        employee.id
          ? [
              {
                value: employee.id,
                label: (
                  <div className="flex flex-row items-center gap-2 flex-grow">
                    <Avatar
                      name={employee.name ?? undefined}
                      path={employee.avatarUrl}
                      size="xs"
                    />
                    <span>{employee.name}</span>
                  </div>
                )
              }
            ]
          : []
      ),
    [locationEmployeeFetcher.data]
  );

  return { options, locationEmployeeFetcher };
};

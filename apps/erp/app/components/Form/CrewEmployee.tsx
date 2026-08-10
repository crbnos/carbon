import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import type { getCrewEmployees } from "~/modules/production";
import { path } from "~/utils/path";
import Avatar from "../Avatar";
import { useEmptyState } from "./emptyStates";

type CrewEmployeeSelectProps = Omit<ComboboxProps, "options"> & {
  locationId?: string;
};

const CrewEmployee = ({ locationId, ...props }: CrewEmployeeSelectProps) => {
  const { t } = useLingui();
  const { options, crewEmployeeFetcher } = useCrewEmployees(locationId);

  const emptyMessage = useEmptyState("employee");

  return (
    <Combobox
      options={options}
      emptyMessage={emptyMessage}
      isLoading={crewEmployeeFetcher.state === "loading"}
      {...props}
      label={props?.label ?? t`Employee`}
      placeholder={props?.placeholder ?? t`Select Employee`}
    />
  );
};

CrewEmployee.displayName = "CrewEmployee";

export default CrewEmployee;

export const useCrewEmployees = (locationId?: string) => {
  const crewEmployeeFetcher =
    useFetcher<Awaited<ReturnType<typeof getCrewEmployees>>>();

  useEffect(() => {
    if (locationId) {
      crewEmployeeFetcher.load(path.to.api.crewEmployees(locationId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const options = useMemo(
    () =>
      (crewEmployeeFetcher.data?.data ?? []).flatMap((employee) =>
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
    [crewEmployeeFetcher.data]
  );

  return { options, crewEmployeeFetcher };
};

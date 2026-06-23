import type { SelectProps } from "@carbon/form";
import { Select } from "@carbon/form";
import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import type { getShiftsList } from "~/modules/people";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type ShiftSelectProps = Omit<SelectProps, "options"> & {
  location?: string;
};

const Shift = (props: ShiftSelectProps) => {
  const options = useShifts({
    location: props.location
  });

  const emptyMessage = useEmptyState("shift");

  return (
    <Select
      options={options}
      emptyMessage={emptyMessage}
      {...props}
      label={props?.label ?? "Shift"}
    />
  );
};

export default Shift;

export const useShifts = (props?: { location?: string }) => {
  const shiftFetcher = useFetcher<Awaited<ReturnType<typeof getShiftsList>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (props?.location) {
      shiftFetcher.load(path.to.api.shifts(props.location));
    }
  }, [props?.location]);

  const options = useMemo(
    () =>
      shiftFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.name
      })) ?? [],

    [shiftFetcher.data]
  );

  return options;
};

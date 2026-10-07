// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SelectProps } from "@carbon/form";
import { Select } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo } from "react";
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
  const shiftFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getShiftsList>>
  >(props?.location ? path.to.api.shifts(props.location) : null);

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

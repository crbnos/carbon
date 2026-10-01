// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MultiSelectProps } from "@carbon/form";
import { MultiSelect } from "@carbon/form";
import { useEmptyState } from "./emptyStates";
import { useShifts } from "./Shift";

type ShiftsSelectProps = Omit<MultiSelectProps, "options"> & {
  locationId?: string;
};

const Shifts = ({ locationId, ...props }: ShiftsSelectProps) => {
  const options = useShifts({ location: locationId });

  const emptyMessage = useEmptyState("shift");

  return (
    <MultiSelect
      options={options}
      emptyMessage={emptyMessage}
      {...props}
      label={props?.label ?? "Shifts"}
    />
  );
};

Shifts.displayName = "Shifts";

export default Shifts;

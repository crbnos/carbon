// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  PART_NUMBER_DISPLAYS,
  type PartNumberDisplay as PartNumberDisplayValue,
  type PartNumberParty
} from "@carbon/documents/utils";
import type { SelectProps } from "@carbon/form";
import { Select } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";

export type { PartNumberParty };

/** The 4 display choices, labelled for one party, in select order. */
export function usePartNumberDisplayOptions(party: PartNumberParty) {
  const { t } = useLingui();
  // A Record, so a value added to the enum fails the typecheck until labelled.
  const labels: Record<
    PartNumberParty,
    Record<PartNumberDisplayValue, string>
  > = {
    customer: {
      "Ours First": t`Carbon part number, then customer part number`,
      "Theirs First": t`Customer part number, then Carbon part number`,
      "Theirs Only": t`Customer part number only`,
      "Ours Only": t`Carbon part number only`
    },
    supplier: {
      "Ours First": t`Carbon part number, then supplier part number`,
      "Theirs First": t`Supplier part number, then Carbon part number`,
      "Theirs Only": t`Supplier part number only`,
      "Ours Only": t`Carbon part number only`
    }
  };
  return PART_NUMBER_DISPLAYS.map((value) => ({
    value,
    label: labels[party][value]
  }));
}

/**
 * Which part numbers a document line prints: the company defaults in
 * Settings, a customer's or supplier's override, a purchase order line.
 */
const PartNumberDisplay = ({
  party,
  ...props
}: Omit<SelectProps, "options"> & { party: PartNumberParty }) => {
  const options = usePartNumberDisplayOptions(party);
  return <Select {...props} options={options} />;
};

export default PartNumberDisplay;

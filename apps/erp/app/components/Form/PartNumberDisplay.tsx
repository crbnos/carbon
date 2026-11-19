// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  PART_NUMBER_DISPLAYS,
  type PartNumberDisplay as PartNumberDisplayValue
} from "@carbon/documents/utils";
import type { SelectProps } from "@carbon/form";
import { Select } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";

/** Whose part number "theirs" is: the customer's or the supplier's. */
export type PartNumberParty = "customer" | "supplier";

/** The 4 display choices, labelled for one party, in select order. */
export function usePartNumberDisplayOptions(party: PartNumberParty) {
  const { t } = useLingui();
  // A Record, so a value added to the enum fails the typecheck until labelled.
  const labels: Record<
    PartNumberParty,
    Record<PartNumberDisplayValue, string>
  > = {
    customer: {
      "Ours First": t`Our part number, then the customer's`,
      "Theirs First": t`The customer's part number, then ours`,
      "Theirs Only": t`The customer's part number only`,
      "Ours Only": t`Our part number only`
    },
    supplier: {
      "Ours First": t`Our part number, then the supplier's`,
      "Theirs First": t`The supplier's part number, then ours`,
      "Theirs Only": t`The supplier's part number only`,
      "Ours Only": t`Our part number only`
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

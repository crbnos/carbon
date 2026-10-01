// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SelectProps } from "@carbon/form";
import { SelectControlled } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import { standardFactorType } from "~/modules/shared";

export type StandardFactorSelectProps = Omit<SelectProps, "options"> & {
  hint?: string;
};

const StandardFactor = ({
  label,
  hint,
  ...props
}: StandardFactorSelectProps) => {
  const { t } = useLingui();

  const translateStandardFactorType = (v: string) => {
    switch (v) {
      case "Hours/Piece":
        return t`Hours/Piece`;
      case "Hours/100 Pieces":
        return t`Hours/100 Pieces`;
      case "Hours/1000 Pieces":
        return t`Hours/1000 Pieces`;
      case "Minutes/Piece":
        return t`Minutes/Piece`;
      case "Minutes/100 Pieces":
        return t`Minutes/100 Pieces`;
      case "Minutes/1000 Pieces":
        return t`Minutes/1000 Pieces`;
      case "Pieces/Hour":
        return t`Pieces/Hour`;
      case "Pieces/Minute":
        return t`Pieces/Minute`;
      case "Seconds/Piece":
        return t`Seconds/Piece`;
      case "Total Hours":
        return t`Total Hours`;
      case "Total Minutes":
        return t`Total Minutes`;
      default:
        return v;
    }
  };

  const options = standardFactorType
    .filter((type) => {
      if (hint === "Fixed") {
        return ["Total Hours", "Total Minutes"].includes(type);
      } else if (hint === "Per Unit") {
        return !["Total Hours", "Total Minutes"].includes(type);
      } else {
        return true;
      }
    })
    .map((type) => ({ value: type, label: translateStandardFactorType(type) }));

  return (
    <SelectControlled
      {...props}
      label={label ?? t`Default Unit`}
      options={options}
    />
  );
};

export default StandardFactor;

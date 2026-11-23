// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Select } from "@carbon/form";
import { type Color, colorNames } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { Enumerable } from "~/components/Enumerable";

/** The badge color of a list value (a stage, a status). Empty keeps the color derived from its name. */
const BadgeColor = ({ name = "color" }: { name?: string }) => {
  const { t } = useLingui();
  const labels: Record<Color, string> = {
    gray: t`Gray`,
    lightGray: t`Light Gray`,
    brown: t`Brown`,
    orange: t`Orange`,
    yellow: t`Yellow`,
    green: t`Green`,
    blue: t`Blue`,
    purple: t`Purple`,
    pink: t`Pink`,
    red: t`Red`
  };

  return (
    <Select
      name={name}
      label={t`Color`}
      options={colorNames.map((color) => ({
        value: color,
        label: <Enumerable value={labels[color]} color={color} />
      }))}
      helperText={t`Leave empty to pick a color from the name`}
    />
  );
};

BadgeColor.displayName = "BadgeColor";

export default BadgeColor;

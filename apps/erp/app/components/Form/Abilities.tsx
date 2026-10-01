// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MultiSelectProps } from "@carbon/form";
import { MultiSelect } from "@carbon/form";
import { useAbilities } from "./Ability";

type AbilitiesSelectProps = Omit<MultiSelectProps, "options" | "value">;

const Abilities = (props: AbilitiesSelectProps) => {
  const options = useAbilities();

  return (
    <MultiSelect
      options={options}
      {...props}
      label={props?.label ?? "Ability"}
    />
  );
};

Abilities.displayName = "Abilities";

export default Abilities;

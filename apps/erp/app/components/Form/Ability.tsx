// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo } from "react";
import type { getAbilitiesList } from "~/modules/resources";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type AbilitySelectProps = Omit<ComboboxProps, "options">;

const Ability = (props: AbilitySelectProps) => {
  const options = useAbilities();

  const emptyMessage = useEmptyState("ability");

  return (
    <Combobox
      options={options}
      emptyMessage={emptyMessage}
      {...props}
      label={props?.label ?? "Ability"}
    />
  );
};

Ability.displayName = "Ability";

export default Ability;

export const useAbilities = () => {
  const abilityFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getAbilitiesList>>
  >(path.to.api.abilities);

  const options = useMemo(
    () =>
      abilityFetcher.data?.data
        ? abilityFetcher.data?.data.map((c) => ({
            value: c.id ?? "",
            label: c.name ?? ""
          }))
        : [],
    [abilityFetcher.data]
  );

  return options;
};

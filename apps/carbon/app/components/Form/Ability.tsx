import { useMount } from "@carbon/react";

import { useFetcher } from "@remix-run/react";
import { useMemo } from "react";
import type { getAbilitiesList } from "~/modules/resources";
import { path } from "~/utils/path";

import type { ComboboxProps } from "./Combobox";
import Combobox from "./Combobox";

type AbilitySelectProps = Omit<ComboboxProps, "options">;

const Ability = (props: AbilitySelectProps) => {
  const options = useAbilities();

  return (
    <Combobox options={options} {...props} label={props?.label ?? "Ability"} />
  );
};

Ability.displayName = "Ability";

export default Ability;

export const useAbilities = () => {
  const abilityFetcher =
    useFetcher<Awaited<ReturnType<typeof getAbilitiesList>>>();

  useMount(() => {
    abilityFetcher.load(path.to.api.abilities);
  });

  const options = useMemo(
    () =>
      abilityFetcher.data?.data
        ? abilityFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name,
          }))
        : [],
    [abilityFetcher.data]
  );

  return options;
};

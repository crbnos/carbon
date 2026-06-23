import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
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
            label: c.name
          }))
        : [],
    [abilityFetcher.data]
  );

  return options;
};

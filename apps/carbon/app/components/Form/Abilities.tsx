import type { MultiSelectProps } from "@carbon/form";
import { MultiSelect } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo } from "react";
import type { getAbilitiesList } from "~/modules/resources";
import { path } from "~/utils/path";

type AbilitiesSelectProps = Omit<MultiSelectProps, "options" | "value">;

const Abilities = (props: AbilitiesSelectProps) => {
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

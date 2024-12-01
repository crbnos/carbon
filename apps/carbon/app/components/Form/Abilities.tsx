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

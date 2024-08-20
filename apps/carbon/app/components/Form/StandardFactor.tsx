import { standardFactorType } from "~/modules/shared";
import type { SelectProps } from "./SelectControlled";
import SelectControlled from "./SelectControlled";

export type StandardFactorSelectProps = Omit<SelectProps, "options">;

const StandardFactor = ({
  label = "Default Unit",
  ...props
}: StandardFactorSelectProps) => {
  return (
    <SelectControlled
      {...props}
      label={label}
      options={standardFactorType.map((t) => ({ value: t, label: t }))}
    />
  );
};

export default StandardFactor;

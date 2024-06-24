import type { SelectProps } from "./SelectControlled";
import SelectControlled from "./SelectControlled";

export type DefaultMethodTypeSelectProps = Omit<SelectProps, "options"> & {
  replenishmentSystem: string;
};

const DefaultMethodType = ({
  replenishmentSystem,
  ...props
}: DefaultMethodTypeSelectProps) => {
  const options = (
    replenishmentSystem === "Buy"
      ? ["Buy", "Pick"]
      : replenishmentSystem === "Make"
      ? ["Make", "Pick"]
      : ["Buy", "Make", "Pick"]
  ).map((t) => ({ value: t, label: t }));

  return <SelectControlled {...props} options={options} />;
};

export default DefaultMethodType;

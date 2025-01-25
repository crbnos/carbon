import type { SelectProps } from "@carbon/form";
import { SelectControlled } from "@carbon/form";
import { MethodIcon } from "../Icons";

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
  ).map((t) => ({
    value: t,
    label: (
      <span className="flex items-center gap-2">
        <MethodIcon type={t} />
        {t}
      </span>
    ),
  }));

  return <SelectControlled {...props} options={options} />;
};

export default DefaultMethodType;

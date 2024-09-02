import type { SelectProps } from "@carbon/form";
import { SelectControlled } from "@carbon/form";
import { standardFactorType } from "~/modules/shared";

export type StandardFactorSelectProps = Omit<SelectProps, "options"> & {
  hint?: string;
};

const StandardFactor = ({
  label = "Default Unit",
  hint,
  ...props
}: StandardFactorSelectProps) => {
  const options = standardFactorType
    .filter((t) => {
      if (hint === "Fixed") {
        return ["Total Hours", "Total Minutes"].includes(t);
      } else if (hint === "Per Unit") {
        return !["Total Hours", "Total Minutes"].includes(t);
      } else {
        return true;
      }
    })
    .map((t) => ({ value: t, label: t }));

  return <SelectControlled {...props} label={label} options={options} />;
};

export default StandardFactor;

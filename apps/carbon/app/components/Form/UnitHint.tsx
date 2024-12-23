import { FormControl, FormHelperText, FormLabel } from "@carbon/react";

import { Select } from "~/components";
import type { SelectProps } from "~/components/Select";
import type { StandardFactor } from "~/modules/shared";

export type UnitHintProps = Omit<SelectProps, "onChange" | "options"> & {
  defaultUnit?: StandardFactor;
  label?: string;
  helperText?: string;
  isConfigured?: boolean;
  value: string;
  onChange: (newValue: string) => void;
  onConfigure?: () => void;
};

export const getUnitHint = (u?: string) =>
  ["Total Minutes", "Total Hours"].includes(u ?? "") ? "Fixed" : "Per Unit";

const UnitHint = ({
  defaultUnit,
  name,
  label,
  helperText,
  isConfigured,
  value = getUnitHint(defaultUnit),
  onConfigure,
  ...props
}: UnitHintProps) => {
  const onChange = (value: string) => {
    props?.onChange?.(value);
  };

  return (
    <FormControl className={props.className}>
      {label && (
        <FormLabel
          htmlFor={name}
          isConfigured={isConfigured}
          onConfigure={onConfigure}
        >
          {label}
        </FormLabel>
      )}

      <Select
        {...props}
        value={value}
        onChange={onChange}
        className="w-full"
        options={["Fixed", "Per Unit"].map((u) => ({
          value: u,
          label: u,
        }))}
      />

      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
};

UnitHint.displayName = "UnitHint";

export default UnitHint;

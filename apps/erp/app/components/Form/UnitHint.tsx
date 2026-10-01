// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useField } from "@carbon/form";
import { FormControl, FormHelperText, FormLabel } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";

import { Select } from "~/components";
import type { SelectProps } from "~/components/Select";
import type { StandardFactor } from "~/modules/shared";

export type UnitHintProps = Omit<SelectProps, "onChange" | "options"> & {
  name: string;
  defaultUnit?: StandardFactor;
  label?: string;
  helperText?: string;
  isOptional?: boolean;
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
  isOptional,
  isConfigured,
  value = getUnitHint(defaultUnit),
  onConfigure,
  ...props
}: UnitHintProps) => {
  const { t } = useLingui();
  const { isOptional: fieldIsOptional } = useField(name);
  const resolvedIsOptional = isOptional ?? fieldIsOptional ?? false;

  const onChange = (value: string) => {
    props?.onChange?.(value);
  };

  const translateUnitHint = (v: string) =>
    v === "Fixed" ? t`Fixed` : t`Per Unit`;

  return (
    <FormControl className={props.className}>
      {label && (
        <FormLabel
          htmlFor={name}
          isConfigured={isConfigured}
          isOptional={resolvedIsOptional}
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
          label: translateUnitHint(u)
        }))}
      />

      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
};

UnitHint.displayName = "UnitHint";

export default UnitHint;

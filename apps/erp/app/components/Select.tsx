// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  HStack,
  IconButton,
  Select as SelectBase,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { LuX } from "react-icons/lu";

export type SelectProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  size?: "sm" | "md" | "lg";
  value?: string;
  options: {
    label: string;
    value: string;
  }[];
  isClearable?: boolean;
  isReadOnly?: boolean;
  placeholder?: string;
  onChange: (selected: string) => void;
};

const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      size,
      value,
      options,
      isClearable,
      isReadOnly,
      placeholder,
      onChange,
      ...props
    },
    ref
  ) => {
    const { t } = useLingui();
    return (
      <HStack spacing={1}>
        <SelectBase
          value={value}
          onValueChange={(value) => onChange(value)}
          disabled={isReadOnly}
        >
          <SelectTrigger
            ref={ref}
            size={size}
            // isReadOnly={isReadOnly}
            {...props}
            className="min-w-[160px]"
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectBase>
        {isClearable && !isReadOnly && value && (
          <IconButton
            variant="ghost"
            aria-label={t`Clear`}
            icon={<LuX />}
            onClick={() => onChange("")}
            size={size === "sm" ? "md" : size}
          />
        )}
      </HStack>
    );
  }
);
Select.displayName = "Select";

export default Select;

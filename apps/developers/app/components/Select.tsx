import {
  HStack,
  IconButton,
  Select as SelectBase,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@carbon/react";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { MdClose } from "react-icons/md";

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
            aria-label="Clear"
            icon={<MdClose />}
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

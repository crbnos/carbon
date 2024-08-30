import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  Select as SelectBase,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@carbon/react";
import { useControlField, useField } from "@carbon/remix-validated-form";
import { timezones } from "@carbon/utils";
import { MdClose } from "react-icons/md";
import type { SelectProps } from "./Select";

type TimezoneProps = Omit<SelectProps, "options"> & {
  size?: "sm" | "md" | "lg";
};

const Timezone = ({
  name,
  label,
  helperText,
  isReadOnly,
  isClearable,
  placeholder,
  size,
  ...props
}: TimezoneProps) => {
  const { getInputProps, error } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <input
        {...getInputProps({
          id: name,
        })}
        type="hidden"
        name={name}
        id={name}
        value={value ?? undefined}
      />
      <HStack spacing={1}>
        <SelectBase
          value={value}
          onValueChange={(value) => setValue(value)}
          disabled={isReadOnly}
        >
          <SelectTrigger size={size} className="min-w-[160px]">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {timezones.map(({ label, options }) => (
              <SelectGroup key={label}>
                <SelectLabel>{label}</SelectLabel>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </SelectBase>
        {isClearable && !isReadOnly && value && (
          <IconButton
            variant="ghost"
            aria-label="Clear"
            icon={<MdClose />}
            onClick={() => setValue("")}
            size={size === "sm" ? "md" : size}
          />
        )}
      </HStack>

      {error ? (
        <FormErrorMessage>{error}</FormErrorMessage>
      ) : (
        helperText && <FormHelperText>{helperText}</FormHelperText>
      )}
    </FormControl>
  );
};

Timezone.displayName = "Timezone";

export default Timezone;

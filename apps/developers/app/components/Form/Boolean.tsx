import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  Switch,
} from "@carbon/react";
import { useControlField, useField } from "@carbon/remix-validated-form";
import { forwardRef } from "react";

type FormBooleanProps = {
  name: string;
  label?: string;
  helperText?: string;
  description?: string;
  onChange?: (value: boolean) => void;
};

const Boolean = forwardRef<HTMLInputElement, FormBooleanProps>(
  ({ name, label, description, helperText, onChange, ...props }, ref) => {
    const { getInputProps, error } = useField(name);
    const [value, setValue] = useControlField<boolean>(name);

    return (
      <FormControl isInvalid={!!error} className="pt-2">
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <HStack>
          <Switch
            {...getInputProps()}
            checked={value}
            onCheckedChange={(checked) => {
              setValue(checked);
              onChange?.(checked);
            }}
            aria-label={label}
            {...props}
          />
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </HStack>

        {error ? (
          <FormErrorMessage>{error}</FormErrorMessage>
        ) : (
          helperText && <FormHelperText>{helperText}</FormHelperText>
        )}
      </FormControl>
    );
  }
);

Boolean.displayName = "Boolean";

export default Boolean;

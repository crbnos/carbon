import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  Switch
} from "@carbon/react";
import { forwardRef, useEffect } from "react";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type FormBooleanProps = {
  name: string;
  variant?: "large" | "small";
  label?: string;
  value?: boolean;
  helperText?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  description?: string | JSX.Element;
  onChange?: (value: boolean) => void;
};

const Boolean = forwardRef<HTMLInputElement, FormBooleanProps>(
  (
    {
      name,
      label,
      description,
      helperText,
      onChange,
      variant,
      isDisabled: isDisabledProp,
      isRequired = false,
      value: controlledValue,
      ...props
    },
    ref
  ) => {
    const { getInputProps, error } = useField(name);
    const formState = useFormStateContext();
    const isDisabled =
      formState.isDisabled || formState.isReadOnly || isDisabledProp;
    const [value, setValue] = useControlField<boolean>(name);

    useEffect(() => {
      if (controlledValue !== null && controlledValue !== undefined)
        setValue(controlledValue);
    }, [controlledValue, setValue]);

    return (
      <FormControl
        isInvalid={!!error}
        isRequired={isRequired}
        className="pt-2"
      >
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <HStack>
          <Switch
            variant={variant}
            {...getInputProps()}
            checked={value}
            disabled={isDisabled}
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

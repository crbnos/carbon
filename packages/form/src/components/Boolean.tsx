import type { TermId } from "@carbon/glossary";
import {
  cn,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  Label,
  LabelWithHelp,
  Switch,
  VStack
} from "@carbon/react";
import { forwardRef, useEffect } from "react";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type FormBooleanProps = {
  name: string;
  variant?: "large" | "small";
  label?: string;
  termId?: TermId;
  value?: boolean;
  helperText?: string;
  isDisabled?: boolean;
  bordered?: boolean;
  className?: string;
  description?: string | JSX.Element;
  onChange?: (value: boolean) => void;
};

const Boolean = forwardRef<HTMLInputElement, FormBooleanProps>(
  (
    {
      name,
      label,
      termId,
      description,
      helperText,
      onChange,
      variant,
      bordered,
      isDisabled: isDisabledProp,
      value: controlledValue,
      className,
      ...props
    },
    ref
  ) => {
    const {
      getInputProps,
      error,
      isOptional: fieldIsOptional
    } = useField(name);
    const formState = useFormStateContext();
    const isDisabled =
      formState.isDisabled || formState.isReadOnly || isDisabledProp;
    const [value, setValue] = useControlField<boolean>(name);

    useEffect(() => {
      if (controlledValue !== null && controlledValue !== undefined)
        setValue(controlledValue);
    }, [controlledValue, setValue]);

    if (bordered) {
      return (
        <FormControl isInvalid={!!error} className={className}>
          <HStack className="justify-between items-center gap-4 border border-border rounded-lg p-4">
            <VStack spacing={1}>
              {label && (
                <Label
                  htmlFor={name}
                  className="text-sm text-foreground cursor-pointer"
                >
                  <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
                </Label>
              )}
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
            </VStack>
            <Switch
              id={name}
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
          </HStack>
          {error ? (
            <FormErrorMessage>{error}</FormErrorMessage>
          ) : (
            helperText && <FormHelperText>{helperText}</FormHelperText>
          )}
        </FormControl>
      );
    }

    return (
      <FormControl isInvalid={!!error} className={cn("pt-2", className)}>
        {label && (
          <FormLabel htmlFor={name} isOptional={fieldIsOptional ?? false}>
            <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
          </FormLabel>
        )}
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

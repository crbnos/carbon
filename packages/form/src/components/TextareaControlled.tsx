import type { TermId } from "@carbon/glossary";
import type { TextareaProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  LabelWithHelp,
  Textarea as TextAreaBase
} from "@carbon/react";
import type { ChangeEvent } from "react";
import { forwardRef, useEffect } from "react";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type FormTextAreaControlledProps = Omit<TextareaProps, "value" | "onChange"> & {
  name: string;
  label?: string;
  termId?: TermId;
  characterLimit?: number;
  isOptional?: boolean;
  isRequired?: boolean;
  isDisabled?: boolean;
  helperText?: string;
  value: string;
  onChange?: (newValue: string) => void;
};

const TextAreaControlled = forwardRef<
  HTMLTextAreaElement,
  FormTextAreaControlledProps
>(
  (
    {
      name,
      label,
      termId,
      characterLimit,
      isOptional,
      isRequired,
      isDisabled: isDisabledProp,
      helperText,
      value,
      className,
      onChange,
      ...rest
    },
    ref
  ) => {
    const {
      getInputProps,
      error,
      isOptional: fieldIsOptional
    } = useField(name);
    const [controlValue, setControlValue] = useControlField<string>(name);
    const formState = useFormStateContext();
    const disabled = formState.isDisabled || isDisabledProp || rest.disabled;
    const readOnly = formState.isReadOnly || rest.readOnly;

    useEffect(() => {
      setControlValue(value);
    }, [setControlValue, value]);

    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setControlValue(newValue);
      if (onChange && typeof onChange === "function") {
        onChange(newValue);
      }
    };

    const characterCount = controlValue?.length ?? 0;
    const resolvedIsOptional =
      isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));

    return (
      <FormControl
        isInvalid={!!error}
        isRequired={isRequired}
        className={className}
      >
        {label && (
          <FormLabel htmlFor={name} isOptional={resolvedIsOptional}>
            <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
          </FormLabel>
        )}
        <TextAreaBase
          ref={ref}
          {...getInputProps({
            id: name,
            ...rest
          })}
          value={controlValue}
          onChange={handleChange}
          maxLength={characterLimit}
          disabled={disabled}
          readOnly={readOnly}
        />
        {characterLimit && (
          <p className="text-sm text-muted-foreground">
            {characterCount} of {characterLimit}
          </p>
        )}
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

TextAreaControlled.displayName = "TextAreaControlled";

export default TextAreaControlled;

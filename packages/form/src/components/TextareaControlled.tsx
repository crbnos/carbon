import type { TextareaProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Textarea as TextAreaBase,
} from "@carbon/react";
import type { ChangeEvent } from "react";
import { forwardRef, useEffect } from "react";
import { useControlField, useField } from "../hooks";

type FormTextAreaControlledProps = Omit<TextareaProps, "value" | "onChange"> & {
  name: string;
  label?: string;
  characterLimit?: number;
  isRequired?: boolean;
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
      characterLimit,
      isRequired,
      helperText,
      value,
      className,
      onChange,
      ...rest
    },
    ref
  ) => {
    const { getInputProps, error } = useField(name);
    const [controlValue, setControlValue] = useControlField<string>(name);

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

    return (
      <FormControl
        isInvalid={!!error}
        isRequired={isRequired}
        className={className}
      >
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <TextAreaBase
          ref={ref}
          {...getInputProps({
            id: name,
            ...rest,
          })}
          value={controlValue}
          onChange={handleChange}
          maxLength={characterLimit}
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

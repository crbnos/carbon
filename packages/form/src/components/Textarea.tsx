import type { TextareaProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  Textarea as TextAreaBase
} from "@carbon/react";
import type { ChangeEvent } from "react";
import { forwardRef, useState } from "react";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type FormTextArea = TextareaProps & {
  name: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  characterLimit?: number;
  isRequired?: boolean;
  isDisabled?: boolean;
};

const TextArea = forwardRef<HTMLTextAreaElement, FormTextArea>(
  (
    {
      name,
      label,
      size,
      characterLimit,
      isRequired,
      isDisabled: isDisabledProp,
      ...rest
    },
    ref
  ) => {
    const {
      getInputProps,
      error,
      defaultValue,
      isOptional: fieldIsOptional
    } = useField(name);
    const formState = useFormStateContext();
    const disabled = formState.isDisabled || isDisabledProp || rest.disabled;
    const readOnly = formState.isReadOnly || rest.readOnly;
    const [characterCount, setCharacterCount] = useState(
      defaultValue?.length ?? 0
    );
    const resolvedIsOptional = isRequired ? false : (fieldIsOptional ?? false);

    const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
      if (characterLimit) setCharacterCount(e.target.value.length);
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && (
          <FormLabel htmlFor={name} isOptional={resolvedIsOptional}>
            {label}
          </FormLabel>
        )}
        <TextAreaBase
          ref={ref}
          {...getInputProps({
            id: name,
            ...rest
          })}
          size={size}
          maxLength={characterLimit}
          onChange={onChange}
          disabled={disabled}
          readOnly={readOnly}
        />
        {characterLimit && (
          <p className="text-sm text-muted-foreground">
            {characterCount} of {characterLimit}
          </p>
        )}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

TextArea.displayName = "TextArea";

export default TextArea;

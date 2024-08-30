import type { TextareaProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  Textarea as TextAreaBase,
} from "@carbon/react";
import { useField } from "@carbon/remix-validated-form";
import type { ChangeEvent } from "react";
import { forwardRef, useState } from "react";

type FormTextArea = TextareaProps & {
  name: string;
  label?: string;
  characterLimit?: number;
  isRequired?: boolean;
};

const TextArea = forwardRef<HTMLTextAreaElement, FormTextArea>(
  ({ name, label, characterLimit, isRequired, ...rest }, ref) => {
    const { getInputProps, error, defaultValue } = useField(name);
    const [characterCount, setCharacterCount] = useState(
      defaultValue?.length ?? 0
    );

    const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
      if (characterLimit) setCharacterCount(e.target.value.length);
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <TextAreaBase
          ref={ref}
          {...getInputProps({
            id: name,
            ...rest,
          })}
          maxLength={characterLimit}
          onChange={onChange}
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

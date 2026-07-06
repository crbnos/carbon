import type { InputProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Input as InputBase,
  InputGroup,
  InputLeftAddon,
  InputRightAddon
} from "@carbon/react";
import type { ChangeEvent, ReactNode } from "react";
import { forwardRef, useState } from "react";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import type { ValidationBehaviorOptions } from "../internal/getInputProps";

type FormInputProps = InputProps & {
  name: string;
  label?: ReactNode;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  helperText?: string;
  characterLimit?: number;
  prefix?: string;
  suffix?: string;
  validationBehavior?: ValidationBehaviorOptions;
  onConfigure?: () => void;
};

const Input = forwardRef<HTMLInputElement, FormInputProps>(
  (
    {
      name,
      label,
      isConfigured,
      isOptional,
      isRequired,
      helperText,
      characterLimit,
      prefix,
      suffix,
      onConfigure,
      maxLength,
      isDisabled: isDisabledProp,
      isReadOnly: isReadOnlyProp,
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
    const isDisabled = formState.isDisabled || isDisabledProp;
    const isReadOnly = formState.isReadOnly || isReadOnlyProp;
    const [characterCount, setCharacterCount] = useState(
      defaultValue?.length ?? 0
    );
    const onChange = (e: ChangeEvent<HTMLInputElement>) => {
      if (characterLimit) setCharacterCount(e.target.value.length);
    };
    const resolvedIsOptional =
      isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));

    return (
      <FormControl
        isInvalid={!!error}
        isRequired={isRequired}
        isDisabled={isDisabled}
        isReadOnly={isReadOnly}
      >
        {label ? (
          <FormLabel
            htmlFor={name}
            isOptional={resolvedIsOptional}
            isConfigured={isConfigured}
            onConfigure={onConfigure}
          >
            {label}
          </FormLabel>
        ) : (
          <label htmlFor={name} className="sr-only">
            {rest.placeholder ?? name}
          </label>
        )}
        {prefix || suffix ? (
          <InputGroup>
            {prefix && <InputLeftAddon children={prefix} />}
            <InputBase
              ref={ref}
              {...getInputProps({
                id: name,
                ...rest
              })}
              maxLength={characterLimit ?? maxLength}
              {...(characterLimit ? { onChange } : {})}
              isDisabled={isDisabled}
              isReadOnly={isReadOnly}
            />
            {suffix && <InputRightAddon children={suffix} />}
          </InputGroup>
        ) : (
          <InputBase
            ref={ref}
            {...getInputProps({
              id: name,
              ...rest
            })}
            maxLength={characterLimit ?? maxLength}
            {...(characterLimit ? { onChange } : {})}
            isDisabled={isDisabled}
            isReadOnly={isReadOnly}
          />
        )}

        {characterLimit && (
          <FormHelperText>
            {characterCount}/{characterLimit}
          </FormHelperText>
        )}
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

Input.displayName = "Input";

export default Input;

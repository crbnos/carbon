import { useFormContext } from "@carbon/form";
import type { InputProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  Input as InputBase,
  InputGroup,
  InputLeftAddon,
  InputRightAddon,
  VStack
} from "@carbon/react";
import type { ChangeEvent, ReactNode } from "react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { LuPlus, LuSettings2 } from "react-icons/lu";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type FormInputControlledProps = Omit<InputProps, "value" | "onChange"> & {
  name: string;
  label?: ReactNode;
  isConfigured?: boolean;
  isOptional?: boolean;
  isUppercase?: boolean;
  isRequired?: boolean;
  helperText?: string;
  characterLimit?: number;
  prefix?: string;
  suffix?: string;
  inline?: boolean;
  value: string;
  onChange?: (newValue: string) => void;
  onConfigure?: () => void;
};

const InputControlled = forwardRef<HTMLInputElement, FormInputControlledProps>(
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
      value,
      className,
      onChange,
      isUppercase,
      inline = false,
      isReadOnly: isReadOnlyProp,
      isDisabled: isDisabledProp,
      onBlur,
      onConfigure,
      maxLength,
      ...rest
    },
    ref
  ) => {
    const formState = useFormStateContext();
    const isDisabled = formState.isDisabled || isDisabledProp;
    const isReadOnly = formState.isReadOnly || isReadOnlyProp;
    const { validate } = useFormContext();
    const {
      getInputProps,
      error,
      isOptional: fieldIsOptional
    } = useField(name);
    const [controlValue, setControlValue] = useControlField<string>(name);
    const [inlineMode, setInlineMode] = useState(inline);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      setControlValue(isUppercase ? uppercase(value) : value);
    }, [isUppercase, setControlValue, value]);

    useEffect(() => {
      if (inline && !inlineMode) {
        inputRef.current?.focus();
      }
    }, [inline, inlineMode]);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      setControlValue(e.target.value);
      if (onChange && typeof onChange === "function") {
        onChange(isUppercase ? uppercase(e.target.value) : e.target.value);
      }
    };
    const resolvedIsOptional =
      isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));

    return inlineMode ? (
      <VStack>
        {label && (
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <HStack spacing={0} className="w-full justify-between">
          {value && (
            <span className="flex-grow text-sm line-clamp-1">{value}</span>
          )}
          <IconButton
            icon={value ? <LuSettings2 /> : <LuPlus />}
            aria-label={value ? "Edit" : "Add"}
            size="sm"
            variant="secondary"
            isDisabled={isReadOnly || isDisabled}
            onClick={() => setInlineMode(false)}
          />
        </HStack>
      </VStack>
    ) : (
      <FormControl
        isInvalid={!!error}
        isRequired={isRequired}
        isDisabled={isDisabled}
        isReadOnly={isReadOnly}
        className={className}
      >
        {label && (
          <FormLabel
            htmlFor={name}
            isOptional={resolvedIsOptional}
            isConfigured={isConfigured}
            onConfigure={onConfigure}
          >
            {label}
          </FormLabel>
        )}
        {prefix || suffix ? (
          <InputGroup>
            {prefix && <InputLeftAddon children={prefix} />}
            <InputBase
              ref={(node) => {
                if (typeof ref === "function") {
                  ref(node);
                } else if (ref) {
                  ref.current = node;
                }
                inputRef.current = node;
              }}
              {...getInputProps({
                id: name,
                ...rest,
                value: controlValue
              })}
              maxLength={characterLimit ?? maxLength}
              onChange={handleChange}
              value={controlValue}
              isReadOnly={isReadOnly}
              isDisabled={isDisabled}
              onBlur={async (e) => {
                if (inline) {
                  const result = await validate();
                  if (!result.error) {
                    onBlur?.(e);
                    setInlineMode(true);
                  }
                }
              }}
            />
            {suffix && <InputRightAddon children={suffix} />}
          </InputGroup>
        ) : (
          <InputBase
            ref={(node) => {
              if (typeof ref === "function") {
                ref(node);
              } else if (ref) {
                ref.current = node;
              }
              inputRef.current = node;
            }}
            {...getInputProps({
              id: name,
              ...rest,
              value: controlValue
            })}
            maxLength={characterLimit ?? maxLength}
            onChange={handleChange}
            value={controlValue}
            isReadOnly={isReadOnly}
            isDisabled={isDisabled}
            onBlur={async (e) => {
              if (inline) {
                const result = await validate();
                if (!result.error) {
                  onBlur?.(e);
                  setInlineMode(true);
                }
              } else {
                onBlur?.(e);
              }
            }}
          />
        )}
        {characterLimit && (
          <FormHelperText>
            {controlValue?.length ?? 0}/{characterLimit}
          </FormHelperText>
        )}
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

function uppercase(value?: string) {
  return value?.toUpperCase() ?? "";
}

InputControlled.displayName = "InputControlled";

export default InputControlled;

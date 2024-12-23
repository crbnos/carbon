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
  VStack,
} from "@carbon/react";
import type { ChangeEvent, ReactNode } from "react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { LuPlus, LuSettings2 } from "react-icons/lu";
import { useControlField, useField } from "../hooks";

type FormInputControlledProps = Omit<InputProps, "value" | "onChange"> & {
  name: string;
  label?: ReactNode;
  isConfigured?: boolean;
  isUppercase?: boolean;
  isRequired?: boolean;
  helperText?: string;
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
      isRequired,
      helperText,
      prefix,
      suffix,
      value,
      className,
      onChange,
      isUppercase,
      inline = false,
      isReadOnly,
      onBlur,
      onConfigure,
      ...rest
    },
    ref
  ) => {
    const { validate } = useFormContext();
    const { getInputProps, error } = useField(name);
    const [controlValue, setControlValue] = useControlField<string>(name);
    const [inlineMode, setInlineMode] = useState(inline);
    const inputRef = useRef<HTMLInputElement>(null);

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
            isDisabled={isReadOnly}
            onClick={() => setInlineMode(false)}
          />
        </HStack>
      </VStack>
    ) : (
      <FormControl
        isInvalid={!!error}
        isRequired={isRequired}
        className={className}
      >
        {label && (
          <FormLabel
            htmlFor={name}
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
                // @ts-ignore
                value: controlValue,
              })}
              onChange={handleChange}
              value={controlValue}
              isReadOnly={isReadOnly}
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
              // @ts-ignore
              value: controlValue,
            })}
            onChange={handleChange}
            value={controlValue}
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

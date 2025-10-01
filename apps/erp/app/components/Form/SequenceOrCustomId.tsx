import { useField } from "@carbon/form";
import type { InputProps } from "@carbon/react";
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  cn,
} from "@carbon/react";
import { forwardRef, useState } from "react";
import { LuToggleLeft, LuToggleRight } from "react-icons/lu";

type SequenceOrCustomIdProps = InputProps & {
  name: string;
  label: string;
  table: string;
  placeholder?: string;
  isOptional?: boolean;
  helperText?: string;
};

const SequenceOrCustomId = forwardRef<
  HTMLInputElement,
  SequenceOrCustomIdProps
>(
  (
    {
      name,
      label,
      table,
      isOptional = false,
      helperText,
      placeholder = "Next Sequence",
      ...rest
    },
    ref
  ) => {
    const { getInputProps, error } = useField(name);
    const [isCustom, setIsCustom] = useState(!!getInputProps()?.defaultValue);

    return (
      <FormControl isInvalid={!!error}>
        {label && (
          <FormLabel htmlFor={name} isOptional={isOptional}>
            {label}
          </FormLabel>
        )}
        <div className="flex flex-grow items-start min-w-0 relative">
          {isCustom ? (
            <Input
              ref={ref}
              {...getInputProps({
                id: name,
                placeholder: `Custom ${label}`,
                ...rest,
              })}
              className="w-full"
            />
          ) : (
            <Button
              size="md"
              variant="secondary"
              className="flex-grow bg-muted text-muted-foreground justify-start pr-4 h-10 w-full hover:scale-100 focus-visible:scale-100"
            >
              {placeholder}
            </Button>
          )}
          <IconButton
            aria-label="Toggle"
            className={cn(
              "bg-card absolute right-0 top-0",
              "flex-shrink-0 h-10 w-10 px-3 rounded-l-none before:rounded-l-none border-none -ml-px shadow-button-base"
            )}
            icon={isCustom ? <LuToggleLeft /> : <LuToggleRight />}
            variant="secondary"
            size="lg"
            onClick={() => setIsCustom(!isCustom)}
          />
        </div>

        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

SequenceOrCustomId.displayName = "SequenceOrCustomId";

export default SequenceOrCustomId;

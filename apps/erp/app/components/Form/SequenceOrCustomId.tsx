import { useField } from "@carbon/form";
import type { TermId } from "@carbon/glossary";
import type { InputProps } from "@carbon/react";
import {
  Button,
  cn,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  LabelWithHelp
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { forwardRef, useState } from "react";
import { LuToggleLeft, LuToggleRight } from "react-icons/lu";

type SequenceOrCustomIdProps = InputProps & {
  name: string;
  label: string;
  termId?: TermId;
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
      termId,
      table,
      isOptional,
      helperText,
      placeholder: placeholderProp,
      ...rest
    },
    ref
  ) => {
    const { t } = useLingui();
    const placeholder = placeholderProp ?? t`Next Sequence`;
    const {
      getInputProps,
      error,
      isOptional: fieldIsOptional
    } = useField(name);
    const [isCustom, setIsCustom] = useState(!!getInputProps()?.defaultValue);
    const resolvedIsOptional = isOptional ?? fieldIsOptional ?? false;

    return (
      <FormControl isInvalid={!!error}>
        {label && (
          <FormLabel htmlFor={name} isOptional={resolvedIsOptional}>
            <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
          </FormLabel>
        )}
        <div className="flex flex-grow items-start min-w-0 relative">
          {isCustom ? (
            <Input
              ref={ref}
              {...getInputProps({
                id: name,
                placeholder: t`Custom ${label}`,
                ...rest
              })}
              className="w-full"
            />
          ) : (
            <Button
              size="md"
              variant="outline"
              className="flex-grow bg-transparent text-muted-foreground justify-start pr-4 h-10 w-full hover:scale-100 focus-visible:scale-100"
            >
              {placeholder}
            </Button>
          )}
          <IconButton
            aria-label={t`Toggle`}
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

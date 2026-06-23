import type { TermId } from "@carbon/glossary";
import type { MultiSelectProps as MultiSelectBaseProps } from "@carbon/react";
import {
  Badge,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  LabelWithHelp,
  MultiSelect as MultiSelectBase
} from "@carbon/react";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

export type MultiSelectProps = Omit<
  MultiSelectBaseProps,
  "onChange" | "value" | "inline"
> & {
  name: string;
  label?: string;
  termId?: TermId;
  helperText?: string;
  emptyMessage?: ReactNode;
  value?: string[];
  onChange?: (newValue: { value: string; label: string }[]) => void;
  inline?: boolean;
  inlineIcon?: React.ReactElement;
  maxPreview?: number;
};

const MultiSelectPreview = (
  value: string[],
  options: { value: string; label: string; helper?: string }[],
  maxPreview?: number
) => {
  return (
    <div className="flex flex-wrap gap-1 items-start">
      {maxPreview && value.length > maxPreview ? (
        <Badge
          variant="secondary"
          className="border dark:border-none dark:shadow-button-base"
        >
          {value.length} selected
        </Badge>
      ) : (
        value.sort().map((val: string) => {
          const option = options.find((opt) => opt.value === val);
          const label = option ? option.label : val;
          return (
            <Badge
              className="max-w-[160px] truncate border dark:border-none dark:shadow-button-base"
              key={val}
              variant="secondary"
            >
              {label}
            </Badge>
          );
        })
      )}
    </div>
  );
};

const MultiSelect = ({
  name,
  label,
  termId,
  helperText,
  maxPreview,
  emptyMessage,
  ...props
}: MultiSelectProps) => {
  const { error, isOptional: fieldIsOptional } = useField(name);
  const [value, setValue] = useControlField<string[]>(name);
  const formState = useFormStateContext();
  const isReadOnly =
    formState.isReadOnly || formState.isDisabled || props.isReadOnly;

  useEffect(() => {
    if (props.value !== null && props.value !== undefined)
      setValue(props.value);
  }, [props.value, setValue]);

  const onChange = (value: string[]) => {
    props?.onChange?.(props.options.filter((o) => value.includes(o.value)));
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && (
        <FormLabel htmlFor={name} isOptional={fieldIsOptional ?? false}>
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </FormLabel>
      )}
      {(value ?? []).filter(Boolean).map((selection, index) => (
        <input
          key={`${name}[${index}]`}
          type="hidden"
          name={`${name}[${index}]`}
          value={selection}
        />
      ))}

      <MultiSelectBase
        {...props}
        value={(value ?? []).filter(Boolean)}
        inline={props.inline ? MultiSelectPreview : undefined}
        onChange={(newValue) => {
          setValue(newValue ?? []);
          onChange(newValue ?? []);
        }}
        isReadOnly={isReadOnly}
        emptyMessage={emptyMessage}
        className="w-full"
      />

      {error ? (
        <FormErrorMessage>{error}</FormErrorMessage>
      ) : (
        helperText && <FormHelperText>{helperText}</FormHelperText>
      )}
    </FormControl>
  );
};

MultiSelect.displayName = "MultiSelect";

export default MultiSelect;

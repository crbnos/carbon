import type { TermId } from "@carbon/glossary";
import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  LabelWithHelp,
  RadioGroup,
  RadioGroupItem
} from "@carbon/react";
import { useId } from "react";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type RadiosProps = {
  name: string;
  label?: string;
  termId?: TermId;
  options: { label: string; value: string }[];
  orientation?: "horizontal" | "vertical";
};

const Radios = ({
  name,
  label,
  termId,
  options,
  orientation = "vertical"
}: RadiosProps) => {
  const { getInputProps, error, isOptional: fieldIsOptional } = useField(name);
  const formState = useFormStateContext();
  const isDisabled = formState.isDisabled || formState.isReadOnly;
  const id = useId();

  return (
    <FormControl isInvalid={!!error}>
      {label && (
        <FormLabel htmlFor={name} isOptional={fieldIsOptional ?? false}>
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </FormLabel>
      )}
      <RadioGroup
        {...getInputProps({
          // @ts-ignore
          id: name
        })}
        name={name}
        orientation={orientation}
        disabled={isDisabled}
      >
        {options.map(({ label, value }) => (
          <div key={value} className="flex items-center space-x-2">
            <RadioGroupItem value={value} id={`${id}:${value}`} />
            <label htmlFor={`${id}:${value}`}>{label}</label>
          </div>
        ))}
      </RadioGroup>
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default Radios;

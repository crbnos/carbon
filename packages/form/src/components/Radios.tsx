import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  RadioGroup,
  RadioGroupItem
} from "@carbon/react";
import { useId } from "react";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type RadiosProps = {
  name: string;
  label?: string;
  isRequired?: boolean;
  options: { label: string; value: string }[];
  orientation?: "horizontal" | "vertical";
};

const Radios = ({
  name,
  label,
  isRequired = false,
  options,
  orientation = "vertical"
}: RadiosProps) => {
  const { getInputProps, error } = useField(name);
  const formState = useFormStateContext();
  const isDisabled = formState.isDisabled || formState.isReadOnly;
  const id = useId();

  return (
    <FormControl isInvalid={!!error} isRequired={isRequired}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
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

import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  RadioGroup,
  RadioGroupItem,
} from "@carbon/react";
import { useField } from "@carbon/remix-validated-form";
import { useId } from "react";

type RadiosProps = {
  name: string;
  label?: string;
  options: { label: string; value: string }[];
  orientation?: "horizontal" | "vertical";
};

const Radios = ({
  name,
  label,
  options,
  orientation = "vertical",
}: RadiosProps) => {
  const { getInputProps, error } = useField(name);
  const id = useId();

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <RadioGroup
        {...getInputProps({
          // @ts-ignore
          id: name,
        })}
        name={name}
        orientation={orientation}
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

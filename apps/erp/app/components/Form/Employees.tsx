import { useField } from "@carbon/form";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel
} from "@carbon/react";
import { useState } from "react";
import { UserSelect } from "../Selectors";
import type {
  IndividualOrGroup,
  UserSelectProps
} from "../Selectors/UserSelect/types";

export type EmployeesProps = {
  name: string;
  label?: string;
  helperText?: string;
  isRequired?: boolean;
} & UserSelectProps;

const Employees = ({
  name,
  label,
  helperText,
  isRequired = false,
  ...props
}: EmployeesProps) => {
  const { error, defaultValue, validate } = useField(name);
  const [selections, setSelections] = useState<string[]>(defaultValue);

  const handleChange = (items: IndividualOrGroup[]) => {
    setSelections(items.map((item) => item.id));
    validate();
  };

  return (
    <FormControl isInvalid={!!error} isRequired={isRequired}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      {selections.map((selection, index) => (
        <input
          key={`${name}[${index}]`}
          type="hidden"
          name={`${name}[${index}]`}
          value={selection}
        />
      ))}
      <UserSelect
        {...props}
        type="employee"
        usersOnly
        isMulti
        value={selections}
        onChange={handleChange}
      />
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default Employees;

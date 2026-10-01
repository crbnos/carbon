// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
} & UserSelectProps;

const Employees = ({ name, label, helperText, ...props }: EmployeesProps) => {
  const {
    error,
    defaultValue,
    validate,
    isOptional: fieldIsOptional
  } = useField(name);
  const [selections, setSelections] = useState<string[]>(defaultValue);

  const handleChange = (items: IndividualOrGroup[]) => {
    setSelections(items.map((item) => item.id));
    validate();
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && (
        <FormLabel htmlFor={name} isOptional={fieldIsOptional}>
          {label}
        </FormLabel>
      )}
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

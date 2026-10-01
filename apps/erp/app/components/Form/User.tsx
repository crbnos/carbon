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

export type UserProps = {
  name: string;
  label?: string;
  helperText?: string;
} & UserSelectProps;

const User = ({ name, label, type, helperText, ...props }: UserProps) => {
  const {
    error,
    defaultValue,
    validate,
    isOptional: fieldIsOptional
  } = useField(name);
  const [selection, setSelection] = useState<string>(defaultValue);

  const handleChange = (items: IndividualOrGroup[]) => {
    if (items.length > 0) {
      const item = items[0];
      setSelection(item.id);
    } else {
      setSelection("");
    }
    validate();
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && (
        <FormLabel htmlFor={name} isOptional={fieldIsOptional}>
          {label}
        </FormLabel>
      )}
      <input type="hidden" name={name} value={selection} />
      <UserSelect
        {...props}
        type={type}
        usersOnly
        isMulti={false}
        value={selection}
        onChange={handleChange}
      />
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default User;

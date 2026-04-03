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
  isRequired?: boolean;
} & UserSelectProps;

const User = ({
  name,
  label,
  type,
  helperText,
  isRequired = false,
  ...props
}: UserProps) => {
  const { error, defaultValue, validate } = useField(name);
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
    <FormControl isInvalid={!!error} isRequired={isRequired}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
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

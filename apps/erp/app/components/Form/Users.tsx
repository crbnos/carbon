import { useField } from "@carbon/form";
import type { TermId } from "@carbon/glossary";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  LabelWithHelp
} from "@carbon/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { UserSelect } from "../Selectors";
import type {
  IndividualOrGroup,
  UserSelectProps
} from "../Selectors/UserSelect/types";

export type UsersProps = {
  name: string;
  label?: ReactNode;
  termId?: TermId;
  helperText?: string;
  verbose?: boolean; // prepends "user_" or "group_" to the value
} & UserSelectProps;

const Users = ({
  name,
  label,
  termId,
  type,
  helperText,
  verbose = false,
  ...props
}: UsersProps) => {
  const {
    error,
    defaultValue,
    validate,
    isOptional: fieldIsOptional
  } = useField(name);
  const [selections, setSelections] = useState<string[]>(defaultValue);

  const handleChange = (items: IndividualOrGroup[]) => {
    setSelections(
      verbose
        ? items.map((item) =>
            "users" in item ? `group_${item.id}` : `user_${item.id}`
          )
        : items.map((item) => item.id)
    );
    validate();
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && (
        <FormLabel htmlFor={name} isOptional={fieldIsOptional}>
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
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
        type={type}
        isMulti
        value={stripUserGroupPrefix(selections)}
        onChange={handleChange}
      />
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

function stripUserGroupPrefix(items: string[]) {
  return items.map((item) => item.replace(/^(user|group)_/, ""));
}

export default Users;

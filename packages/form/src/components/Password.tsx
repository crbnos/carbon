import type { TermId } from "@carbon/glossary";
import type { InputProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  LabelWithHelp
} from "@carbon/react";
import { forwardRef, useState } from "react";
import { BiHide, BiShowAlt } from "react-icons/bi";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type FormPasswordProps = InputProps & {
  name: string;
  label?: string;
  termId?: TermId;
  isRequired?: boolean;
};

const Password = forwardRef<HTMLInputElement, FormPasswordProps>(
  ({ name, label, termId, isRequired, ...rest }, ref) => {
    const {
      getInputProps,
      error,
      isOptional: fieldIsOptional
    } = useField(name);
    const formState = useFormStateContext();
    const isDisabled = formState.isDisabled || rest.isDisabled;
    const isReadOnly = formState.isReadOnly || rest.isReadOnly;
    const [passwordVisible, setPasswordVisible] = useState(false);
    const resolvedIsOptional = isRequired ? false : (fieldIsOptional ?? false);

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && (
          <FormLabel htmlFor={name} isOptional={resolvedIsOptional}>
            <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
          </FormLabel>
        )}
        <InputGroup>
          <Input
            {...getInputProps({
              id: name,
              ...rest
            })}
            ref={ref}
            type={passwordVisible ? "text" : "password"}
            isDisabled={isDisabled}
            isReadOnly={isReadOnly}
          />
          <InputRightElement className="w-[2.75rem]">
            <IconButton
              aria-label={passwordVisible ? "Show password" : "Hide password"}
              icon={passwordVisible ? <BiShowAlt /> : <BiHide />}
              variant="ghost"
              tabIndex={-1}
              onClick={() => setPasswordVisible(!passwordVisible)}
            />
          </InputRightElement>
        </InputGroup>
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

Password.displayName = "Password";

export default Password;

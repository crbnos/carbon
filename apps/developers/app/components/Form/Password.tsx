import type { InputProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
} from "@carbon/react";
import { useField } from "@carbon/remix-validated-form";
import { forwardRef, useState } from "react";
import { BiHide, BiShowAlt } from "react-icons/bi";

type FormPasswordProps = InputProps & {
  name: string;
  label?: string;
  isRequired?: boolean;
};

const Password = forwardRef<HTMLInputElement, FormPasswordProps>(
  ({ name, label, isRequired, ...rest }, ref) => {
    const { getInputProps, error } = useField(name);
    const [passwordVisible, setPasswordVisible] = useState(false);

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <InputGroup>
          <Input
            {...getInputProps({
              id: name,
              ...rest,
            })}
            ref={ref}
            type={passwordVisible ? "text" : "password"}
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

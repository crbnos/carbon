import type { InputProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  Input as InputBase,
} from "@carbon/react";
import { forwardRef } from "react";
import { useField } from "../hooks";

type HiddenProps = InputProps & {
  name: string;
  value?: string | number;
};

const Hidden = forwardRef<HTMLInputElement, HiddenProps>(
  ({ name, value, ...rest }, ref) => {
    const { getInputProps, error } = useField(name);

    return (
      <FormControl isInvalid={!!error}>
        <InputBase
          ref={ref}
          {...getInputProps({
            id: name,
            ...rest,
          })}
          value={value}
          type="hidden"
        />
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

Hidden.displayName = "Hidden";

export default Hidden;

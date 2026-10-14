// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { InputProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  Input as InputBase
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
    const { defaultValue, ...inputProps } = getInputProps({
      id: name,
      ...rest
    });

    return (
      // Phones: an empty hidden field must not take a row in the form.
      <FormControl
        isInvalid={!!error}
        className={error ? undefined : "max-md:hidden"}
      >
        <InputBase
          ref={ref}
          {...inputProps}
          {...(value !== undefined ? { value } : { defaultValue })}
          type="hidden"
        />
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

Hidden.displayName = "Hidden";

export default Hidden;

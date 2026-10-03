// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useControlField, useField } from "@carbon/form";
import { FormControl, FormErrorMessage, FormLabel } from "@carbon/react";
import { ColorPicker } from "~/components/ColorPicker";

type ColorFieldProps = {
  name: string;
  label: string;
};

const Color = ({ name, label }: ColorFieldProps) => {
  const { error, isOptional: fieldIsOptional } = useField(name);
  const [value, setValue] = useControlField<string>(name);

  return (
    <FormControl>
      <FormLabel isOptional={fieldIsOptional}>{label}</FormLabel>
      <input type="hidden" name={name} value={value ?? ""} />
      <ColorPicker value={value ?? "#000000"} onChange={setValue} />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default Color;

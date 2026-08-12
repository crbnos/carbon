import { useControlField, useField } from "@carbon/form";
import {
  ChoiceCardGroup,
  type ChoiceCardOption,
  FormControl,
  FormErrorMessage,
  FormLabel
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuOctagonAlert, LuTriangleAlert } from "react-icons/lu";

type Severity = "error" | "warn";

type SeveritySelectProps = {
  name: string;
  label?: string;
};

export default function SeveritySelect({ name, label }: SeveritySelectProps) {
  const { t } = useLingui();
  const { error, isOptional } = useField(name);
  const [value, setValue] = useControlField<Severity>(name);

  const options: ChoiceCardOption<Severity>[] = [
    {
      value: "error",
      title: t`Error`,
      description: t`Blocks save until resolved`,
      icon: <LuOctagonAlert />
    },
    {
      value: "warn",
      title: t`Warning`,
      description: t`Allows acknowledge & continue`,
      icon: <LuTriangleAlert />
    }
  ];

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel isOptional={isOptional} htmlFor={name}>
        {label ?? t`Severity`}
      </FormLabel>
      <input type="hidden" name={name} value={value ?? ""} />
      <ChoiceCardGroup<Severity>
        value={value ?? "error"}
        onChange={setValue}
        options={options}
        direction="row"
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
}

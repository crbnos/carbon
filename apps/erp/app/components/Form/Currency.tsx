import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMemo } from "react";
import { useCurrencies } from "~/hooks/useCurrencies";

type CurrencySelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

const CurrencyPreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode }[]
) => {
  const currency = options.find((o) => o.value === value);
  if (!currency) return null;
  return <span>{currency.label}</span>;
};

const Currency = ({ inline, ...props }: CurrencySelectProps) => {
  const options = useCurrencyCodes();

  return (
    <Combobox
      {...props}
      inline={inline ? CurrencyPreview : undefined}
      options={options}
      label={props?.label ?? "Currency"}
    />
  );
};

Currency.displayName = "Currency";

export default Currency;

const useCurrencyCodes = () => {
  const currencies = useCurrencies();

  return useMemo(
    () => currencies.map((c) => ({ value: c.code, label: c.name })),
    [currencies]
  );
};

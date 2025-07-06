import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo } from "react";
import type { getCurrenciesList } from "~/modules/accounting";
import { path } from "~/utils/path";

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
  const currencyFetcher =
    useFetcher<Awaited<ReturnType<typeof getCurrenciesList>>>();

  useMount(() => {
    currencyFetcher.load(path.to.api.currencies);
  });

  const options = useMemo(
    () =>
      currencyFetcher.data?.data
        ? currencyFetcher.data?.data.map((c) => ({
            value: c.code,
            label: c.name,
          }))
        : [],
    [currencyFetcher.data]
  );

  return options;
};

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo } from "react";
import type { getCurrenciesList } from "~/modules/accounting";
import { path } from "~/utils/path";

type CurrencySelectProps = Omit<ComboboxProps, "options">;

const Currency = ({ ...props }: CurrencySelectProps) => {
  const options = useCurrencies();

  return (
    <Combobox {...props} options={options} label={props?.label ?? "Currency"} />
  );
};

Currency.displayName = "Currency";

export default Currency;

const useCurrencies = () => {
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

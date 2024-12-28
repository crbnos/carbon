import type { ComboboxProps } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { Combobox } from "~/components/Form";
import type { getCountries } from "~/modules/shared";
import { path } from "~/utils/path";

type CountrySelectProps = Omit<ComboboxProps, "options">;

const Country = (props: CountrySelectProps) => {
  const options = useCountries();

  return <Combobox options={options} label="Country" {...props} />;
};

Country.displayName = "Country";

export default Country;

export const useCountries = () => {
  const countryFetcher = useFetcher<Awaited<ReturnType<typeof getCountries>>>();

  useMount(() => {
    countryFetcher.load(path.to.api.countries);
  });

  const countries = countryFetcher.data?.data ?? [];

  const options = countries.map((c) => ({
    value: c.alpha2,
    label: c.name,
  }));

  return options;
};

import type { ComboboxProps } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import { Combobox } from "~/components/Form";
import type { getCountries } from "~/modules/shared/shared.service.server";
import { path } from "~/utils/path";

type CountrySelectProps = Omit<ComboboxProps, "options">;

const Country = (props: CountrySelectProps) => {
  const { t } = useLingui();
  const options = useCountries();

  return <Combobox options={options} label={t`Country`} {...props} />;
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
    label: c.name
  }));

  return options;
};

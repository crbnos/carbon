import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { Select } from "~/components/Form";
import type { getCountries } from "~/modules/shared";
import { path } from "~/utils/path";

const Country = () => {
  const options = useCountry();

  return (
    <>
      <Select name="countryCode" options={options} label="Country" />
    </>
  );
};

Country.displayName = "Country";

export default Country;

export const useCountry = () => {
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

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { Combobox } from "~/components/Form";
import type { getCountries } from "~/modules/shared";
import { path } from "~/utils/path";

type CountrySelectProps = Omit<ComboboxProps, "options">;

const Country = (props: CountrySelectProps) => {
  const { t } = useLingui();
  const options = useCountries();

  return <Combobox options={options} label={t`Country`} {...props} />;
};

Country.displayName = "Country";

export default Country;

export const useCountries = (enabled = true) => {
  const countryFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getCountries>>
  >(enabled ? path.to.api.countries : null);

  const options = useMemo(() => {
    return (countryFetcher.data?.data ?? []).map((c) => ({
      value: c.alpha2,
      label: c.name
    }));
  }, [countryFetcher.data?.data]);

  return options;
};

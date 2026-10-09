// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo } from "react";
import type { getLaborCategoriesList } from "~/modules/projects";
import { path } from "~/utils/path";

type LaborCategorySelectProps = Omit<ComboboxProps, "options">;

/** Picks an active labor category. */
const LaborCategory = (props: LaborCategorySelectProps) => {
  const options = useLaborCategories();
  return (
    <Combobox
      options={options}
      {...props}
      label={props?.label ?? "Labor Category"}
    />
  );
};

LaborCategory.displayName = "LaborCategory";

export default LaborCategory;

/** The active labor categories as select options, loaded once and cached. */
export const useLaborCategories = () => {
  const fetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getLaborCategoriesList>>
  >(path.to.api.laborCategories);

  return useMemo(
    () =>
      (fetcher.data?.data ?? []).map((category) => ({
        value: category.id,
        label: category.name
      })),
    [fetcher.data]
  );
};

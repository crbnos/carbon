// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getScrapReasonsList } from "~/services/operations.service";
import { path } from "~/utils/path";

type ScrapReasonSelectProps = Omit<ComboboxProps, "options">;

const ScrapReason = (props: ScrapReasonSelectProps) => {
  const { t } = useLingui();
  const options = useScrapReasons();

  return (
    <Combobox
      options={options}
      {...props}
      label={props?.label ?? t`Scrap Reason`}
    />
  );
};

ScrapReason.displayName = "ScrapReason";

export default ScrapReason;

export const useScrapReasons = () => {
  const scrapReasonFetcher =
    useFetcher<Awaited<ReturnType<typeof getScrapReasonsList>>>();

  useMount(() => {
    scrapReasonFetcher.load(path.to.scrapReasons);
  });

  const options = useMemo(() => {
    const dataSource = scrapReasonFetcher.data?.data ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [scrapReasonFetcher.data?.data]);

  return options;
};

// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import { useRouteData } from "~/hooks";
import type {
  getScrapReasonsList,
  ScrapReason as ScrapReasonType
} from "~/modules/production";
import { path } from "~/utils/path";

type ScrapReasonSelectProps = Omit<ComboboxProps, "options">;

const ScrapReason = (props: ScrapReasonSelectProps) => {
  const options = useScrapReasons();

  return (
    <Combobox
      options={options}
      {...props}
      label={props?.label ?? "Scrap Reason"}
    />
  );
};

ScrapReason.displayName = "ScrapReason";

export default ScrapReason;

export const useScrapReasons = () => {
  const scrapReasonFetcher =
    useFetcher<Awaited<ReturnType<typeof getScrapReasonsList>>>();

  const sharedProductionData = useRouteData<{
    scrapReasons: ScrapReasonType[];
  }>(path.to.production);

  const hasScrapReasonData = sharedProductionData?.scrapReasons;

  useMount(() => {
    if (!hasScrapReasonData) scrapReasonFetcher.load(path.to.api.scrapReasons);
  });

  const options = useMemo(() => {
    const dataSource =
      (hasScrapReasonData
        ? sharedProductionData.scrapReasons
        : scrapReasonFetcher.data?.data) ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name
    }));
  }, [
    scrapReasonFetcher.data?.data,
    hasScrapReasonData,
    sharedProductionData?.scrapReasons
  ]);

  return options;
};

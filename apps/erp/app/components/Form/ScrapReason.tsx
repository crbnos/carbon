// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo } from "react";
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
  const sharedProductionData = useRouteData<{
    scrapReasons: ScrapReasonType[];
  }>(path.to.production);

  const hasScrapReasonData = sharedProductionData?.scrapReasons;

  const scrapReasonFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getScrapReasonsList>>
  >(!hasScrapReasonData ? path.to.api.scrapReasons : null);

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

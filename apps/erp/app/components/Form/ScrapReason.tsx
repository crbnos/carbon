import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import { useRouteData } from "~/hooks";
import type { ScrapReason as ScrapReasonType } from "~/modules/production";
import type { getScrapReasonsList } from "~/modules/production/production.service.server";
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

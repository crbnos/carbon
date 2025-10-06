import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo } from "react";
import type { getScrapReasonsList } from "~/services/operations.service";
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

  useMount(() => {
    scrapReasonFetcher.load(path.to.scrapReasons);
  });

  const options = useMemo(() => {
    const dataSource = scrapReasonFetcher.data?.data ?? [];

    return dataSource.map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [scrapReasonFetcher.data?.data]);

  return options;
};

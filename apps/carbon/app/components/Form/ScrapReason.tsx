import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { useRouteData } from "~/hooks";
import type {
  getScrapReasonsList,
  ScrapReason as ScrapReasonType,
} from "~/modules/production";
import ScrapReasonForm from "~/modules/production/ui/ScrapReasonCodes/ScrapReasonForm";
import { path } from "~/utils/path";
type ScrapReasonSelectProps = Omit<ComboboxProps, "options">;

const ScrapReason = (props: ScrapReasonSelectProps) => {
  const newScrapReasonModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useScrapReasons();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "CustomerStatus"}
        onCreateOption={(option) => {
          newScrapReasonModal.onOpen();
          setCreated(option);
        }}
      />
      {newScrapReasonModal.isOpen && (
        <ScrapReasonForm
          type="modal"
          onClose={() => {
            setCreated("");
            newScrapReasonModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
          }}
        />
      )}
    </>
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
      label: c.name,
    }));
  }, [
    scrapReasonFetcher.data?.data,
    hasScrapReasonData,
    sharedProductionData?.scrapReasons,
  ]);

  return options;
};

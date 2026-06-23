import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useUser } from "~/hooks";
import type { getGaugesList, getGaugeTypesList } from "~/modules/quality";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";

import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type GaugeSelectProps = Omit<ComboboxProps, "options">;

const Gauge = (props: GaugeSelectProps) => {
  const newGaugeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { options, gaugeTypes } = useGauges();
  const { defaults } = useUser();

  const emptyMessage = useEmptyState("gauge", {
    onCreate: () => newGaugeModal.onOpen()
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Gauge"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          newGaugeModal.onOpen();
          setCreated(option);
        }}
      />
      {newGaugeModal.isOpen && (
        <GaugeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newGaugeModal.onClose();
            triggerRef.current?.click();
          }}
          gaugeTypes={gaugeTypes}
          initialValues={{
            id: undefined,
            gaugeId: undefined,
            supplierId: "",
            modelNumber: "",
            serialNumber: "",
            description: created,
            dateAcquired: today(getLocalTimeZone()).toString(),
            gaugeTypeId: "",

            lastCalibrationDate: "",
            nextCalibrationDate: "",
            locationId: defaults.locationId ?? "",
            storageUnitId: "",
            calibrationIntervalInMonths: 6,
            gaugeRole: "Standard" as const
          }}
        />
      )}
    </>
  );
};

Gauge.displayName = "Gauge";

export default Gauge;

export const useGauges = () => {
  const gaugeFetcher = useFetcher<{
    gauges: Awaited<ReturnType<typeof getGaugesList>>["data"];
    gaugeTypes: Awaited<ReturnType<typeof getGaugeTypesList>>["data"];
  }>();

  useMount(() => {
    gaugeFetcher.load(path.to.api.gauges);
  });

  const options = useMemo(
    () =>
      gaugeFetcher.data?.gauges
        ? gaugeFetcher.data?.gauges.map((c) => ({
            value: c.id,
            label: c.name,
            helper: c.description ?? undefined
          }))
        : [],
    [gaugeFetcher.data]
  );

  return { options, gaugeTypes: gaugeFetcher.data?.gaugeTypes ?? [] };
};
